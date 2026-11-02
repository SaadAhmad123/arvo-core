import type { Span } from '@opentelemetry/api';
import type { ArvoEvent } from '../ArvoEvent/index.js';
import type { ArvoTelemetryParam } from '../ArvoEventHandler/context/telemetry/resolve.js';
import type { IArvoOutbox } from '../ArvoOutbox/interface.js';
import type { ArvoOutboxCommittedEventRecord } from '../ArvoOutbox/types/event-record.js';
import type {
  ArvoOutboxEventsFilter,
  ArvoOutboxUnseenEventsParam,
} from '../ArvoOutbox/types/read.js';
import type { JSONObject } from '../types.js';

/**
 * What an {@link ArvoOutboxDriver} is built with: the one outbox it calls.
 * Nothing else may call that outbox once the driver holds it.
 *
 * @example
 * ```typescript
 * const param: ArvoOutboxDriverParam = { outbox: new ArvoMemoryOutbox() };
 * ```
 */
export type ArvoOutboxDriverParam = {
  /** The outbox the driver calls, and the only party that calls it. */
  readonly outbox: IArvoOutbox;
};

/**
 * The telemetry one call of {@link ArvoOutboxDriver} records with, and the
 * span its own span is a child of. Left out, the call records with the
 * tracer registered for the application, as a child of whatever span is
 * active where it is called.
 *
 * @example
 * ```typescript
 * const param: ArvoOutboxDriverCallParam = { telemetry: { tracer }, span: parentSpan };
 * ```
 */
export type ArvoOutboxDriverCallParam = {
  /** The tracer, meter and logger for this call alone. */
  readonly telemetry?: ArvoTelemetryParam;
  /** The span this call's span is a child of; the active one where left out. */
  readonly span?: Span;
};

/**
 * Which execution's latest state to read.
 *
 * @example
 * ```typescript
 * const param: ArvoOutboxDriverReadLatestStateParam = { executionId };
 * ```
 */
export type ArvoOutboxDriverReadLatestStateParam = ArvoOutboxDriverCallParam & {
  /** The execution to read. */
  readonly executionId: string;
};

/**
 * One execution record and the events produced with it, to commit together.
 *
 * `state` is the record as the handler produced it. It must carry
 * `executionId`, `subject`, `source`, `version` and `lifecycle` as non-empty
 * strings and `casVersion` as a whole number zero or more; the driver lifts
 * them beside the record, and throws {@link ArvoOutboxDriverValidationError}
 * where any is missing. The record is otherwise passed on as given.
 *
 * @example
 * ```typescript
 * const param: ArvoOutboxDriverCommitStateAndEventsParam = {
 *   state: response.state,
 *   events: response.events,
 *   triggeringEvent,
 * };
 * ```
 */
export type ArvoOutboxDriverCommitStateAndEventsParam =
  ArvoOutboxDriverCallParam & {
    /** The execution record the handler produced. */
    readonly state: JSONObject;
    /** The live events produced with it. */
    readonly events: readonly ArvoEvent[];
    /** The delivered event they answer. */
    readonly triggeringEvent: ArvoEvent;
  };

/**
 * Events to commit with no execution record, each stored with no revision.
 *
 * @example
 * ```typescript
 * const param: ArvoOutboxDriverCommitEventsParam = { events, triggeringEvent };
 * ```
 */
export type ArvoOutboxDriverCommitEventsParam = ArvoOutboxDriverCallParam & {
  /** The live events to commit. */
  readonly events: readonly ArvoEvent[];
  /** The delivered event they answer. */
  readonly triggeringEvent: ArvoEvent;
};

/**
 * What to ask the outbox's capacity for: what would be committed with a
 * record, what would be committed alone, or nothing.
 *
 * The driver asks the outbox only with the facts of it: the number of events
 * and the record's `casVersion`, the number of events alone, or, given
 * nothing, one event and a state at the first revision. A record must carry
 * what {@link ArvoOutboxDriverCommitStateAndEventsParam} says it must.
 *
 * @example
 * ```typescript
 * const param: ArvoOutboxDriverCapacityParam = { events, triggeringEvent };
 * ```
 */
export type ArvoOutboxDriverCapacityParam =
  | ArvoOutboxDriverCommitStateAndEventsParam
  | ArvoOutboxDriverCommitEventsParam
  | ArvoOutboxDriverCallParam;

/**
 * Whether a read restores each stored payload to a live event. On where left
 * out. Turn it off where only the stored payload is needed, such as to hand
 * it to a queue as it is.
 *
 * @example
 * ```typescript
 * const param: ArvoOutboxDriverRestoreParam = { restoreEvents: false };
 * ```
 */
export type ArvoOutboxDriverRestoreParam = {
  /** Whether to restore each payload; on where left out. */
  readonly restoreEvents?: boolean;
};

/**
 * Which committed events to read, and whether to restore them.
 *
 * @example
 * ```typescript
 * const param: ArvoOutboxDriverReadCommittedEventsParam = {
 *   filter: { triggeringEventId },
 * };
 * ```
 */
export type ArvoOutboxDriverReadCommittedEventsParam =
  ArvoOutboxDriverCallParam &
    ArvoOutboxDriverRestoreParam & {
      /** Which events. See {@link ArvoOutboxEventsFilter}. */
      readonly filter: ArvoOutboxEventsFilter;
    };

/**
 * Which unseen events to list, and whether to restore them. `atMost`,
 * `olderThanMs` and `leaseMs` are passed to the outbox as they are; see
 * {@link ArvoOutboxUnseenEventsParam}.
 *
 * @example
 * ```typescript
 * const param: ArvoOutboxDriverListUnseenEventsParam = {
 *   atMost,
 *   olderThanMs,
 *   restoreEvents: false,
 * };
 * ```
 */
export type ArvoOutboxDriverListUnseenEventsParam = ArvoOutboxDriverCallParam &
  ArvoOutboxDriverRestoreParam &
  ArvoOutboxUnseenEventsParam;

/**
 * Which events to mark seen, once a queue has accepted them.
 *
 * @example
 * ```typescript
 * const param: ArvoOutboxDriverMarkEventsSeenParam = { eventIds };
 * ```
 */
export type ArvoOutboxDriverMarkEventsSeenParam = ArvoOutboxDriverCallParam & {
  /** The events a queue has accepted. */
  readonly eventIds: readonly string[];
};

/**
 * One committed event as a read of {@link ArvoOutboxDriver} answers it: the
 * record as stored, beside the live event its payload holds, or `null` where
 * the read did not restore it.
 *
 * @example
 * ```typescript
 * for (const entry of await driver.readCommittedEvents({ filter: { triggeringEventId } })) {
 *   entry.event; // the live event, restored
 * }
 * ```
 */
export type ArvoOutboxDriverEventEntry = {
  /** The event record, as the outbox stored it. */
  readonly record: ArvoOutboxCommittedEventRecord;
  /** The live event, or `null` where the read did not restore it. */
  readonly event: ArvoEvent | null;
};
