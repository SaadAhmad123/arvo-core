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
type CarriedEvent = { readonly written: string; readonly to: string | null };

/** One thread, and what it is doing. */
type Lane = {
  readonly worker: Worker;
  held: CarriedEvent | null;
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
  /** Whether the order handler declares layers around its executor. */
  readonly layered?: boolean;
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

  readonly #serializer = new ArvoEventSerializer({ type: 'arvoevent' });
  readonly #lanes: Lane[] = [];
  readonly #queue: CarriedEvent[] = [];
  readonly #attempts = new Map<string, number>();
  #onSettled: (() => void) | null = null;
  readonly #threadCount: number;
  readonly #charges: ChargeBehaviour;
  readonly #holdMs: number;
  readonly #duplicate: boolean;
  readonly #layered: boolean;

  constructor(threadCount: number, options: ThreadedBrokerOptions = {}) {
    this.#threadCount = threadCount;
    this.#charges = options.charges ?? 'succeeds';
    this.#holdMs = options.slowly ?? 0;
    this.#duplicate = options.duplicate === true;
    this.#layered = options.layered === true;
  }

  /** Starts every thread, each loading the built package for itself. */
  start(): Promise<this> {
    const runnerUrl = new URL('./runner.mts', import.meta.url);
    for (
      let threadIndex = 0;
      threadIndex < this.#threadCount;
      threadIndex += 1
    ) {
      const worker = new Worker(runnerUrl, {
        workerData: { charges: this.#charges, layered: this.#layered },
      });
      const lane: Lane = { worker, held: null, alive: true };
      worker.on(
        'message',
        (message) => void this.#handleMessage(lane, message),
      );
      worker.on('error', (workerError) =>
        this.#handleWorkerError(lane, workerError),
      );
      worker.unref();
      this.#lanes.push(lane);
    }
    return Promise.resolve(this);
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
  async kill(threadIndex: number): Promise<void> {
    const lane = this.#liveLanes()[threadIndex];
    if (lane === undefined) return;

    lane.alive = false;
    const inFlight = lane.held;
    lane.held = null;
    await lane.worker.terminate();

    if (inFlight) {
      this.transcript.died += 1;
      this.#queue.push(inFlight);
    }
    this.#pump();
  }

  /** An event into the broker, to be given to whichever thread is free. */
  async publish(event: unknown): Promise<this> {
    const serialization = await this.#serializer.trySerialize(event as never);
    if (!serialization.ok) return this;

    const publishedEvent = JSON.parse(serialization.value) as {
      type: string;
      to: string | null;
      subject: string;
    };
    this.transcript.published.push(publishedEvent);

    const queuedEvent = { written: serialization.value, to: publishedEvent.to };
    this.#queue.push(queuedEvent);
    if (this.#duplicate) this.#queue.push(queuedEvent);
    return this;
  }

  /** Runs until every thread is idle and nothing is queued. */
  async settle(timeoutMs = 20_000): Promise<this> {
    this.#pump();
    if (this.#isQuiet()) return this;

    await new Promise<void>((resolve, reject) => {
      const giveUpTimer = setTimeout(() => {
        this.#onSettled = null;
        reject(new Error('these threads did not settle'));
      }, timeoutMs);
      this.#onSettled = () => {
        clearTimeout(giveUpTimer);
        this.#onSettled = null;
        resolve();
      };
    });
    return this;
  }

  #liveLanes(): Lane[] {
    return this.#lanes.filter((lane) => lane.alive);
  }

  #isQuiet(): boolean {
    return (
      this.#queue.length === 0 &&
      this.#liveLanes().every((lane) => lane.held === null)
    );
  }

  /** Hands work to every thread that is free, all at once. */
  #pump(): void {
    for (const lane of this.#liveLanes()) {
      if (lane.held !== null) continue;
      const queuedEvent = this.#queue.shift();
      if (queuedEvent === undefined) break;

      lane.held = queuedEvent;
      lane.worker.postMessage({
        kind: 'run',
        event: queuedEvent.written,
        attempt: this.#attempts.get(queuedEvent.written) ?? 0,
        slowly: this.#holdMs,
      });
    }
    if (this.#isQuiet()) this.#onSettled?.();
  }

  /** A thread that died rather than answered. */
  #handleWorkerError(lane: Lane, workerError: Error): void {
    const inFlight = lane.held;
    lane.held = null;
    this.transcript.broken.push(workerError.message);
    if (inFlight) this.#queue.push(inFlight);
    this.#pump();
  }

  /** What one thread said, which is either a read or an outcome. */
  async #handleMessage(
    lane: Lane,
    message: Record<string, unknown>,
  ): Promise<void> {
    // A read is not the end of the work: the thread is still holding it.
    if (message.kind === 'read') {
      lane.worker.postMessage({
        kind: 'read',
        at: message.at,
        row: this.store.get(String(message.executionId)) ?? null,
      });
      return;
    }

    const inFlight = lane.held;
    lane.held = null;
    if (inFlight === null) return;

    if (message.kind === 'discarded') this.transcript.discarded += 1;

    if (message.kind === 'produced') {
      const row = message.state as Record<string, unknown>;
      const executionId = String(row.executionId);
      const committedRow = this.store.get(executionId) ?? null;
      const expectedCasVersion =
        committedRow === null ? 0 : Number(committedRow.casVersion) + 1;

      if (Number(row.casVersion) !== expectedCasVersion) {
        this.transcript.conflicts += 1;
        this.#queue.push(inFlight);
      } else {
        this.store.set(executionId, row);
        this.transcript.committed.push({
          executionId,
          casVersion: Number(row.casVersion),
          version: String(row.version),
        });
        for (const outgoingEvent of message.events as string[]) {
          await this.publish(JSON.parse(outgoingEvent));
        }
      }
    }

    if (message.kind === 'faulted') {
      this.transcript.faults.push(String(message.faultKind));
      if (message.retryable === true) {
        this.#attempts.set(
          inFlight.written,
          (this.#attempts.get(inFlight.written) ?? 0) + 1,
        );
        this.#queue.push(inFlight);
      } else if (message.faultKind !== 'record_unexpected') {
        // a broker that repeats itself must not read its own repeat as a
        // failure, which is what an opening event for an execution that
        // already exists is
        this.transcript.abandoned.push(String(message.executionId));
        if (message.abandonmentState !== null) {
          this.store.set(
            String(message.executionId),
            JSON.parse(String(message.abandonmentState)),
          );
        }
        if (message.abandonmentEvent !== null) {
          await this.publish(JSON.parse(String(message.abandonmentEvent)));
        }
      }
    }

    this.#pump();
  }
}
