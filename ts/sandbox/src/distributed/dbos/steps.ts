import { DBOS } from '@dbos-inc/dbos-sdk';
import {
  type ArvoEvent,
  ArvoEventSerializer,
  type ArvoHandlerFault,
  type JSONObject,
} from 'arvo-core';
import type { Pool } from 'pg';
import { HANDLERS } from '../handler/index.js';
import { withDeliveryIdentity } from '../handler/log-context.js';
import { PostgresCatalogue } from '../shared/catalogue.js';
import { deliveryMiddleware } from '../shared/delivery-middleware.js';
import type { RecordStore } from '../shared/record-store.js';
import { destinationFor } from '../shared/routing.js';
import { needsAPerson } from './needs-a-person.js';
import type { DeliveryReport } from './protocol.js';

/**
 * One delivery, as a DBOS step.
 *
 * Everything Arvo-specific in this mechanism is here. The workflow above
 * carries what this hands back and decides nothing about it; the handler
 * below knows nothing of DBOS.
 *
 * A step is the unit DBOS makes durable: its return value is written to
 * the system database, so a workflow replayed after a crash is handed
 * what the step returned rather than running it again. That is the same
 * property Temporal gives an activity, and it is why neither mechanism
 * requires a handler to be deterministic.
 */

/** The format an event crosses a boundary in, and is stored in. */
const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/** What the steps reach, built once per worker. */
export type StepScope = {
  /** Where records and the events committed with them go. */
  readonly store: RecordStore;
  /**
   * Where the handlers' own data comes from.
   *
   * Nothing of this mechanism is kept here. A handler asks for a
   * catalogue through the dependency and this is what answers, on a
   * connection taken for one execution and given back with it.
   */
  readonly pool: Pool;
};

/** The execution a record belongs to, read off the document. */
const executionOf = (state: JSONObject): string | null =>
  typeof state.executionId === 'string' ? state.executionId : null;

/** Where a record rests, read off the document. */
const lifecycleOf = (state: JSONObject): string | null =>
  typeof state.lifecycle === 'string' ? state.lifecycle : null;

/**
 * This delivery lost a race and was never carried out, so it has to be
 * made again.
 *
 * Losing a commit takes two forms and they are not the same. Where a
 * revision names this delivery's triggering event, the delivery already
 * succeeded once and what the world is told is what it committed then.
 * Where none does, the record moved on under a *different* delivery and
 * this one has not happened at all — so it must be made again against
 * the record as it now stands. Reporting nothing instead would drop the
 * event, and obligation 1 does not allow an event to be dropped once its
 * record is committed.
 *
 * Carried as an error rather than an outcome because making it again is
 * what a mechanism is for: DBOS retries the step, the handler reads the
 * record as it now stands, and the answer is collected into it.
 */
export class RecordMovedOn extends Error {
  constructor(executionId: string, triggeringEventId: string) {
    super(
      `execution ${executionId} moved on while ${triggeringEventId} was being carried out, so this delivery has to be made again against the record as it now stands`,
    );
    this.name = 'RecordMovedOn';
  }
}

/** Nothing to do, because this delivery's work was already done. */
const nothingToDo = (note: string): DeliveryReport => ({
  outcome: 'nothing',
  executionId: null,
  lifecycle: null,
  emitted: [],
  note,
});

/**
 * What a delivery already carried out hands back.
 *
 * The bytes its first attempt committed, read out of the outbox.
 * Nothing is produced a second time, and nothing is dropped — which is
 * what obligation 1 requires of an event once its record is committed.
 */
const republish = async (
  scope: StepScope,
  executionId: string | null,
  triggeringEvent: ArvoEvent,
  note: string,
): Promise<DeliveryReport> => {
  if (executionId === null) return nothingToDo(note);

  const committed = await scope.store.committedFor(
    executionId,
    triggeringEvent.id,
  );
  if (committed.length === 0) return nothingToDo(note);

  const record = await scope.store.readRecord(executionId);

  return {
    outcome: 'recovered',
    executionId,
    lifecycle: record === null ? null : lifecycleOf(record),
    emitted: committed.map((one) => one.payload),
    note,
  };
};

/**
 * What a delivery that lost the race hands back, or why it must be made
 * again.
 *
 * @throws {RecordMovedOn} Where no revision names this delivery's
 * triggering event, this delivery never having been carried out.
 */
const converged = async (
  scope: StepScope,
  executionId: string,
  triggeringEvent: ArvoEvent,
  note: string,
): Promise<DeliveryReport> => {
  const committed = await scope.store.committedFor(
    executionId,
    triggeringEvent.id,
  );
  if (committed.length === 0) {
    throw new RecordMovedOn(executionId, triggeringEvent.id);
  }

  return republish(scope, executionId, triggeringEvent, note);
};

/**
 * What a fault no further attempt will fix leaves behind.
 *
 * A fault carries both halves of an abandonment, the event alone, or
 * neither, and each is acted on as it stands — nothing of the
 * mechanism's own is added
 * (`docs/adr/008-execution-faults-and-abandonment.md`).
 */
const giveUp = async (
  scope: StepScope,
  fault: ArvoHandlerFault,
  triggeringEvent: ArvoEvent,
): Promise<DeliveryReport> => {
  const note = `${fault.faultKind}: ${fault.message}`;

  const abandonmentEvent =
    fault.abandonmentEvent === null
      ? null
      : await WIRE.deserialize(fault.abandonmentEvent);

  // Neither half. There is nothing to commit and nobody to tell — the
  // execution either answered its caller already or never had a record
  // to carry one.
  //
  // Nothing to tell is not nothing to record. A fault no attempt will
  // fix has to land where a person can find it rather than in a log, so
  // the event that caused it goes to the table with the reason. This is
  // the only contingency where that is all there is to keep, which is
  // exactly why it is the one most easily dropped.
  if (fault.abandonmentState === null && abandonmentEvent === null) {
    await needsAPerson(scope.pool, {
      event: triggeringEvent,
      payload: await WIRE.serialize(triggeringEvent),
      why: 'nothing_will_retry',
      executionId: fault.executionId,
      message: note,
    });
    return nothingToDo(note);
  }

  // The event alone, there being no record to carry it. Nothing for it
  // to be kept together with, so it goes on its own — and a copy goes
  // where a person can find it, nothing being left to retry it.
  if (fault.abandonmentState === null) {
    if (abandonmentEvent === null) return nothingToDo(note);

    // The bytes the fault carried, not bytes built again from the event:
    // what a person reads must be what was abandoned.
    const abandoned = fault.abandonmentEvent as string;

    await needsAPerson(scope.pool, {
      event: abandonmentEvent,
      payload: abandoned,
      why: 'nothing_will_retry',
      executionId: fault.executionId,
      message: note,
    });

    return {
      outcome: 'produced',
      executionId: fault.executionId,
      lifecycle: null,
      emitted: [abandoned],
      note,
    };
  }

  const record = JSON.parse(fault.abandonmentState) as JSONObject;
  const executionId = executionOf(record);
  if (executionId === null) {
    throw new Error(
      'the abandonment record names no execution, so there is nowhere to commit it',
    );
  }

  const events = abandonmentEvent === null ? [] : [abandonmentEvent];
  const outcome = await scope.store.commit({ record, events });

  if (!outcome.committed) {
    return converged(scope, executionId, triggeringEvent, note);
  }

  return {
    outcome: 'produced',
    executionId,
    lifecycle: lifecycleOf(record),
    emitted: await Promise.all(events.map((one) => WIRE.serialize(one))),
    note,
  };
};

/**
 * Delivers one event to the handler it is addressed to, and commits
 * whatever that produced.
 *
 * @param scope - Where records go and where the handlers' data is.
 * @param payload - The event, in the event's own format.
 * @returns What happened, and everything committed, for the loop to sort.
 * @throws {ArvoHandlerFault} Where a fault says a further attempt is in
 * prospect, so that DBOS makes one.
 */
const deliver = async (
  scope: StepScope,
  payload: string,
): Promise<DeliveryReport> => {
  const triggeringEvent = await WIRE.deserialize(payload);
  const destination = destinationFor(triggeringEvent);

  if (destination.kind !== 'handled') {
    // Routed here wrongly rather than failed: no attempt fixes it.
    throw new Error(`nothing here implements ${triggeringEvent.to}`);
  }

  // DBOS counts attempts from one and Arvo from zero. A step called
  // outside a workflow has no status at all, which is a plain first
  // attempt.
  const attempt = (DBOS.stepStatus?.currentAttempt ?? 1) - 1;

  // Every line this delivery logs carries which delivery it was, so one
  // execution can be followed in a log store without joining to a trace.
  const executed = await withDeliveryIdentity(
    {
      subject: triggeringEvent.subject,
      handler: destination.handler.contracts.self.type,
      triggeringEventId: triggeringEvent.id,
      attempt,
    },
    () =>
      destination.handler.tryExecute({
        event: triggeringEvent,
        // The handler says which execution to read; nothing here works
        // one out. Read on every invocation, so a retry sees what is
        // stored now rather than what an earlier attempt read.
        state: ({ executionId }) => scope.store.readRecord(executionId),
        attempt,
        // Opened before the executor and closed after it, by the
        // handler, so nothing here holds a connection to remember to
        // give back.
        dependencies: new PostgresCatalogue(scope.pool),
        // Outside the handlers' own layers, as ADR-016 orders them.
        middleware: deliveryMiddleware('dbos', triggeringEvent),
      }),
  );

  if (!executed.ok) {
    const fault = executed.error;

    // An opening event for an execution that already exists is a
    // redelivery, not a failure. Treating it as one would publish a
    // handler error for work that succeeded — and the events its first
    // delivery committed still have to reach their destinations.
    if (fault.faultKind === 'record_unexpected') {
      return republish(
        scope,
        fault.executionId,
        triggeringEvent,
        'this event had already been executed',
      );
    }

    // Raised rather than reported, so DBOS decides whether to attempt
    // again — and `shouldRetry` below reads the same fault to answer.
    if (fault.retry !== null) throw fault;

    return giveUp(scope, fault, triggeringEvent);
  }

  // Already processed, which only an answer can be: an opening event for
  // an existing execution is refused above.
  if (executed.value.kind === 'discarded') {
    return republish(
      scope,
      triggeringEvent.executionid,
      triggeringEvent,
      executed.value.reason,
    );
  }

  const record = executed.value.state;
  const executionId = executionOf(record);
  if (executionId === null) {
    throw new Error(
      'this record names no execution, so there is nowhere to commit it',
    );
  }

  const outcome = await scope.store.commit({
    record,
    events: executed.value.events,
  });

  if (!outcome.committed) {
    return converged(
      scope,
      executionId,
      triggeringEvent,
      `another writer committed first: ${outcome.because}`,
    );
  }

  return {
    outcome: 'produced',
    executionId,
    lifecycle: lifecycleOf(record),
    emitted: await Promise.all(
      executed.value.events.map((one) => WIRE.serialize(one)),
    ),
    note: null,
  };
};

/**
 * Whether a failure is one another attempt could fix.
 *
 * Declared rather than inherited, and declared to agree with the fault
 * rather than with a policy of this mechanism's own: an Arvo fault
 * already carries the verdict, and a mechanism that retried on its own
 * schedule would be overruling the handler about its own failure
 * (`docs/adr/009-execution-bounds.md`).
 *
 * Anything that is not an Arvo fault is not retried. A step that failed
 * for a reason the protocol has no opinion about is a defect in this
 * mechanism, and retrying a defect only makes it slower.
 */
const worthAnotherAttempt = (raised: unknown): boolean => {
  // A delivery that lost a race was never carried out. Another attempt
  // is not merely worth making, it is the only thing that keeps the
  // event from being lost.
  if (raised instanceof RecordMovedOn) return true;

  return (
    typeof raised === 'object' &&
    raised !== null &&
    'retry' in raised &&
    (raised as { retry: unknown }).retry !== null
  );
};

/**
 * Every step DBOS may run: one per handler, each named after the
 * contract that handler implements.
 *
 * Naming them this way is the difference between a trace that says
 * which handler ran and one that says something ran. It is also why the
 * registration happens once per worker rather than once per delivery —
 * DBOS keys a step's durable record by its name.
 *
 * @param scope - Where records go and where the handlers' data is.
 */
export const createSteps = (
  scope: StepScope,
): Record<string, (payload: string) => Promise<DeliveryReport>> =>
  Object.fromEntries(
    Object.keys(HANDLERS).map((contractType) => [
      contractType,
      DBOS.registerStep((payload: string) => deliver(scope, payload), {
        name: contractType,
        retriesAllowed: true,
        shouldRetry: worthAnotherAttempt,
        // Generous, because the fault decides: a step that stops being
        // worth attempting says so through `shouldRetry` long before
        // this is reached, and this only bounds a failure that keeps
        // claiming another attempt is in prospect.
        maxAttempts: 16,
        intervalSeconds: 1,
        backoffRate: 2,
      }),
    ]),
  );

/** What the loop sees of the steps: one per handler, by its own name. */
export type Steps = Record<
  string,
  (payload: string) => Promise<DeliveryReport>
>;

/** Why an event is being left for a person, where the loop decides it. */
export type ParkedForAPerson = 'left_the_lattice' | 'addressed_outside';

/**
 * Leaves one event where a person can find it, as a step.
 *
 * A step because it writes, and a workflow that wrote directly would
 * write again on every replay. The table holds one row per event, not
 * one per attempt at remembering it.
 *
 * Deliberately not part of {@link createSteps}'s map. That map is keyed
 * by contract type and the loop looks an address up in it, so anything
 * in it that is not a handler is an address an event could be routed to.
 *
 * @param scope - Where the table is.
 */
export const createParkStep = (
  scope: StepScope,
): ((payload: string, why: ParkedForAPerson) => Promise<void>) =>
  DBOS.registerStep(
    async (payload: string, why: ParkedForAPerson) => {
      const event = await WIRE.deserialize(payload);
      await needsAPerson(scope.pool, {
        event,
        payload,
        why,
        executionId: event.executionid,
        message: null,
      });
    },
    { name: 'arvo.needs_a_person', retriesAllowed: true, maxAttempts: 4 },
  );
