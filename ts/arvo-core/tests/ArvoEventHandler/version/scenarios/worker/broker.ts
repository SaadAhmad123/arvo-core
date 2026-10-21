import { Worker } from 'node:worker_threads';
import { deriveArvoExecutionId } from '../../../../../dist/ArvoEventHandler/helpers/execution-id.js';
import { ArvoEventSerializer } from '../../../../../dist/serializers/ArvoEventSerializer/index.js';
import { chanceFrom } from '../chance.js';
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
export type WireEvent = {
  readonly written: string;
  readonly plain: RoutingFields;
};

/** The fields of an event a broker reads to route it. */
type RoutingFields = {
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
  held: { carried: WireEvent; executionId: string | null } | null;
  alive: boolean;
};

export type ArvoThreadedTranscript = {
  published: RoutingFields[];
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
  /** What the shuffle is drawn from, so a failure is a seed rather than a story. */
  readonly seed?: number;
};

const CONTRACTS = [orderContract, chargeContract];

/** What a shuffle draws from where a caller named no seed. */
const DEFAULT_SEED = 1;

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

  readonly #serializer = new ArvoEventSerializer({ type: 'arvoevent' });
  readonly #lanes: Lane[] = [];
  readonly #queue: WireEvent[] = [];
  readonly #attempts = new Map<string, number>();
  #resolveSettle: (() => void) | null = null;
  readonly #threadCount: number;
  readonly #charges: ChargeBehaviour;
  readonly #executorDelay: number;
  readonly #duplicate: boolean;
  readonly #shuffle: boolean;
  readonly #draw: () => number;

  constructor(threadCount: number, options: ArvoThreadedBrokerOptions = {}) {
    this.#threadCount = threadCount;
    this.#charges = options.charges ?? 'succeeds';
    this.#executorDelay = options.slowly ?? 0;
    this.#duplicate = options.duplicate === true;
    this.#shuffle = options.shuffle === true;
    this.#draw = chanceFrom(options.seed ?? DEFAULT_SEED);
  }

  /** Starts every thread, each loading the built package for itself. */
  start(): Promise<this> {
    const runnerUrl = new URL('./runner.mts', import.meta.url);
    for (let thread = 0; thread < this.#threadCount; thread += 1) {
      const worker = new Worker(runnerUrl, {
        workerData: { charges: this.#charges },
      });
      const lane: Lane = { worker, held: null, alive: true };
      worker.on('message', (message) => void this.#onMessage(lane, message));
      worker.on('error', (workerError) => this.#onError(lane, workerError));
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

  /**
   * Kills one of the threads still running, whatever it was in the
   * middle of.
   *
   * Whatever it held is never acknowledged, so it goes back on the queue
   * for whoever is left — which is what a lost machine looks like from
   * everywhere else.
   */
  async kill(liveIndex: number): Promise<void> {
    const lane = this.#liveLanes()[liveIndex];
    if (lane === undefined) return;

    lane.alive = false;
    const assignment = lane.held;
    lane.held = null;
    await lane.worker.terminate();

    if (assignment) {
      this.transcript.died += 1;
      this.#queue.push(assignment.carried);
    }
    this.#pump();
  }

  /** An event into the broker, to be routed to whichever thread is free. */
  async publish(event: unknown): Promise<this> {
    const eventJson = await this.#serializer.trySerialize(event as never);
    if (!eventJson.ok) return this;
    const routingFields = JSON.parse(eventJson.value) as RoutingFields;
    this.transcript.published.push(routingFields);
    this.#queue.push({ written: eventJson.value, plain: routingFields });
    if (this.#duplicate)
      this.#queue.push({ written: eventJson.value, plain: routingFields });
    return this;
  }

  /** Runs until every thread is idle and nothing is queued. */
  async settle(timeoutMs = 20_000): Promise<this> {
    this.#pump();
    if (this.#isQuiet()) return this;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#resolveSettle = null;
        reject(new Error('these threads did not settle'));
      }, timeoutMs);
      this.#resolveSettle = () => {
        clearTimeout(timeout);
        this.#resolveSettle = null;
        resolve();
      };
    });
    return this;
  }

  /** The next event off the queue, in order or out of it. */
  #nextEvent(): WireEvent | undefined {
    if (!this.#shuffle) return this.#queue.shift();
    const position = Math.floor(this.#draw() * this.#queue.length);
    return this.#queue.splice(position, 1)[0];
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
      const wireEvent = this.#nextEvent();
      if (wireEvent === undefined) break;
      lane.held = { carried: wireEvent, executionId: null };
      void this.#dispatch(lane, wireEvent);
    }
    if (this.#isQuiet()) this.#resolveSettle?.();
  }

  /** One event handed to one thread, against the record as it stands. */
  async #dispatch(lane: Lane, wireEvent: WireEvent): Promise<void> {
    const route = await this.#routeFor(wireEvent.plain);
    if (!lane.alive) return;

    if (route === null) {
      lane.held = null;
      this.#pump();
      return;
    }

    const attemptKey = `${route.executionId}:${wireEvent.plain.id}`;
    lane.held = { carried: wireEvent, executionId: route.executionId };
    lane.worker.postMessage({
      event: wireEvent.written,
      entry: route.entry,
      executionId: route.executionId,
      attempt: this.#attempts.get(attemptKey) ?? 0,
      contractType: wireEvent.plain.to,
      version: route.version,
      state: route.record,
      slowly: this.#executorDelay,
    });
  }

  /** Who would run this, against what, or nothing where nobody would. */
  async #routeFor(event: RoutingFields) {
    const contract = CONTRACTS.find((candidate) => candidate.type === event.to);
    if (contract === undefined) return null;

    const lastSlash = event.dataschema.lastIndexOf('/');
    const uri = event.dataschema.slice(0, lastSlash);
    const schemaVersion = event.dataschema.slice(lastSlash + 1);
    const entry: 'init' | 'followup' =
      uri === contract.uri && event.type === contract.type
        ? 'init'
        : 'followup';

    const executionId =
      entry === 'init'
        ? await deriveArvoExecutionId(event as never)
        : event.executionid;

    const record = this.store.get(executionId) ?? null;
    if (entry === 'init' && record !== null) return null;
    if (entry === 'followup' && record === null) return null;

    return {
      entry,
      executionId,
      record,
      version: entry === 'init' ? schemaVersion : String(record?.version),
    };
  }

  /**
   * A thread that died rather than answered.
   *
   * Whatever it held goes back on the queue, the same as a thread that
   * was killed, because from here the two are the same event.
   */
  #onError(lane: Lane, workerError: Error): void {
    const assignment = lane.held;
    lane.held = null;
    this.transcript.broken.push(workerError.message);
    if (assignment) this.#queue.push(assignment.carried);
    this.#pump();
  }

  /** What one thread said about what it was given. */
  async #onMessage(
    lane: Lane,
    message: Record<string, unknown>,
  ): Promise<void> {
    const assignment = lane.held;
    lane.held = null;
    if (assignment === null || assignment.executionId === null) return;

    const executionId = assignment.executionId;
    const attemptKey = `${executionId}:${assignment.carried.plain.id}`;

    if (message.kind === 'discarded') this.transcript.discarded += 1;

    if (message.kind === 'produced') {
      const row = message.state as Record<string, unknown>;
      const storedRecord = this.store.get(executionId) ?? null;
      const expectedCasVersion =
        storedRecord === null ? 0 : Number(storedRecord.casVersion) + 1;

      if (Number(row.casVersion) !== expectedCasVersion) {
        this.transcript.conflicts += 1;
        this.#queue.push(assignment.carried);
      } else {
        this.store.set(executionId, row);
        this.transcript.committed.push({
          executionId,
          casVersion: Number(row.casVersion),
        });
        for (const emittedJson of message.events as string[]) {
          await this.publish(JSON.parse(emittedJson));
        }
      }
    }

    if (message.kind === 'faulted') {
      this.transcript.faults.push(String(message.faultKind));
      if (message.retryable === true) {
        this.#attempts.set(
          attemptKey,
          (this.#attempts.get(attemptKey) ?? 0) + 1,
        );
        this.#queue.push(assignment.carried);
      } else {
        this.transcript.abandoned.push(executionId);
        if (message.abandonmentState !== null) {
          // the pair crosses written out, the same as every event does
          this.store.set(
            executionId,
            JSON.parse(String(message.abandonmentState)) as Record<
              string,
              unknown
            >,
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
