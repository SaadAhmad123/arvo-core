import { trace } from '@opentelemetry/api';
import type { ArvoEvent } from '../../../../src/ArvoEvent/index.js';
import { ArvoExecutionContextTelemetry } from '../../../../src/ArvoEventHandler/context/telemetry/index.js';
import type { ArvoHandlerFault } from '../../../../src/ArvoEventHandler/fault/index.js';
import { deriveArvoExecutionId } from '../../../../src/ArvoEventHandler/helpers/execution-id.js';
import type { ArvoEventHandlerExecuteResponse } from '../../../../src/ArvoEventHandler/types/execute.js';
import { ArvoEventSerializer } from '../../../../src/serializers/ArvoEventSerializer/index.js';
import type { JSONObject } from '../../../../src/types.js';
import type { ArvoBehaviour, ArvoVersionsUnderTest } from './fixture.js';

/** How a lattice may misbehave, every one of them off by default. */
export type ArvoChaos = {
  /** How many extra times each event is delivered. */
  duplicate: number;
  /** Whether what is queued is delivered in the order it arrived. */
  shuffle: boolean;
  /** How often two events for one execution read the same record. */
  concurrent: number;
  /** How often a commit lands but its events are never published. */
  crashBeforePublish: number;
  /** How often a compare-and-swap is lost to a write that never happened. */
  loseRace: number;
  /** How often an event is dropped outright. */
  drop: number;
};

const NO_CHAOS: ArvoChaos = {
  duplicate: 0,
  shuffle: false,
  concurrent: 0,
  crashBeforePublish: 0,
  loseRace: 0,
  drop: 0,
};

/** Everything that happened, in the order it happened. */
export type ArvoTranscript = {
  /** Every event that reached the lattice, routed or parked. */
  readonly published: ArvoEvent[];
  /** Every event a handler was actually given. */
  readonly delivered: {
    event: ArvoEvent;
    executionId: string;
    attempt: number;
  }[];
  /** Every record committed, and the execution it belongs to. */
  readonly committed: { executionId: string; row: JSONObject }[];
  /** Every event discarded as already processed. */
  readonly discarded: { event: ArvoEvent; reason: string }[];
  /** Every fault raised, and what caused it. */
  readonly faults: { event: ArvoEvent; fault: ArvoHandlerFault }[];
  /** Every commit a store refused because another write had landed. */
  readonly conflicts: { executionId: string; event: ArvoEvent }[];
  /** Every execution the lattice gave up on, with what it committed. */
  readonly abandoned: { executionId: string; fault: ArvoHandlerFault }[];
};

/** What a scenario builds a lattice from. */
export type ArvoLatticeParam = {
  /** Every version this lattice can run. */
  versions: ArvoVersionsUnderTest;
  /** How it should misbehave. */
  chaos?: Partial<ArvoChaos>;
  /** What the lattice calls the time, so days may pass in microseconds. */
  clock?: { now: () => number };
  /** What decides every random choice, so a failure can be run again. */
  seed?: number;
};

/** A deterministic source of chance, so a failing run can be repeated. */
const chanceFrom = (seed: number) => {
  let held = seed >>> 0;
  return () => {
    held = (held + 0x6d2b79f5) >>> 0;
    let drawn = Math.imul(held ^ (held >>> 15), 1 | held);
    drawn = (drawn + Math.imul(drawn ^ (drawn >>> 7), 61 | drawn)) ^ drawn;
    return ((drawn ^ (drawn >>> 14)) >>> 0) / 4294967296;
  };
};

/** The contract and version an event's `dataschema` names. */
const named = (event: ArvoEvent) => {
  const cut = event.dataschema.lastIndexOf('/');
  return {
    uri: event.dataschema.slice(0, cut),
    version: event.dataschema.slice(cut + 1),
  };
};

/**
 * A lattice: everything around a version, and nothing of a version.
 *
 * It does what whatever runs a handler must do — classify, derive the
 * execution, read the record, commit it against what was read, publish
 * what comes back, count attempts — and it can be told to do each of those
 * badly. A version is then the only thing under test, and the lattice is
 * the world it has to hold up in.
 *
 * Events carrying a domain are **parked**: no handler ever sees one. They
 * are work that has left the lattice, and something outside has to inject
 * an answer for an execution waiting on one to go on.
 *
 * @example
 * ```typescript
 * const lattice = createArvoLattice({ versions: declareVersions() });
 * lattice.publish(orderEvent);
 * await lattice.settle();
 * lattice.transcript.faults; // nothing, on a good day
 * ```
 */
export class ArvoLattice {
  readonly transcript: ArvoTranscript = {
    published: [],
    delivered: [],
    committed: [],
    discarded: [],
    faults: [],
    conflicts: [],
    abandoned: [],
  };

  /** What each execution's record is now, as the store holds it. */
  readonly store = new Map<string, JSONObject>();

  /** What is waiting off the lattice, by the path it was lifted to. */
  readonly parked = new Map<string, ArvoEvent[]>();

  readonly #versions: ArvoVersionsUnderTest;
  readonly #chaos: ArvoChaos;
  readonly #clock: { now: () => number };
  readonly #chance: () => number;
  readonly #events = new ArvoEventSerializer({ type: 'arvoevent' });
  readonly #behaviours = new Map<string, ArvoBehaviour<never>>();
  readonly #attempts = new Map<string, number>();
  readonly #conflicts = new Map<string, number>();
  #queue: ArvoEvent[] = [];
  #held: ArvoEvent[] = [];

  constructor(param: ArvoLatticeParam) {
    this.#versions = param.versions;
    this.#chaos = { ...NO_CHAOS, ...param.chaos };
    this.#clock = param.clock ?? { now: () => Date.now() };
    this.#chance = chanceFrom(param.seed ?? 1);
  }

  /**
   * What every execution of this contract should do, rather than its
   * default.
   *
   * The context is annotated by whoever writes the behaviour, because a
   * lattice routes between six shapes and cannot know which one this is.
   */
  behave<TContext>(
    contractType: string,
    behaviour: ArvoBehaviour<TContext>,
  ): this {
    this.#behaviours.set(contractType, behaviour as ArvoBehaviour<never>);
    return this;
  }

  /** An event into the lattice, routed or parked by whether it names a path. */
  publish(event: ArvoEvent): this {
    this.transcript.published.push(event);
    if (event.domain !== null) {
      const waiting = this.parked.get(event.domain) ?? [];
      waiting.push(event);
      this.parked.set(event.domain, waiting);
      return this;
    }

    if (this.#chaos.drop > 0 && this.#chance() < this.#chaos.drop) return this;

    this.#queue.push(event);
    for (let extra = 0; extra < this.#chaos.duplicate; extra += 1) {
      this.#queue.push(event);
    }
    return this;
  }

  /** An answer from outside the lattice, put back into it. */
  inject(event: ArvoEvent): this {
    return this.publish(event);
  }

  /** What is waiting on one path, and no longer parked once taken. */
  take(domain: string): ArvoEvent[] {
    const waiting = this.parked.get(domain) ?? [];
    this.parked.set(domain, []);
    return waiting;
  }

  /** Whatever is parked on one path, answered by something outside. */
  fulfil(domain: string, answer: (asked: ArvoEvent) => ArvoEvent | null): this {
    for (const asked of this.take(domain)) {
      const given = answer(asked);
      if (given !== null) this.inject(given);
    }
    return this;
  }

  /** Some fraction of what is parked on one path, never answered. */
  forget(domain: string, fraction: number): ArvoEvent[] {
    const waiting = this.take(domain);
    const kept = waiting.filter(() => this.#chance() >= fraction);
    this.parked.set(domain, kept);
    return waiting.filter((event) => !kept.includes(event));
  }

  /** The record one execution stands at, as the store holds it. */
  stored(executionId: string): JSONObject | null {
    return this.store.get(executionId) ?? null;
  }

  /** Runs every event the lattice holds, and everything they cause. */
  async settle(budget = 200_000): Promise<this> {
    let steps = 0;
    while (this.#queue.length > 0) {
      steps += 1;
      if (steps > budget) {
        throw new Error(`this lattice did not settle within ${budget} steps`);
      }
      const event = this.#next();
      if (event !== undefined) await this.#deliver(event);
    }
    return this;
  }

  /** Whichever event is next, which under chaos is not the first. */
  #next(): ArvoEvent | undefined {
    if (!this.#chaos.shuffle) return this.#queue.shift();
    const at = Math.floor(this.#chance() * this.#queue.length);
    const [taken] = this.#queue.splice(at, 1);
    return taken;
  }

  /** One event, through everything a mechanism owns, to a version and back. */
  async #deliver(event: ArvoEvent): Promise<void> {
    const versions = event.to === null ? undefined : this.#versions[event.to];
    if (versions === undefined) return;

    const naming = named(event);
    const self = Object.values(versions)[0]?.contracts.self;
    const entry: 'init' | 'followup' =
      self !== undefined && naming.uri === self.uri && event.type === self.type
        ? 'init'
        : 'followup';

    const executionId =
      entry === 'init' ? await deriveArvoExecutionId(event) : event.executionid;

    const read = this.stored(executionId);
    if (entry === 'init' && read !== null) return;
    if (entry === 'followup' && read === null) return;

    const version =
      entry === 'init'
        ? versions[naming.version]
        : versions[String(read?.version)];
    if (version === undefined) return;

    const key = `${executionId}:${event.id}`;
    const attempt = this.#attempts.get(key) ?? 0;
    this.transcript.delivered.push({ event, executionId, attempt });

    try {
      const response = (await version.execute({
        entry,
        event,
        state: read,
        executionId,
        attempt,
        dependencies: {
          behave: this.#behaviours.get(event.to as string),
        },
        hooks: {},
        telemetry: this.#telemetry(),
      } as never)) as ArvoEventHandlerExecuteResponse;

      if (response.kind === 'discarded') {
        this.transcript.discarded.push({ event, reason: response.reason });
        return;
      }
      this.#commit(executionId, event, response.state, response.events, read);
    } catch (raised) {
      await this.#onFault(event, executionId, key, attempt, raised);
    }
  }

  /** The record and its events, together or not at all. */
  #commit(
    executionId: string,
    event: ArvoEvent,
    row: JSONObject,
    emitted: readonly ArvoEvent[],
    read: JSONObject | null,
  ): void {
    const expected = read === null ? 0 : Number(read.casVersion) + 1;
    const lost =
      this.#chaos.loseRace > 0 && this.#chance() < this.#chaos.loseRace;

    if (lost || Number(row.casVersion) !== expected) {
      // What a mechanism does with the delivery that lost: it ran against
      // a record that has since moved, so it runs again against the one
      // that is there now. Nothing it produced is published.
      this.transcript.conflicts.push({ executionId, event });
      const tried = this.#conflicts.get(event.id) ?? 0;
      if (tried < 20) {
        this.#conflicts.set(event.id, tried + 1);
        this.#queue.push(event);
      }
      return;
    }

    this.store.set(executionId, row);
    this.transcript.committed.push({ executionId, row });

    const crashed =
      this.#chaos.crashBeforePublish > 0 &&
      this.#chance() < this.#chaos.crashBeforePublish;
    if (crashed) {
      this.#held.push(...emitted);
      return;
    }
    for (const leaving of emitted) this.publish(leaving);
  }

  /** What was committed but never published, sent on recovery. */
  recover(): this {
    const holding = this.#held;
    this.#held = [];
    for (const leaving of holding) this.publish(leaving);
    return this;
  }

  /** A fault: retried where the fault says so, else abandoned with its pair. */
  async #onFault(
    event: ArvoEvent,
    executionId: string,
    key: string,
    attempt: number,
    raised: unknown,
  ): Promise<void> {
    const fault = raised as ArvoHandlerFault;
    if (fault?._tag !== 'ArvoHandlerFault') throw raised;
    this.transcript.faults.push({ event, fault });

    if (fault.retry !== null) {
      this.#attempts.set(key, attempt + 1);
      this.#queue.push(event);
      return;
    }

    this.transcript.abandoned.push({ executionId, fault });
    if (fault.abandonmentState !== null) {
      this.store.set(executionId, JSON.parse(fault.abandonmentState));
      this.transcript.committed.push({
        executionId,
        row: JSON.parse(fault.abandonmentState),
      });
    }
    if (fault.abandonmentEvent !== null) {
      const restored = await this.#events.tryDeserialize(
        fault.abandonmentEvent,
      );
      if (restored.ok) this.publish(restored.value);
    }
  }

  /** What one execution records against, which nothing collects. */
  #telemetry(): ArvoExecutionContextTelemetry {
    return new ArvoExecutionContextTelemetry({
      span: trace.getTracer('lattice').startSpan('execution'),
      meter: null,
      logger: null,
    });
  }

  /** How many events were committed but never published. */
  get holding(): number {
    return this.#held.length;
  }

  /** What the lattice calls the time. */
  get now(): number {
    return this.#clock.now();
  }
}

/** A lattice to run executions in, and to make misbehave. */
export const createArvoLattice = (param: ArvoLatticeParam): ArvoLattice =>
  new ArvoLattice(param);
