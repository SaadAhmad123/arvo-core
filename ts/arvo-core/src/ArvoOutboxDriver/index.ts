import type { Span } from '@opentelemetry/api';
import { err, ok } from 'neverthrow';
import type { IArvoOutbox } from '../ArvoOutbox/interface.js';
import type {
  ArvoOutboxCapacity,
  ArvoOutboxCapacityRequest,
} from '../ArvoOutbox/types/capacity.js';
import { fromNeverthrow } from '../result.js';
import { ArvoEventSerializer } from '../serializers/ArvoEventSerializer/index.js';
import type { AsyncResult, JSONObject } from '../types.js';
import { ArvoOutboxDriverError } from './errors.js';
import { buildCapacityRequest } from './helpers/build-capacity-request.js';
import { buildEventRecord } from './helpers/build-event-record.js';
import { callOutbox } from './helpers/call-outbox.js';
import { checkCapacity } from './helpers/check-capacity.js';
import { checkCommitOutcome } from './helpers/check-commit-outcome.js';
import { checkCommittedRecords } from './helpers/check-committed-records.js';
import { checkState } from './helpers/check-state.js';
import { liftCommitFields } from './helpers/lift-commit-fields.js';
import { recordCapacityQuestion } from './helpers/record-capacity-question.js';
import { restoreEntries } from './helpers/restore-entries.js';
import { runInSpan } from './helpers/run-in-span.js';
import type {
  ArvoOutboxDriverCallParam,
  ArvoOutboxDriverCapacityParam,
  ArvoOutboxDriverCommitEventsParam,
  ArvoOutboxDriverCommitStateAndEventsParam,
  ArvoOutboxDriverEventEntry,
  ArvoOutboxDriverListUnseenEventsParam,
  ArvoOutboxDriverMarkEventsSeenParam,
  ArvoOutboxDriverParam,
  ArvoOutboxDriverReadCommittedEventsParam,
  ArvoOutboxDriverReadLatestStateParam,
} from './types.js';

/**
 * The one party that calls an outbox: it builds everything the outbox
 * stores, checks everything it answers, and reports every failure as one
 * {@link ArvoOutboxDriverError} whose `kind` says why.
 *
 * On the way in, each live event is stored as its CloudEvent JSON, and the
 * fields a commit carries are lifted off the execution record, so the outbox
 * never opens either. On the way out, every answer is checked before it is
 * handed on, and each stored payload is restored to a live event unless the
 * read turns restoring off.
 *
 * Every commit asks the outbox's capacity first, and is not made where the
 * outbox answers `exhausted`. A commit stopped so, or refused, is reported
 * as an error, kind `capacity_exhausted`, `state_exists` or
 * `revision_stale`; anything the outbox throws is `unavailable`. The driver
 * calls the outbox once per operation, besides that question, and decides
 * nothing: it does not retry, re-read on a refusal, or build a fault. Each operation is a
 * `tryX` answering its failure as a value and an `X` throwing it, and opens
 * one span, a child of the span it is given or of the active one.
 *
 * @example
 * ```typescript
 * const driver = new ArvoOutboxDriver({ outbox: new ArvoMemoryOutbox() });
 * await driver.open();
 * const commitResult = await driver.tryCommitStateAndEvents({
 *   state: response.state,
 *   events: response.events,
 *   triggeringEvent,
 * });
 * if (!commitResult.ok) commitResult.error.kind; // 'revision_stale', ...
 * await driver.close();
 * ```
 */
export class ArvoOutboxDriver {
  readonly #outbox: IArvoOutbox;
  readonly #cloudEventSerializer: ArvoEventSerializer;

  /**
   * @param param - The outbox the driver calls. See {@link ArvoOutboxDriverParam}.
   */
  constructor(param: ArvoOutboxDriverParam) {
    this.#outbox = param.outbox;
    this.#cloudEventSerializer = new ArvoEventSerializer({
      type: 'cloudevent',
    });
  }

  /**
   * Opens the outbox, answering its failure as a value.
   *
   * @param param - The call's telemetry. See {@link ArvoOutboxDriverCallParam}.
   * @returns Nothing once open, or `unavailable` where the outbox could not open.
   */
  tryOpen(
    param: ArvoOutboxDriverCallParam = {},
  ): AsyncResult<void, ArvoOutboxDriverError> {
    return runInSpan({
      operationName: 'open',
      telemetry: param.telemetry,
      parentSpan: param.span,
      run: () => callOutbox('open', () => this.#outbox.open()),
    });
  }

  /**
   * {@link ArvoOutboxDriver.tryOpen}, throwing its error.
   *
   * @param param - The call's telemetry. See {@link ArvoOutboxDriverCallParam}.
   * @throws {ArvoOutboxDriverError} Kind `unavailable`, where the outbox could not open.
   */
  async open(param: ArvoOutboxDriverCallParam = {}): Promise<void> {
    const openResult = await this.tryOpen(param);
    if (!openResult.ok) throw openResult.error;
  }

  /**
   * Closes the outbox, answering its failure as a value.
   *
   * @param param - The call's telemetry. See {@link ArvoOutboxDriverCallParam}.
   * @returns Nothing once closed, or `unavailable` where the outbox could not close.
   */
  tryClose(
    param: ArvoOutboxDriverCallParam = {},
  ): AsyncResult<void, ArvoOutboxDriverError> {
    return runInSpan({
      operationName: 'close',
      telemetry: param.telemetry,
      parentSpan: param.span,
      run: () => callOutbox('close', () => this.#outbox.close()),
    });
  }

  /**
   * {@link ArvoOutboxDriver.tryClose}, throwing its error.
   *
   * @param param - The call's telemetry. See {@link ArvoOutboxDriverCallParam}.
   * @throws {ArvoOutboxDriverError} Kind `unavailable`, where the outbox could not close.
   */
  async close(param: ArvoOutboxDriverCallParam = {}): Promise<void> {
    const closeResult = await this.tryClose(param);
    if (!closeResult.ok) throw closeResult.error;
  }

  /**
   * The latest state of one execution, or none, checked to be a JSON object,
   * answering a failure as a value.
   *
   * @param param - Which execution. See {@link ArvoOutboxDriverReadLatestStateParam}.
   * @returns The state or `null`, or kind `unavailable` or `malformed_state`.
   */
  tryReadLatestState(
    param: ArvoOutboxDriverReadLatestStateParam,
  ): AsyncResult<JSONObject | null, ArvoOutboxDriverError> {
    const operationName = 'readLatestState';
    return runInSpan({
      operationName,
      telemetry: param.telemetry,
      parentSpan: param.span,
      run: async () => {
        const answerResult = await callOutbox(operationName, () =>
          this.#outbox.readLatestState(param.executionId),
        );
        if (!answerResult.ok) return answerResult;
        const stateResult = checkState(answerResult.value);
        if (!stateResult.ok) {
          return fromNeverthrow(
            err(
              new ArvoOutboxDriverError({
                kind: 'malformed_state',
                operationName,
                issues: stateResult.error,
              }),
            ),
          );
        }
        return fromNeverthrow(ok(stateResult.value));
      },
    });
  }

  /**
   * {@link ArvoOutboxDriver.tryReadLatestState}, throwing its error.
   *
   * @param param - Which execution. See {@link ArvoOutboxDriverReadLatestStateParam}.
   * @throws {ArvoOutboxDriverError} Kind `unavailable` or `malformed_state`.
   */
  async readLatestState(
    param: ArvoOutboxDriverReadLatestStateParam,
  ): Promise<JSONObject | null> {
    const stateResult = await this.tryReadLatestState(param);
    if (!stateResult.ok) throw stateResult.error;
    return stateResult.value;
  }

  /**
   * Commits one execution record and the events produced with it, together
   * or not at all, answering a failure, a refusal included, as a value.
   *
   * @param param - The record, its events and the delivered event. See {@link ArvoOutboxDriverCommitStateAndEventsParam}.
   * Asks the outbox's capacity first, and commits nothing where it answers
   * `exhausted`.
   *
   * @returns Nothing once committed, or kind `capacity_exhausted`, `state_exists`, `revision_stale`, `unavailable` or `malformed_response`.
   * @throws {ArvoOutboxDriverValidationError} Where the record lacks a field the commit carries; the outbox is not called.
   */
  tryCommitStateAndEvents(
    param: ArvoOutboxDriverCommitStateAndEventsParam,
  ): AsyncResult<void, ArvoOutboxDriverError> {
    const operationName = 'commitStateAndEvents';
    return runInSpan({
      operationName,
      telemetry: param.telemetry,
      parentSpan: param.span,
      run: async (span) => {
        const admissionResult = await this.#admitCommit(
          buildCapacityRequest(param),
          operationName,
          span,
        );
        if (!admissionResult.ok) return admissionResult;
        const commitFields = liftCommitFields(param.state);
        const eventRecords = await Promise.all(
          param.events.map((event) =>
            buildEventRecord(this.#cloudEventSerializer, event, {
              triggeringEventId: param.triggeringEvent.id,
              casVersion: commitFields.casVersion,
            }),
          ),
        );
        return this.#commit(operationName, () =>
          this.#outbox.commitStateAndEvents({
            ...commitFields,
            state: param.state,
            events: eventRecords,
          }),
        );
      },
    });
  }

  /**
   * {@link ArvoOutboxDriver.tryCommitStateAndEvents}, throwing its error.
   *
   * @param param - The record, its events and the delivered event. See {@link ArvoOutboxDriverCommitStateAndEventsParam}.
   * @throws {ArvoOutboxDriverError} Kind `capacity_exhausted`, `state_exists`, `revision_stale`, `unavailable` or `malformed_response`.
   * @throws {ArvoOutboxDriverValidationError} Where the record lacks a field the commit carries; the outbox is not called.
   */
  async commitStateAndEvents(
    param: ArvoOutboxDriverCommitStateAndEventsParam,
  ): Promise<void> {
    const commitResult = await this.tryCommitStateAndEvents(param);
    if (!commitResult.ok) throw commitResult.error;
  }

  /**
   * Commits events with no execution record, together or not at all,
   * answering a failure as a value. Nothing is compared, so it is refused
   * only for lack of room.
   *
   * Asks the outbox's capacity first, and commits nothing where it answers
   * `exhausted`.
   *
   * @param param - The events and the delivered event. See {@link ArvoOutboxDriverCommitEventsParam}.
   * @returns Nothing once committed, or kind `capacity_exhausted`, `unavailable` or `malformed_response`.
   */
  tryCommitEvents(
    param: ArvoOutboxDriverCommitEventsParam,
  ): AsyncResult<void, ArvoOutboxDriverError> {
    const operationName = 'commitEvents';
    return runInSpan({
      operationName,
      telemetry: param.telemetry,
      parentSpan: param.span,
      run: async (span) => {
        const admissionResult = await this.#admitCommit(
          buildCapacityRequest(param),
          operationName,
          span,
        );
        if (!admissionResult.ok) return admissionResult;
        const eventRecords = await Promise.all(
          param.events.map((event) =>
            buildEventRecord(this.#cloudEventSerializer, event, {
              triggeringEventId: param.triggeringEvent.id,
              casVersion: null,
            }),
          ),
        );
        return this.#commit(operationName, () =>
          this.#outbox.commitEvents({ events: eventRecords }),
        );
      },
    });
  }

  /**
   * {@link ArvoOutboxDriver.tryCommitEvents}, throwing its error.
   *
   * @param param - The events and the delivered event. See {@link ArvoOutboxDriverCommitEventsParam}.
   * @throws {ArvoOutboxDriverError} Kind `capacity_exhausted`, `unavailable` or `malformed_response`.
   */
  async commitEvents(param: ArvoOutboxDriverCommitEventsParam): Promise<void> {
    const commitResult = await this.tryCommitEvents(param);
    if (!commitResult.ok) throw commitResult.error;
  }

  /**
   * The committed events matching a filter, each beside the live event it
   * holds unless restoring is off, answering a failure as a value.
   *
   * @param param - Which events, and whether to restore them. See {@link ArvoOutboxDriverReadCommittedEventsParam}.
   * @returns The entries, or kind `unavailable`, `malformed_response` or `malformed_event`.
   */
  tryReadCommittedEvents(
    param: ArvoOutboxDriverReadCommittedEventsParam,
  ): AsyncResult<readonly ArvoOutboxDriverEventEntry[], ArvoOutboxDriverError> {
    const operationName = 'readCommittedEvents';
    return runInSpan({
      operationName,
      telemetry: param.telemetry,
      parentSpan: param.span,
      run: () =>
        this.#readEntries({
          operationName,
          restoreEvents: param.restoreEvents ?? true,
          read: () => this.#outbox.readCommittedEvents(param.filter),
        }),
    });
  }

  /**
   * {@link ArvoOutboxDriver.tryReadCommittedEvents}, throwing its error.
   *
   * @param param - Which events, and whether to restore them. See {@link ArvoOutboxDriverReadCommittedEventsParam}.
   * @throws {ArvoOutboxDriverError} Kind `unavailable`, `malformed_response` or `malformed_event`.
   */
  async readCommittedEvents(
    param: ArvoOutboxDriverReadCommittedEventsParam,
  ): Promise<readonly ArvoOutboxDriverEventEntry[]> {
    const readResult = await this.tryReadCommittedEvents(param);
    if (!readResult.ok) throw readResult.error;
    return readResult.value;
  }

  /**
   * The events not yet seen, oldest first, each beside the live event it
   * holds unless restoring is off, answering a failure as a value.
   *
   * @param param - How many, how old, how long to lease, and whether to restore. See {@link ArvoOutboxDriverListUnseenEventsParam}.
   * @returns The entries, or kind `unavailable`, `malformed_response` or `malformed_event`.
   */
  tryListUnseenEvents(
    param: ArvoOutboxDriverListUnseenEventsParam,
  ): AsyncResult<readonly ArvoOutboxDriverEventEntry[], ArvoOutboxDriverError> {
    const operationName = 'listUnseenEvents';
    return runInSpan({
      operationName,
      telemetry: param.telemetry,
      parentSpan: param.span,
      run: () =>
        this.#readEntries({
          operationName,
          restoreEvents: param.restoreEvents ?? true,
          read: () =>
            this.#outbox.listUnseenEvents({
              atMost: param.atMost,
              olderThanMs: param.olderThanMs,
              ...(param.leaseMs === undefined
                ? {}
                : { leaseMs: param.leaseMs }),
            }),
        }),
    });
  }

  /**
   * {@link ArvoOutboxDriver.tryListUnseenEvents}, throwing its error.
   *
   * @param param - How many, how old, how long to lease, and whether to restore. See {@link ArvoOutboxDriverListUnseenEventsParam}.
   * @throws {ArvoOutboxDriverError} Kind `unavailable`, `malformed_response` or `malformed_event`.
   */
  async listUnseenEvents(
    param: ArvoOutboxDriverListUnseenEventsParam,
  ): Promise<readonly ArvoOutboxDriverEventEntry[]> {
    const listResult = await this.tryListUnseenEvents(param);
    if (!listResult.ok) throw listResult.error;
    return listResult.value;
  }

  /**
   * Marks events seen, once a queue has accepted them, answering a failure
   * as a value.
   *
   * @param param - The events. See {@link ArvoOutboxDriverMarkEventsSeenParam}.
   * @returns Nothing once marked, or kind `unavailable`.
   */
  tryMarkEventsSeen(
    param: ArvoOutboxDriverMarkEventsSeenParam,
  ): AsyncResult<void, ArvoOutboxDriverError> {
    const operationName = 'markEventsSeen';
    return runInSpan({
      operationName,
      telemetry: param.telemetry,
      parentSpan: param.span,
      run: () =>
        callOutbox(operationName, () =>
          this.#outbox.markEventsSeen(param.eventIds),
        ),
    });
  }

  /**
   * {@link ArvoOutboxDriver.tryMarkEventsSeen}, throwing its error.
   *
   * @param param - The events. See {@link ArvoOutboxDriverMarkEventsSeenParam}.
   * @throws {ArvoOutboxDriverError} Kind `unavailable`.
   */
  async markEventsSeen(
    param: ArvoOutboxDriverMarkEventsSeenParam,
  ): Promise<void> {
    const markResult = await this.tryMarkEventsSeen(param);
    if (!markResult.ok) throw markResult.error;
  }

  /**
   * How much room the outbox would have for what would be committed, or for
   * one new execution with one event where nothing is given, answering a
   * failure as a value. `exhausted` is an answer, not a failure.
   *
   * @param param - What would be committed, or nothing. See {@link ArvoOutboxDriverCapacityParam}.
   * @returns The outbox's answer as it gave it, or kind `unavailable` or `malformed_response`.
   * @throws {ArvoOutboxDriverValidationError} Where a record lacks a field its commit would carry; the outbox is not called.
   */
  tryCapacity(
    param: ArvoOutboxDriverCapacityParam = {},
  ): AsyncResult<ArvoOutboxCapacity, ArvoOutboxDriverError> {
    const operationName = 'capacity';
    return runInSpan({
      operationName,
      telemetry: param.telemetry,
      parentSpan: param.span,
      run: () => this.#tryCapacity(buildCapacityRequest(param), operationName),
    });
  }

  /**
   * {@link ArvoOutboxDriver.tryCapacity}, throwing its error.
   *
   * @param param - What would be committed, or nothing. See {@link ArvoOutboxDriverCapacityParam}.
   * @returns The outbox's answer as it gave it.
   * @throws {ArvoOutboxDriverError} Kind `unavailable` or `malformed_response`.
   * @throws {ArvoOutboxDriverValidationError} Where a record lacks a field its commit would carry; the outbox is not called.
   */
  async capacity(
    param: ArvoOutboxDriverCapacityParam = {},
  ): Promise<ArvoOutboxCapacity> {
    const capacityResult = await this.tryCapacity(param);
    if (!capacityResult.ok) throw capacityResult.error;
    return capacityResult.value;
  }

  /** The outbox's capacity answer, checked, in no span of its own. */
  async #tryCapacity(
    capacityRequest: ArvoOutboxCapacityRequest,
    operationName: string,
  ): AsyncResult<ArvoOutboxCapacity, ArvoOutboxDriverError> {
    const answerResult = await callOutbox(operationName, () =>
      this.#outbox.capacity(capacityRequest),
    );
    if (!answerResult.ok) return answerResult;
    const capacityResult = checkCapacity(answerResult.value);
    if (!capacityResult.ok) {
      return fromNeverthrow(
        err(
          new ArvoOutboxDriverError({
            kind: 'malformed_response',
            operationName,
            issues: capacityResult.error,
          }),
        ),
      );
    }
    return fromNeverthrow(ok(capacityResult.value));
  }

  /**
   * The capacity question a commit asks before it writes, recorded on the
   * commit's span: nothing where it may go ahead, `capacity_exhausted` with
   * the answer where the outbox has no room, or the question's own failure.
   */
  async #admitCommit(
    capacityRequest: ArvoOutboxCapacityRequest,
    operationName: string,
    span: Span,
  ): AsyncResult<void, ArvoOutboxDriverError> {
    const capacityResult = await this.#tryCapacity(
      capacityRequest,
      operationName,
    );
    recordCapacityQuestion(span, capacityRequest, capacityResult);
    if (!capacityResult.ok) return capacityResult;
    if (capacityResult.value.status === 'exhausted') {
      return fromNeverthrow(
        err(
          new ArvoOutboxDriverError({
            kind: 'capacity_exhausted',
            operationName,
            capacity: capacityResult.value,
          }),
        ),
      );
    }
    return fromNeverthrow(ok(undefined));
  }

  /** One commit: called, its outcome checked, and a refusal reported as its kind. */
  async #commit(
    operationName: string,
    commit: () => unknown,
  ): AsyncResult<void, ArvoOutboxDriverError> {
    const answerResult = await callOutbox(operationName, commit);
    if (!answerResult.ok) return answerResult;
    const outcomeResult = checkCommitOutcome(answerResult.value);
    if (!outcomeResult.ok) {
      return fromNeverthrow(
        err(
          new ArvoOutboxDriverError({
            kind: 'malformed_response',
            operationName,
            issues: outcomeResult.error,
          }),
        ),
      );
    }
    if (!outcomeResult.value.committed) {
      return fromNeverthrow(
        err(
          new ArvoOutboxDriverError({
            kind: outcomeResult.value.refusal,
            operationName,
          }),
        ),
      );
    }
    return fromNeverthrow(ok(undefined));
  }

  /** One read of events: called, checked, and restored or not. */
  async #readEntries(param: {
    readonly operationName: string;
    readonly restoreEvents: boolean;
    readonly read: () => unknown;
  }): AsyncResult<
    readonly ArvoOutboxDriverEventEntry[],
    ArvoOutboxDriverError
  > {
    const answerResult = await callOutbox(param.operationName, param.read);
    if (!answerResult.ok) return answerResult;
    const recordsResult = checkCommittedRecords(answerResult.value);
    if (!recordsResult.ok) {
      return fromNeverthrow(
        err(
          new ArvoOutboxDriverError({
            kind: recordsResult.error.kind,
            operationName: param.operationName,
            issues: recordsResult.error.issues,
          }),
        ),
      );
    }
    return restoreEntries({
      cloudEventSerializer: this.#cloudEventSerializer,
      committedRecords: recordsResult.value,
      restoreEvents: param.restoreEvents,
      operationName: param.operationName,
    });
  }
}
