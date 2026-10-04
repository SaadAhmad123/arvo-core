import { Worker } from 'node:worker_threads';
import { deriveArvoExecutionId } from '../../../../../dist/ArvoEventHandler/helpers/execution-id.js';
import { ArvoEventSerializer } from '../../../../../dist/serializers/ArvoEventSerializer/index.js';
import {
  type ChargeBehaviour,
  chargeContract,
  orderContract,
} from './contracts.js';

/**
 * A broker with real handlers behind it, each in its own thread.
 *
 * It owns what a mechanism owns and nothing else: the store, the
 * compare-and-swap, the queue, and the outbox. Handlers are elsewhere,
 * genuinely elsewhere, so the interleavings are the operating system's
 * to choose rather than this file's.
 */

/** An event as it travels: written out, the way a broker carries one. */
export type Carried = { readonly written: string; readonly plain: Plain };

/** The fields of an event a broker reads to route it. */
type Plain = {
  id: string;
  to: string | null;
  type: string;
  subject: string;
  executionid: string;
  initid: string | null;
  parentid: string | null;
  dataschema: string;
  domain: string | null;
};

/**
 * One thread, and what it is doing.
 *
 * A thread is identified by this object rather than by where it sits, so
 * losing one never renames the rest. A lane is taken the moment work is
 * chosen for it, before the record it runs against has been read, so a
 * broker mid-handover is never mistaken for a broker with nothing left.
 */
type Lane = {
  readonly worker: Worker;
  held: { carried: Carried; executionId: string | null } | null;
  alive: boolean;
};

export type ArvoThreadedTranscript = {
  published: Plain[];
  committed: { executionId: string; casVersion: number }[];
  conflicts: number;
  discarded: number;
  faults: string[];
  died: number;
  broken: string[];
  abandoned: string[];
};

/** How cruel this broker is, on top of what the threads do on their own. */
export type ArvoThreadedBrokerOptions = {
  /** How a charge behaves wherever it runs. */
  readonly charges?: ChargeBehaviour;
  /** How long each thread is held inside its executor, in milliseconds. */
  readonly slowly?: number;
  /** Whether every event is carried twice, as an at-least-once bus does. */
  readonly duplicate?: boolean;
  /** Whether the queue is taken from out of order. */
  readonly shuffle?: boolean;
};

const CONTRACTS = [orderContract, chargeContract];

export class ArvoThreadedBroker {
  readonly store = new Map<string, Record<string, unknown>>();
  readonly transcript: ArvoThreadedTranscript = {
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
  readonly #shuffle: boolean;

  constructor(howMany: number, options: ArvoThreadedBrokerOptions = {}) {
    this.#howMany = howMany;
    this.#charges = options.charges ?? 'succeeds';
    this.#slowly = options.slowly ?? 0;
    this.#duplicate = options.duplicate === true;
    this.#shuffle = options.shuffle === true;
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

  /**
   * Kills one of the threads still running, whatever it was in the
   * middle of.
   *
   * Whatever it held is never acknowledged, so it goes back on the queue
   * for whoever is left — which is what a lost machine looks like from
   * everywhere else.
   */
  async kill(which: number): Promise<void> {
    const lane = this.#live()[which];
    if (lane === undefined) return;

    lane.alive = false;
    const held = lane.held;
    lane.held = null;
    await lane.worker.terminate();

    if (held) {
      this.transcript.died += 1;
      this.#queue.push(held.carried);
    }
    this.#pump();
  }

  /** An event into the broker, to be routed to whichever thread is free. */
  async publish(event: unknown): Promise<this> {
    const written = await this.#events.trySerialize(event as never);
    if (!written.ok) return this;
    const plain = JSON.parse(written.value) as Plain;
    this.transcript.published.push(plain);
    this.#queue.push({ written: written.value, plain });
    if (this.#duplicate) this.#queue.push({ written: written.value, plain });
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

  /** The next event off the queue, in order or out of it. */
  #take(): Carried | undefined {
    if (!this.#shuffle) return this.#queue.shift();
    const at = Math.floor(Math.random() * this.#queue.length);
    return this.#queue.splice(at, 1)[0];
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
      const carried = this.#take();
      if (carried === undefined) break;
      lane.held = { carried, executionId: null };
      void this.#give(lane, carried);
    }
    if (this.#isQuiet()) this.#settled?.();
  }

  /** One event handed to one thread, against the record as it stands. */
  async #give(lane: Lane, carried: Carried): Promise<void> {
    const route = await this.#routeFor(carried.plain);
    if (!lane.alive) return;

    if (route === null) {
      lane.held = null;
      this.#pump();
      return;
    }

    const key = `${route.executionId}:${carried.plain.id}`;
    lane.held = { carried, executionId: route.executionId };
    lane.worker.postMessage({
      event: carried.written,
      entry: route.entry,
      executionId: route.executionId,
      attempt: this.#attempts.get(key) ?? 0,
      contractType: carried.plain.to,
      version: route.version,
      state: route.read,
      slowly: this.#slowly,
    });
  }

  /** Who would run this, against what, or nothing where nobody would. */
  async #routeFor(plain: Plain) {
    const contract = CONTRACTS.find((one) => one.type === plain.to);
    if (contract === undefined) return null;

    const cut = plain.dataschema.lastIndexOf('/');
    const uri = plain.dataschema.slice(0, cut);
    const named = plain.dataschema.slice(cut + 1);
    const entry: 'init' | 'followup' =
      uri === contract.uri && plain.type === contract.type
        ? 'init'
        : 'followup';

    const executionId =
      entry === 'init'
        ? await deriveArvoExecutionId(plain as never)
        : plain.executionid;

    const read = this.store.get(executionId) ?? null;
    if (entry === 'init' && read !== null) return null;
    if (entry === 'followup' && read === null) return null;

    return {
      entry,
      executionId,
      read,
      version: entry === 'init' ? named : String(read?.version),
    };
  }

  /**
   * A thread that died rather than answered.
   *
   * Whatever it held goes back on the queue, the same as a thread that
   * was killed, because from here the two are the same event.
   */
  #broke(lane: Lane, raised: Error): void {
    const held = lane.held;
    lane.held = null;
    this.transcript.broken.push(raised.message);
    if (held) this.#queue.push(held.carried);
    this.#pump();
  }

  /** What one thread said about what it was given. */
  async #heard(lane: Lane, said: Record<string, unknown>): Promise<void> {
    const held = lane.held;
    lane.held = null;
    if (held === null || held.executionId === null) return;

    const executionId = held.executionId;
    const key = `${executionId}:${held.carried.plain.id}`;

    if (said.kind === 'discarded') this.transcript.discarded += 1;

    if (said.kind === 'produced') {
      const row = said.state as Record<string, unknown>;
      const now = this.store.get(executionId) ?? null;
      const expected = now === null ? 0 : Number(now.casVersion) + 1;

      if (Number(row.casVersion) !== expected) {
        this.transcript.conflicts += 1;
        this.#queue.push(held.carried);
      } else {
        this.store.set(executionId, row);
        this.transcript.committed.push({
          executionId,
          casVersion: Number(row.casVersion),
        });
        for (const leaving of said.events as string[]) {
          await this.publish(JSON.parse(leaving));
        }
      }
    }

    if (said.kind === 'faulted') {
      this.transcript.faults.push(String(said.faultKind));
      if (said.retryable === true) {
        this.#attempts.set(key, (this.#attempts.get(key) ?? 0) + 1);
        this.#queue.push(held.carried);
      } else {
        this.transcript.abandoned.push(executionId);
        if (said.abandonmentState !== null) {
          // the pair crosses written out, the same as every event does
          this.store.set(
            executionId,
            JSON.parse(String(said.abandonmentState)) as Record<
              string,
              unknown
            >,
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
