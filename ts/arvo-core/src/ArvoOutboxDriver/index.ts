import { err, ok } from 'neverthrow';
import type { IArvoOutbox } from '../ArvoOutbox/interface.js';
import { fromNeverthrow } from '../result.js';
import { ArvoEventSerializer } from '../serializers/ArvoEventSerializer/index.js';
import type { AsyncResult, JSONObject } from '../types.js';
import { ArvoOutboxDriverError } from './errors.js';
import { buildEventRecord } from './helpers/build-event-record.js';
import { callOutbox } from './helpers/call-outbox.js';
import { checkCommitOutcome } from './helpers/check-commit-outcome.js';
import { checkCommittedRecords } from './helpers/check-committed-records.js';
import { checkState } from './helpers/check-state.js';
import { liftCommitFields } from './helpers/lift-commit-fields.js';
import { restoreEntries } from './helpers/restore-entries.js';
import { runInSpan } from './helpers/run-in-span.js';
import type {
  ArvoOutboxDriverCallParam,
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
 * A refused commit is reported as an error, kind `state_exists` or
 * `revision_stale`; anything the outbox throws is `unavailable`. The driver
 * calls the outbox once per operation and decides nothing: it does not
 * retry, re-read on a refusal, or build a fault. Each operation is a
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
   * @returns Nothing once committed, or kind `state_exists`, `revision_stale`, `unavailable` or `malformed_response`.
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
      run: async () => {
        const commitFields = liftCommitFields(param.state);
        const eventRecords = await Promise.all(
          param.events.map((event) =>
            buildEventRecord(this.#cloudEventSerializer, event, {
              triggeringEventId: param.triggeringEvent.id,
              casVersion: commitFields.casVersion,
            }),
          ),
        );
        const answerResult = await callOutbox(operationName, () =>
          this.#outbox.commitStateAndEvents({
            ...commitFields,
            state: param.state,
            events: eventRecords,
          }),
        );
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
      },
    });
  }

  /**
   * {@link ArvoOutboxDriver.tryCommitStateAndEvents}, throwing its error.
   *
   * @param param - The record, its events and the delivered event. See {@link ArvoOutboxDriverCommitStateAndEventsParam}.
   * @throws {ArvoOutboxDriverError} Kind `state_exists`, `revision_stale`, `unavailable` or `malformed_response`.
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
   * answering a failure as a value. Nothing is compared, so nothing is
   * refused.
   *
   * @param param - The events and the delivered event. See {@link ArvoOutboxDriverCommitEventsParam}.
   * @returns Nothing once committed, or kind `unavailable`.
   */
  tryCommitEvents(
    param: ArvoOutboxDriverCommitEventsParam,
  ): AsyncResult<void, ArvoOutboxDriverError> {
    const operationName = 'commitEvents';
    return runInSpan({
      operationName,
      telemetry: param.telemetry,
      parentSpan: param.span,
      run: async () => {
        const eventRecords = await Promise.all(
          param.events.map((event) =>
            buildEventRecord(this.#cloudEventSerializer, event, {
              triggeringEventId: param.triggeringEvent.id,
              casVersion: null,
            }),
          ),
        );
        return callOutbox(operationName, () =>
          this.#outbox.commitEvents({ events: eventRecords }),
        );
      },
    });
  }

  /**
   * {@link ArvoOutboxDriver.tryCommitEvents}, throwing its error.
   *
   * @param param - The events and the delivered event. See {@link ArvoOutboxDriverCommitEventsParam}.
   * @throws {ArvoOutboxDriverError} Kind `unavailable`.
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
