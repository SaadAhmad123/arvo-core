import { trace } from '@opentelemetry/api';
import type { ArvoEvent } from '../../../../src/ArvoEvent/index.js';
import { ArvoExecutionContextTelemetry } from '../../../../src/ArvoEventHandler/context/telemetry/index.js';
import { ArvoHandlerFault } from '../../../../src/ArvoEventHandler/fault/index.js';
import { deriveArvoExecutionId } from '../../../../src/ArvoEventHandler/helpers/execution-id.js';
import type { ArvoEventHandlerExecuteResponse } from '../../../../src/ArvoEventHandler/types/execute.js';
import type { ArvoEventHandlerMiddlewareEntry } from '../../../../src/ArvoEventHandler/types/middleware.js';
import { ArvoEventSerializer } from '../../../../src/serializers/ArvoEventSerializer/index.js';
import type { JSONObject } from '../../../../src/types.js';
import { heldDependencies } from '../../dependency.js';
import { chanceFrom } from './chance.js';
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
  /**
   * How often the process dies part way through an execution.
   *
   * Before anything is committed and before anything is published, which
   * is the ordinary way a process dies: the work is half done and
   * nothing anywhere records that it was ever started.
   */
  crashMidExecution: number;
};

const NO_CHAOS: ArvoChaos = {
  duplicate: 0,
  shuffle: false,
  concurrent: 0,
  crashBeforePublish: 0,
  loseRace: 0,
  drop: 0,
  crashMidExecution: 0,
};

/** Everything that happened, in the order it happened. */
export type ArvoTranscript = {
  /** Every event that reached the lattice, routed or parked. */
  readonly published: ArvoEvent[];
  /**
   * Which of those an execution produced, rather than something outside.
   *
   * A test injecting an answer is the world misbehaving, not a handler
   * answering, and what is asked of a handler must not be judged on it.
   */
  readonly fromExecutions: Set<string>;
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
  /** Every execution the process died part way through. */
  readonly died: { event: ArvoEvent; executionId: string }[];
};

/**
 * A handler this lattice may hand an event to whole.
 *
 * Typed by what the lattice uses rather than by the class, so a lattice
 * driving a handler is not coupled to how one is declared.
 */
export type ArvoHandlerUnderTest = {
  execute(param: {
    event: ArvoEvent;
    state: (param: {
      executionId: string;
      telemetry: ArvoExecutionContextTelemetry;
      attempt: number;
    }) => JSONObject | null;
    attempt: number;
    dependencies?: unknown;
    hooks?: unknown;
    middleware?: readonly ArvoEventHandlerMiddlewareEntry[];
  }): Promise<ArvoEventHandlerExecuteResponse>;
};

/** What a scenario builds a lattice from. */
export type ArvoLatticeParam = {
  /** Every version this lattice can run. */
  versions: ArvoVersionsUnderTest;
  /**
   * Every handler this lattice can run, keyed by what an event addresses.
   *
   * Where one is registered for an event's `to`, the lattice hands it the
   * event whole and settles nothing first: classifying it, deriving the
   * execution and reading the record are the handler's own. The lattice
   * is then only what a mechanism is — a queue, a store, and a way to
   * lose things.
   */
  handlers?: Record<string, ArvoHandlerUnderTest>;
  /** How it should misbehave. */
  chaos?: Partial<ArvoChaos>;
  /** What the lattice calls the time, so days may pass in microseconds. */
  clock?: { now: () => number };
  /** What decides every random choice, so a failure can be run again. */
  seed?: number;
  /**
   * Whether this lattice gives up on an execution it will not retry.
   *
   * Policy rather than protocol: a fault carries what giving up would
   * take, and what a mechanism does with one it will not retry is its
   * own. A lattice that always gives up ends an execution that was merely
   * sent a stray event; one that never does leaves it waiting for the
   * answer it is owed. Both are conformant, and they are different
   * deployments.
   */
  abandons?: boolean;
  /**
   * Layers the lattice supplies with every delivery, as a mechanism
   * would: outside whatever the handler declares.
   */
  middleware?: readonly ArvoEventHandlerMiddlewareEntry[];
};

/** A deterministic source of chance, so a failing run can be repeated. */
export { chanceFrom } from './chance.js';

/** The contract and version an event's `dataschema` names. */
const dataschemaParts = (event: ArvoEvent) => {
  const lastSlash = event.dataschema.lastIndexOf('/');
  return {
    uri: event.dataschema.slice(0, lastSlash),
    version: event.dataschema.slice(lastSlash + 1),
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
    died: [],
    fromExecutions: new Set(),
  };

  /** What each execution's record is now, as the store holds it. */
  readonly store = new Map<string, JSONObject>();

  /** What is waiting off the lattice, by the path it was lifted to. */
  readonly parked = new Map<string, ArvoEvent[]>();

  readonly #versions: ArvoVersionsUnderTest;
  readonly #middleware: readonly ArvoEventHandlerMiddlewareEntry[] | null;
  readonly #handlers: Record<string, ArvoHandlerUnderTest>;
  readonly #chaos: ArvoChaos;
  readonly #clock: { now: () => number };
  readonly #chance: () => number;
  readonly #abandons: boolean;
  readonly #serializer = new ArvoEventSerializer({ type: 'arvoevent' });
  readonly #behaviours = new Map<string, ArvoBehaviour<never>>();
  readonly #attempts = new Map<string, number>();
  readonly #conflictRetries = new Map<string, number>();
  readonly #lostContractTypes = new Set<string>();
  #queue: ArvoEvent[] = [];
  #unpublished: ArvoEvent[] = [];

  constructor(param: ArvoLatticeParam) {
    this.#versions = param.versions;
    this.#handlers = param.handlers ?? {};
    this.#chaos = { ...NO_CHAOS, ...param.chaos };
    this.#clock = param.clock ?? { now: () => Date.now() };
    this.#chance = chanceFrom(param.seed ?? 1);
    this.#abandons = param.abandons ?? true;
    this.#middleware = param.middleware ?? null;
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
      const parkedEvents = this.parked.get(event.domain) ?? [];
      parkedEvents.push(event);
      this.parked.set(event.domain, parkedEvents);
      return this;
    }

    if (this.#chaos.drop > 0 && this.#chance() < this.#chaos.drop) return this;

    this.#queue.push(event);
    for (let copy = 0; copy < this.#chaos.duplicate; copy += 1) {
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
    const parkedEvents = this.parked.get(domain) ?? [];
    this.parked.set(domain, []);
    return parkedEvents;
  }

  /** Whatever is parked on one path, answered by something outside. */
  fulfil(
    domain: string,
    answer: (parkedEvent: ArvoEvent) => ArvoEvent | null,
  ): this {
    for (const parkedEvent of this.take(domain)) {
      const reply = answer(parkedEvent);
      if (reply !== null) this.inject(reply);
    }
    return this;
  }

  /** Some fraction of what is parked on one path, never answered. */
  forget(domain: string, fraction: number): ArvoEvent[] {
    const parkedEvents = this.take(domain);
    const stillParked = parkedEvents.filter(() => this.#chance() >= fraction);
    this.parked.set(domain, stillParked);
    return parkedEvents.filter((event) => !stillParked.includes(event));
  }

  /** The record one execution stands at, as the store holds it. */
  stored(executionId: string): JSONObject | null {
    return this.store.get(executionId) ?? null;
  }

  /**
   * Nothing addressed to this contract is ever delivered.
   *
   * A broker that loses one queue, which is how an execution comes to
   * wait on something that was never asked.
   */
  lose(contractType: string): this {
    this.#lostContractTypes.add(contractType);
    return this;
  }

  /** Whatever was lost to this contract is delivered again. */
  deliverAgain(contractType: string): this {
    this.#lostContractTypes.delete(contractType);
    return this;
  }

  /** One event delivered, and nothing of what it causes. */
  async step(): Promise<this> {
    const event = this.#nextEvent();
    if (event !== undefined) await this.#deliver(event);
    return this;
  }

  /** Runs every event the lattice holds, and everything they cause. */
  async settle(stepBudget = 50_000): Promise<this> {
    let steps = 0;
    while (this.#queue.length > 0) {
      steps += 1;
      if (steps > stepBudget) {
        throw new Error(
          `this lattice did not settle within ${stepBudget} steps`,
        );
      }
      const event = this.#nextEvent();
      if (event !== undefined) await this.#deliver(event);
    }
    return this;
  }

  /** Whichever event is next, which under chaos is not the first. */
  #nextEvent(): ArvoEvent | undefined {
    if (!this.#chaos.shuffle) return this.#queue.shift();
    const index = Math.floor(this.#chance() * this.#queue.length);
    const [event] = this.#queue.splice(index, 1);
    return event;
  }

  /**
   * Who would run this event, against what, or nothing where no handler
   * of this lattice would be given it at all.
   *
   * Everything a mechanism settles before a version is reached:
   * classification, the execution the event names, the record under it,
   * and which version owns that record.
   */
  async #routeFor(event: ArvoEvent) {
    if (event.to !== null && this.#lostContractTypes.has(event.to)) return null;

    const versions = event.to === null ? undefined : this.#versions[event.to];
    if (versions === undefined) return null;

    const schema = dataschemaParts(event);
    const self = Object.values(versions)[0]?.contracts.self;
    const entry: 'init' | 'followup' =
      self !== undefined && schema.uri === self.uri && event.type === self.type
        ? 'init'
        : 'followup';

    const executionId =
      entry === 'init' ? await deriveArvoExecutionId(event) : event.executionid;

    const record = this.stored(executionId);
    if (entry === 'init' && record !== null) return null;
    if (entry === 'followup' && record === null) return null;

    const version =
      entry === 'init'
        ? versions[schema.version]
        : versions[String(record?.version)];
    if (version === undefined) return null;

    return { version, entry, executionId, record };
  }

  /** One event, through everything a mechanism owns, to a version and back. */
  async #deliver(event: ArvoEvent): Promise<void> {
    const handler = event.to === null ? undefined : this.#handlers[event.to];
    if (handler !== undefined) {
      if (this.#lostContractTypes.has(event.to as string)) return;
      return this.#deliverWhole(handler, event);
    }

    const route = await this.#routeFor(event);
    if (route === null) return;

    const { executionId } = route;
    const attemptKey = `${executionId}:${event.id}`;
    const attempt = this.#attempts.get(attemptKey) ?? 0;
    this.transcript.delivered.push({ event, executionId, attempt });

    // The process dies with the work half done: nothing committed,
    // nothing published, and nothing anywhere recording that it ran. A
    // mechanism notices only that the event was never acknowledged, and
    // delivers it again.
    const diesMidExecution =
      this.#chaos.crashMidExecution > 0 &&
      this.#chance() < this.#chaos.crashMidExecution;
    if (diesMidExecution) {
      this.transcript.died.push({ event, executionId });
      this.#queue.push(event);
      return;
    }

    try {
      const response = await this.#run(route, event, attempt);
      if (response.kind === 'discarded') {
        this.transcript.discarded.push({ event, reason: response.reason });
        return;
      }
      this.#commit(executionId, event, response.state, response.events);
    } catch (error_) {
      await this.#onFault(event, executionId, attemptKey, attempt, error_);
    }
  }

  /**
   * One event handed to a handler whole.
   *
   * Nothing is settled first. Which execution the event concerns, and
   * whether there is one, are answers only the handler has — so the
   * execution it turns out to be about is read off what comes back.
   */
  async #deliverWhole(
    handler: ArvoHandlerUnderTest,
    event: ArvoEvent,
  ): Promise<void> {
    const attemptKey = event.id;
    const attempt = this.#attempts.get(attemptKey) ?? 0;

    const diesMidExecution =
      this.#chaos.crashMidExecution > 0 &&
      this.#chance() < this.#chaos.crashMidExecution;
    if (diesMidExecution) {
      this.transcript.died.push({ event, executionId: 'unknown' });
      this.#queue.push(event);
      return;
    }

    try {
      const response = await handler.execute({
        event,
        state: ({ executionId }) => this.stored(executionId),
        attempt,
        dependencies: heldDependencies({
          behave: this.#behaviours.get(event.to as string),
        }).dependency,
        hooks: {},
        ...(this.#middleware === null ? {} : { middleware: this.#middleware }),
      });

      if (response.kind === 'discarded') {
        this.transcript.discarded.push({ event, reason: response.reason });
        return;
      }

      const executionId = String(response.state.executionId);
      this.transcript.delivered.push({ event, executionId, attempt });
      this.#commit(executionId, event, response.state, response.events);
    } catch (error_) {
      const faultExecutionId =
        error_ instanceof ArvoHandlerFault && error_.executionId !== null
          ? error_.executionId
          : 'unplaced';
      await this.#onFault(
        event,
        faultExecutionId,
        `${faultExecutionId}:${event.id}`,
        attempt,
        error_,
      );
    }
  }

  /** One execution, against the record whoever routed it read. */
  async #run(
    route: NonNullable<Awaited<ReturnType<ArvoLattice['routeOf']>>>,
    event: ArvoEvent,
    attempt: number,
  ): Promise<ArvoEventHandlerExecuteResponse> {
    return (await route.version.execute({
      entry: route.entry,
      event,
      state: route.record,
      executionId: route.executionId,
      attempt,
      dependencies: heldDependencies({
        behave: this.#behaviours.get(event.to as string),
      }).dependency,
      hooks: {},
      telemetry: this.#telemetry(),
    } as never)) as ArvoEventHandlerExecuteResponse;
  }

  /** What `#routeFor` answers, so a test may hold one. */
  async routeOf(event: ArvoEvent) {
    return this.#routeFor(event);
  }

  /**
   * One event given to two handlers at the same moment.
   *
   * Both read the record before either writes one, so neither can see
   * the other's work, and both run their executor through to the end.
   * Only then do they try to commit, in the order they finished.
   *
   * This is two consumers on one queue, which is the ordinary shape of a
   * deployment rather than an exotic failure.
   */
  async deliverTogether(event: ArvoEvent): Promise<this> {
    const route = await this.#routeFor(event);
    if (route === null) return this;

    const attemptKey = `${route.executionId}:${event.id}`;
    const attempt = this.#attempts.get(attemptKey) ?? 0;
    for (const _ of [0, 1]) {
      this.transcript.delivered.push({
        event,
        executionId: route.executionId,
        attempt,
      });
    }

    // both against the same record, neither having written anything, and
    // each raising whatever it raises on its own account
    const executions = await Promise.all(
      [0, 1].map(async () => {
        try {
          return { response: await this.#run(route, event, attempt) };
        } catch (error_) {
          return { thrown: error_ };
        }
      }),
    );

    for (const execution of executions) {
      if ('thrown' in execution) {
        await this.#onFault(
          event,
          route.executionId,
          attemptKey,
          attempt,
          execution.thrown,
        );
        continue;
      }
      if (execution.response.kind === 'discarded') {
        this.transcript.discarded.push({
          event,
          reason: execution.response.reason,
        });
        continue;
      }
      this.#commit(
        route.executionId,
        event,
        execution.response.state,
        execution.response.events,
      );
    }
    return this;
  }

  /** The record and its events, together or not at all. */
  #commit(
    executionId: string,
    event: ArvoEvent,
    row: JSONObject,
    emitted: readonly ArvoEvent[],
  ): void {
    // Against what the store holds now, not against what this delivery
    // read: another may have written in between, which is the whole of
    // what comparing and swapping is for.
    const storedRecord = this.stored(executionId);
    const expectedCasVersion =
      storedRecord === null ? 0 : Number(storedRecord.casVersion) + 1;
    const raceLost =
      this.#chaos.loseRace > 0 && this.#chance() < this.#chaos.loseRace;

    if (raceLost || Number(row.casVersion) !== expectedCasVersion) {
      // What a mechanism does with the delivery that lost: it ran against
      // a record that has since moved, so it runs again against the one
      // that is there now. Nothing it produced is published.
      this.transcript.conflicts.push({ executionId, event });
      const retries = this.#conflictRetries.get(event.id) ?? 0;
      if (retries < 20) {
        this.#conflictRetries.set(event.id, retries + 1);
        this.#queue.push(event);
      }
      return;
    }

    this.store.set(executionId, row);
    this.transcript.committed.push({ executionId, row });

    // Noted as this execution's as it is committed, not as it is
    // published: an event held back by a crash is still one an execution
    // produced, and recovery sends the very bytes that were committed.
    for (const emittedEvent of emitted) {
      this.transcript.fromExecutions.add(emittedEvent.id);
    }

    const crashesBeforePublish =
      this.#chaos.crashBeforePublish > 0 &&
      this.#chance() < this.#chaos.crashBeforePublish;
    if (crashesBeforePublish) {
      this.#unpublished.push(...emitted);
      return;
    }
    for (const emittedEvent of emitted) this.publish(emittedEvent);
  }

  /** What was committed but never published, sent on recovery. */
  recover(): this {
    const unpublished = this.#unpublished;
    this.#unpublished = [];
    for (const emittedEvent of unpublished) this.publish(emittedEvent);
    return this;
  }

  /** A fault: retried where the fault says so, else abandoned with its pair. */
  async #onFault(
    event: ArvoEvent,
    executionId: string,
    attemptKey: string,
    attempt: number,
    thrown: unknown,
  ): Promise<void> {
    const fault = thrown as ArvoHandlerFault;
    if (fault?._tag !== 'ArvoHandlerFault') throw thrown;
    this.transcript.faults.push({ event, fault });

    if (fault.retry !== null) {
      this.#attempts.set(attemptKey, attempt + 1);
      this.#queue.push(event);
      return;
    }

    if (!this.#abandons) return;

    // A lattice that repeats itself must not treat its own repeat as a
    // failure. An opening event arriving at an execution that already
    // exists says this delivery has been seen, not that the work went
    // wrong — and telling the caller it failed while it is still running
    // is the one outcome worse than silence. Policy rather than
    // protocol: the fault carries the answer either way, and whether to
    // send it is a deployment's own.
    if (fault.faultKind === 'record_unexpected') return;

    this.transcript.abandoned.push({ executionId, fault });
    if (fault.abandonmentState !== null) {
      this.store.set(executionId, JSON.parse(fault.abandonmentState));
      this.transcript.committed.push({
        executionId,
        row: JSON.parse(fault.abandonmentState),
      });
    }
    if (fault.abandonmentEvent !== null) {
      const abandonmentEvent = await this.#serializer.tryDeserialize(
        fault.abandonmentEvent,
      );
      if (abandonmentEvent.ok) {
        this.transcript.fromExecutions.add(abandonmentEvent.value.id);
        this.publish(abandonmentEvent.value);
      }
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
    return this.#unpublished.length;
  }

  /** What the lattice calls the time. */
  get now(): number {
    return this.#clock.now();
  }
}

/** A lattice to run executions in, and to make misbehave. */
export const createArvoLattice = (param: ArvoLatticeParam): ArvoLattice =>
  new ArvoLattice(param);
