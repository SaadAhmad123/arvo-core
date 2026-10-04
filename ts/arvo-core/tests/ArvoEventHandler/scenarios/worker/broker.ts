import { Worker } from 'node:worker_threads';
import { ArvoEventSerializer } from '../../../../dist/serializers/ArvoEventSerializer/index.js';
import type { ChargeBehaviour } from './contracts.js';

/**
 * A broker with real handlers behind it, each in its own thread.
 *
 * Simpler than the one that drove versions, and every line it lost is
 * one the handler now owns. It no longer reads a `dataschema`, no
 * longer derives an identifier, no longer decides whether a record was
 * expected, and no longer chooses a version. It keeps a store, a queue
 * and an outbox, serializes writes, and answers reads.
 */

/** An event as it travels: written out, the way a broker carries one. */
type Carried = { readonly written: string; readonly to: string | null };

/** One thread, and what it is doing. */
type Lane = {
  readonly worker: Worker;
  held: Carried | null;
  alive: boolean;
};

export type ThreadedTranscript = {
  published: { type: string; to: string | null; subject: string }[];
  committed: { executionId: string; casVersion: number; version: string }[];
  conflicts: number;
  discarded: number;
  faults: string[];
  died: number;
  broken: string[];
  abandoned: string[];
};

export type ThreadedBrokerOptions = {
  /** How a charge behaves wherever it runs. */
  readonly charges?: ChargeBehaviour;
  /** How long each thread is held inside one execution, in milliseconds. */
  readonly slowly?: number;
  /** Whether every event is carried twice, as an at-least-once bus does. */
  readonly duplicate?: boolean;
};

export class ThreadedBroker {
  readonly store = new Map<string, Record<string, unknown>>();
  readonly transcript: ThreadedTranscript = {
    published: [],
    committed: [],
    conflicts: 0,
    discarded: 0,
    faults: [],
    died: 0,
    broken: [],
    abandoned: [],
  };

  readonly #events = new ArvoEventSerializer({ type: 'arvoevent' });
  readonly #lanes: Lane[] = [];
  readonly #queue: Carried[] = [];
  readonly #attempts = new Map<string, number>();
  #settled: (() => void) | null = null;
  readonly #howMany: number;
  readonly #charges: ChargeBehaviour;
  readonly #slowly: number;
  readonly #duplicate: boolean;

  constructor(howMany: number, options: ThreadedBrokerOptions = {}) {
    this.#howMany = howMany;
    this.#charges = options.charges ?? 'succeeds';
    this.#slowly = options.slowly ?? 0;
    this.#duplicate = options.duplicate === true;
  }

  /** Starts every thread, each loading the built package for itself. */
  async start(): Promise<this> {
    const at = new URL('./runner.mts', import.meta.url);
    for (let which = 0; which < this.#howMany; which += 1) {
      const worker = new Worker(at, {
        workerData: { charges: this.#charges },
      });
      const lane: Lane = { worker, held: null, alive: true };
      worker.on('message', (said) => void this.#heard(lane, said));
      worker.on('error', (raised) => this.#broke(lane, raised));
      worker.unref();
      this.#lanes.push(lane);
    }
    return this;
  }

  /** Stops every thread, whatever each was doing. */
  async stop(): Promise<void> {
    await Promise.all(
      this.#lanes.map((lane) => {
        lane.alive = false;
        return lane.worker.terminate();
      }),
    );
  }

  /** Kills one of the threads still running, whatever it was in the middle of. */
  async kill(which: number): Promise<void> {
    const lane = this.#live()[which];
    if (lane === undefined) return;

    lane.alive = false;
    const held = lane.held;
    lane.held = null;
    await lane.worker.terminate();

    if (held) {
      this.transcript.died += 1;
      this.#queue.push(held);
    }
    this.#pump();
  }

  /** An event into the broker, to be given to whichever thread is free. */
  async publish(event: unknown): Promise<this> {
    const written = await this.#events.trySerialize(event as never);
    if (!written.ok) return this;

    const plain = JSON.parse(written.value) as {
      type: string;
      to: string | null;
      subject: string;
    };
    this.transcript.published.push(plain);

    const carried = { written: written.value, to: plain.to };
    this.#queue.push(carried);
    if (this.#duplicate) this.#queue.push(carried);
    return this;
  }

  /** Runs until every thread is idle and nothing is queued. */
  async settle(within = 20_000): Promise<this> {
    this.#pump();
    if (this.#isQuiet()) return this;

    await new Promise<void>((done, fail) => {
      const giveUp = setTimeout(() => {
        this.#settled = null;
        fail(new Error('these threads did not settle'));
      }, within);
      this.#settled = () => {
        clearTimeout(giveUp);
        this.#settled = null;
        done();
      };
    });
    return this;
  }

  #live(): Lane[] {
    return this.#lanes.filter((lane) => lane.alive);
  }

  #isQuiet(): boolean {
    return (
      this.#queue.length === 0 &&
      this.#live().every((lane) => lane.held === null)
    );
  }

  /** Hands work to every thread that is free, all at once. */
  #pump(): void {
    for (const lane of this.#live()) {
      if (lane.held !== null) continue;
      const carried = this.#queue.shift();
      if (carried === undefined) break;

      lane.held = carried;
      lane.worker.postMessage({
        kind: 'run',
        event: carried.written,
        attempt: this.#attempts.get(carried.written) ?? 0,
        slowly: this.#slowly,
      });
    }
    if (this.#isQuiet()) this.#settled?.();
  }

  /** A thread that died rather than answered. */
  #broke(lane: Lane, raised: Error): void {
    const held = lane.held;
    lane.held = null;
    this.transcript.broken.push(raised.message);
    if (held) this.#queue.push(held);
    this.#pump();
  }

  /** What one thread said, which is either a read or an outcome. */
  async #heard(lane: Lane, said: Record<string, unknown>): Promise<void> {
    // A read is not the end of the work: the thread is still holding it.
    if (said.kind === 'read') {
      lane.worker.postMessage({
        kind: 'read',
        at: said.at,
        row: this.store.get(String(said.executionId)) ?? null,
      });
      return;
    }

    const held = lane.held;
    lane.held = null;
    if (held === null) return;

    if (said.kind === 'discarded') this.transcript.discarded += 1;

    if (said.kind === 'produced') {
      const row = said.state as Record<string, unknown>;
      const executionId = String(row.executionId);
      const now = this.store.get(executionId) ?? null;
      const expected = now === null ? 0 : Number(now.casVersion) + 1;

      if (Number(row.casVersion) !== expected) {
        this.transcript.conflicts += 1;
        this.#queue.push(held);
      } else {
        this.store.set(executionId, row);
        this.transcript.committed.push({
          executionId,
          casVersion: Number(row.casVersion),
          version: String(row.version),
        });
        for (const leaving of said.events as string[]) {
          await this.publish(JSON.parse(leaving));
        }
      }
    }

    if (said.kind === 'faulted') {
      this.transcript.faults.push(String(said.faultKind));
      if (said.retryable === true) {
        this.#attempts.set(
          held.written,
          (this.#attempts.get(held.written) ?? 0) + 1,
        );
        this.#queue.push(held);
      } else if (said.faultKind !== 'record_unexpected') {
        // a broker that repeats itself must not read its own repeat as a
        // failure, which is what an opening event for an execution that
        // already exists is
        this.transcript.abandoned.push(String(said.executionId));
        if (said.abandonmentState !== null) {
          this.store.set(
            String(said.executionId),
            JSON.parse(String(said.abandonmentState)),
          );
        }
        if (said.abandonmentEvent !== null) {
          await this.publish(JSON.parse(String(said.abandonmentEvent)));
        }
      }
    }

    this.#pump();
  }
}
