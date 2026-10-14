import {
  type ArvoEvent,
  ArvoEventSerializer,
  type ArvoHandlerFault,
  type JSONObject,
} from 'arvo-core';
import type { Pool } from 'pg';
import { PostgresCatalogue } from '../shared/catalogue.js';
import type { RecordStore } from '../shared/record-store.js';
import { destinationFor } from '../shared/routing.js';
import type { DeliveryReport } from './protocol.js';

/**
 * One delivery, against the record store and nothing else.
 *
 * The same work the Temporal adapter's activity does, written without a
 * framework: there is no durable execution here, no retry policy and no
 * history. That is deliberate. A mechanism this plain is the control
 * the others are read against — if a run comes out differently here,
 * the difference is the framework's and not the handler's.
 */

/** The format an event crosses a boundary in, and is stored in. */
const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/** What a delivery reaches. */
export type DeliveryScope = {
  /** Where records and their events are committed. */
  readonly store: RecordStore;
  /** Where the handlers' own data comes from, through the dependency. */
  readonly pool: Pool;
  /**
   * What the handler reads a record through, where it is not the store.
   *
   * A replay presents its own: the record a delivery is to be judged
   * against is the one the tape says it read, not whatever the replay
   * has committed so far. The state function being supplied rather than
   * owned is what makes that expressible at all — and it is the only
   * reason a run can be replayed against a handler whose emitted event
   * identifiers are its own.
   */
  readonly readRecord?: (executionId: string) => Promise<JSONObject | null>;
};

/** An event is addressed somewhere this mechanism cannot deliver it. */
export class UnroutableDelivery extends Error {
  constructor(addressedTo: string | null) {
    super(`nothing in this lattice implements ${addressedTo}`);
    this.name = 'UnroutableDelivery';
  }
}

/** A record names no execution, so there is nowhere to commit it. */
export class UnaddressableRecord extends Error {
  constructor() {
    super('this record names no execution, so there is nowhere to commit it');
    this.name = 'UnaddressableRecord';
  }
}

/** The execution a record belongs to, read off the document. */
const executionOf = (state: JSONObject): string | null =>
  typeof state.executionId === 'string' ? state.executionId : null;

/** Where a record rests, read off the document. */
const lifecycleOf = (state: JSONObject): string | null =>
  typeof state.lifecycle === 'string' ? state.lifecycle : null;

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
 * The bytes its first attempt committed, read out of the outbox. Nothing
 * is produced a second time, which is why no handler here has to be
 * deterministic — and nothing is dropped, which is what obligation 1
 * requires of an event once its record is committed.
 */
const republish = async (
  scope: DeliveryScope,
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
    lifecycle: record === null ? null : lifecycleOf(record as JSONObject),
    emitted: committed.map((one) => one.payload),
    note,
  };
};

/**
 * What a fault no further attempt will fix leaves behind.
 *
 * A fault carries both halves of an abandonment, the event alone, or
 * neither, and each is acted on as it stands — nothing of the
 * mechanism's own is added
 * (`docs/adr/008-arvoeventhandler-faults-and-abandonment.md`).
 */
const giveUp = async (
  scope: DeliveryScope,
  fault: ArvoHandlerFault,
  triggeringEvent: ArvoEvent,
): Promise<DeliveryReport> => {
  const note = `${fault.faultKind}: ${fault.message}`;

  const abandonmentEvent =
    fault.abandonmentEvent === null
      ? null
      : await WIRE.deserialize(fault.abandonmentEvent);

  // Neither half. The execution answered its caller already and rests
  // where it rests, so there is nothing to commit and nobody to tell.
  if (fault.abandonmentState === null && abandonmentEvent === null) {
    return nothingToDo(note);
  }

  // The event alone, there being no record to carry it. Nothing for it
  // to be kept together with, so it goes on its own.
  if (fault.abandonmentState === null) {
    return {
      outcome: 'produced',
      executionId: fault.executionId,
      lifecycle: null,
      emitted:
        abandonmentEvent === null
          ? []
          : [await WIRE.serialize(abandonmentEvent)],
      note,
    };
  }

  const state = JSON.parse(fault.abandonmentState) as JSONObject;
  const executionId = executionOf(state);
  if (executionId === null) throw new UnaddressableRecord();

  const events = abandonmentEvent === null ? [] : [abandonmentEvent];
  const outcome = await scope.store.commit({ record: state, events });

  if (outcome.committed) {
    return {
      outcome: 'produced',
      executionId,
      lifecycle: lifecycleOf(state),
      emitted: await Promise.all(events.map((one) => WIRE.serialize(one))),
      note,
    };
  }

  // Somebody else moved this record on. What this delivery committed, if
  // it ever did, is in the outbox; otherwise it has to be made again.
  return republish(scope, executionId, triggeringEvent, note);
};

/**
 * Delivers one event to the handler it is addressed to, and commits
 * whatever that produced.
 *
 * @param scope - Where records go and where the handlers' data is.
 * @param triggeringEvent - The event to deliver.
 * @param attempt - Which attempt this is, counting from 0, which the
 * handler is told so that a fault can say whether another is worth it.
 * @returns What happened, and everything committed.
 * @throws {ArvoHandlerFault} Where a fault says a further attempt is in
 * prospect, so that whatever is driving this decides whether to make one.
 */
export const deliverOnce = async (
  scope: DeliveryScope,
  triggeringEvent: ArvoEvent,
  attempt: number,
): Promise<DeliveryReport> => {
  const destination = destinationFor(triggeringEvent);
  if (destination.kind !== 'handled') {
    throw new UnroutableDelivery(triggeringEvent.to);
  }

  const executed = await destination.handler.tryExecute({
    event: triggeringEvent,
    // The handler says which execution to read; nothing here works one
    // out. Read on every invocation, so a retry sees what is stored now
    // rather than what an earlier attempt read.
    state: ({ executionId }) =>
      (scope.readRecord ?? scope.store.readRecord)(executionId),
    attempt,
    // Opened before the executor and closed after it, by the handler,
    // so nothing here holds a connection to remember to give back.
    dependencies: new PostgresCatalogue(scope.pool),
  });

  if (!executed.ok) {
    const fault = executed.error;

    // An opening event for an execution that already exists is a
    // redelivery, not a failure. The events its first delivery committed
    // still have to reach their destinations, and a redelivery arriving
    // is the only sign that they may not have.
    if (fault.faultKind === 'record_unexpected') {
      return republish(
        scope,
        fault.executionId,
        triggeringEvent,
        'this event had already been executed',
      );
    }

    // Raised rather than reported: whether another attempt is made is
    // not this delivery's to decide.
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
  if (executionId === null) throw new UnaddressableRecord();

  const outcome = await scope.store.commit({
    record,
    events: executed.value.events,
  });

  if (!outcome.committed) {
    return republish(
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

/** How many attempts one delivery gets before this mechanism gives up. */
const ATTEMPTS = 8;

/**
 * One delivery, attempted again while the fault says another attempt is
 * in prospect.
 *
 * The delay a fault names is deliberately not waited out. This
 * mechanism has no timers, and sleeping to pass a test is forbidden by
 * the standard this exercise is written to; what is under test is that
 * the attempt is made and that the handler reads the store again when it
 * is. Honouring the delay is a real mechanism's to do, and both
 * framework-backed ones here do.
 *
 * Replays go through this too. The attempt is an input a record does not
 * keep, so a handler that failed twice before being able to succeed does
 * that again — and a replay that gave up after one attempt would be
 * reading the handler as broken rather than as retried.
 *
 * @param scope - Where records go and where the handlers' data is.
 * @param event - The event to deliver.
 * @throws {ArvoHandlerFault} Where the attempts ran out, or where the
 * fault said no attempt would fix it.
 */
export const deliverWithRetries = async (
  scope: DeliveryScope,
  event: ArvoEvent,
): Promise<DeliveryReport> => {
  let attempt = 0;
  for (;;) {
    try {
      return await deliverOnce(scope, event, attempt);
    } catch (raised) {
      const fault = raised as Partial<ArvoHandlerFault>;
      if (fault.retry === null || fault.retry === undefined) throw raised;
      attempt += 1;
      if (attempt >= ATTEMPTS) throw raised;
    }
  }
};
