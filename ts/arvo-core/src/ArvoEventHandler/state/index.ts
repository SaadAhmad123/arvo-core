import { err, ok } from 'neverthrow';
import * as z from 'zod/v4/core';
import type { ArvoEvent } from '../../ArvoEvent/index.js';
import { fromNeverthrow } from '../../result.js';
import type { ArvoSemanticVersion } from '../../semver/index.js';
import type { Result } from '../../types.js';
import { ErrorIssue } from '../../utils/error-issue.js';
import { ArvoExecutionStateValidationError } from './errors.js';
import type { ArvoExecutionStateWire } from './serializer/types.js';
import type {
  ArvoExecutionLifecycle,
  ArvoExecutionStateParam,
  ArvoRecordContracts,
  ArvoTouchedEvent,
} from './types.js';
import { checkExecutionState, isPlainObject } from './validator.js';

/**
 * Everything an execution remembers about itself, as one immutable value.
 *
 * Its own business data, where it came from, where it rests, what it has
 * touched and what it is still waiting on. Every field is read-only, and a
 * record never changes: an execution moves forward by minting the next one.
 *
 * Checked as it is built, so a record that exists is one that was valid.
 * Its data is the exception — the schema governing that is a type parameter
 * and is never carried, so whoever writes or reads one back supplies it.
 *
 * @example
 * ```typescript
 * const state = ArvoExecutionState.build(row, orderData);
 * state.data;                    // what was last written, or null
 * state.triggeringEvent.type;    // what caused the delivery being processed
 * state.inFlightEventMap.size;   // how many answers are still awaited
 * ```
 */
export class ArvoExecutionState<
  TDataSchema extends z.$ZodObject = z.$ZodObject,
  TInitEvent extends ArvoEvent = ArvoEvent,
  TTriggeringEvent extends ArvoEvent = ArvoEvent,
> {
  /**
   * The executor's own business state, and the only field an executor may
   * change. `null` until something writes it: every other field is known the
   * moment an execution opens, and this one is not.
   */
  readonly data: z.output<TDataSchema> | null;

  /** The workflow this execution belongs to. */
  readonly subject: string;

  /** This execution. */
  readonly executionId: string;

  /** The execution that caused this one, or this one where nothing did. */
  readonly parentExecutionId: string;

  /** How far from the workflow's first event this execution sits. */
  readonly depth: number;

  /** The contract this execution implements, by its addressable name. */
  readonly source: string;

  /** Which version of that contract is running. */
  readonly version: ArvoSemanticVersion;

  /** Where this execution rests. */
  readonly lifecycle: ArvoExecutionLifecycle;

  /** Why it rests there, or `null` where nothing explains it. */
  readonly lifecycleDescription: string | null;

  /** The event that opened this execution. */
  readonly initEvent: TInitEvent;

  /** The event that caused the delivery being processed. */
  readonly triggeringEvent: TTriggeringEvent;

  /** Every event this execution has handled, in the order it handled them. */
  readonly eventIds: readonly ArvoTouchedEvent[];

  /**
   * What it is waiting on, keyed by the id of the event it emitted: `null`
   * while unanswered, the answering event once it arrives.
   */
  readonly inFlightEventMap: ReadonlyMap<string, ArvoEvent | null>;

  /** Which shape of record this is, so a later reader knows what it holds. */
  readonly recordFormatVersion: string;

  /** How many times this record has been written, counting from 0. */
  readonly casVersion: number;

  /** What this execution was declared against when it opened. */
  readonly contracts: ArvoRecordContracts;

  /**
   * @param param - Every field the record holds. See
   * {@link ArvoExecutionStateParam}.
   * @throws {ArvoExecutionStateValidationError} If any field is of the wrong
   * shape, naming every one of them rather than only the first.
   */
  constructor(
    param: ArvoExecutionStateParam<TDataSchema, TInitEvent, TTriggeringEvent>,
  ) {
    const issues = checkExecutionState(param);
    if (issues.length > 0) throw new ArvoExecutionStateValidationError(issues);

    this.data = param.data;
    this.subject = param.subject;
    this.executionId = param.executionId;
    this.parentExecutionId = param.parentExecutionId;
    this.depth = param.depth;
    this.source = param.source;
    this.version = param.version;
    this.lifecycle = param.lifecycle;
    this.lifecycleDescription = param.lifecycleDescription;
    this.initEvent = param.initEvent;
    this.triggeringEvent = param.triggeringEvent;
    this.eventIds = Object.freeze([...param.eventIds]);
    this.inFlightEventMap = new Map(param.inFlightEventMap);
    this.recordFormatVersion = param.recordFormatVersion;
    this.casVersion = param.casVersion;
    this.contracts = Object.freeze({
      self: param.contracts.self,
      services: Object.freeze([...param.contracts.services]),
    });

    Object.freeze(this);
  }

  /**
   * The record as plain JSON: every field, with the two things JSON cannot
   * express turned into something it can.
   *
   * What is awaited becomes a list of pairs rather than a `Map`. The events
   * serialize as themselves. The one definition of a record's plain shape,
   * so anything writing one out agrees with everything else.
   */
  toJSON(): ArvoExecutionStateWire {
    return {
      data: this.data,
      subject: this.subject,
      executionId: this.executionId,
      parentExecutionId: this.parentExecutionId,
      depth: this.depth,
      source: this.source,
      version: this.version,
      lifecycle: this.lifecycle,
      lifecycleDescription: this.lifecycleDescription,
      initEvent: this.initEvent,
      triggeringEvent: this.triggeringEvent,
      eventIds: [...this.eventIds],
      inFlightEventMap: [...this.inFlightEventMap],
      recordFormatVersion: this.recordFormatVersion,
      casVersion: this.casVersion,
      contracts: this.contracts,
    } as unknown as ArvoExecutionStateWire;
  }

  /**
   * A record rebuilt from something that is not one yet — a row from a
   * store, a fixture, a replay — reporting the outcome rather than throwing.
   *
   * Both events must already be events, and what is awaited must already be
   * a `Map`. Restoring either from however it was stored is the caller's.
   * Data is checked against `dataschema` but never rewritten by it: what
   * comes back is what was stored, with nothing defaulted or transformed on
   * the way in.
   *
   * @param input - What the record was stored as.
   * @param dataschema - The schema governing that version's data, the one
   * thing a record does not carry.
   *
   * @example
   * ```typescript
   * const result = ArvoExecutionState.tryBuild(row, orderData);
   * if (!result.ok) {
   *   result.error.issues.map((issue) => issue.toString());
   *   return;
   * }
   * result.value.data;
   * ```
   */
  static tryBuild<TDataSchema extends z.$ZodObject>(
    input: unknown,
    dataschema: TDataSchema,
  ): Result<
    ArvoExecutionState<TDataSchema>,
    ArvoExecutionStateValidationError
  > {
    if (!isPlainObject(input)) {
      return fromNeverthrow(
        err(new ArvoExecutionStateValidationError(checkExecutionState(input))),
      );
    }

    const issues: ErrorIssue[] = [];

    if (isPlainObject(input.data)) {
      // Judged against the schema, never replaced by what it produced: a
      // record read back is what was stored, defaults and all.
      const checked = z.safeParse(dataschema, input.data);
      if (!checked.success) {
        issues.push(
          ...checked.error.issues.map(
            (issue) =>
              new ErrorIssue({
                path: `data.${issue.path.join('.') || '(root)'}`,
                message: issue.message,
              }),
          ),
        );
      }
    }

    issues.push(...checkExecutionState(input));

    if (issues.length > 0) {
      return fromNeverthrow(err(new ArvoExecutionStateValidationError(issues)));
    }
    return fromNeverthrow(
      ok(
        new ArvoExecutionState<TDataSchema>(
          input as unknown as ArvoExecutionStateParam<TDataSchema>,
        ),
      ),
    );
  }

  /**
   * A record rebuilt from something that is not one yet — a row from a
   * store, a fixture, a replay.
   *
   * Both events must already be events, and what is awaited must already be
   * a `Map`. Restoring either from however it was stored is the caller's.
   * Data is checked against `dataschema` but never rewritten by it: what
   * comes back is what was stored, with nothing defaulted or transformed on
   * the way in.
   *
   * @param input - What the record was stored as.
   * @param dataschema - The schema governing that version's data, the one
   * thing a record does not carry.
   * @throws {ArvoExecutionStateValidationError} If any field is of the wrong
   * shape, naming every one of them rather than only the first.
   *
   * @example
   * ```typescript
   * ArvoExecutionState.build(row, orderData).lifecycle;
   * ```
   */
  static build<TDataSchema extends z.$ZodObject>(
    input: unknown,
    dataschema: TDataSchema,
  ): ArvoExecutionState<TDataSchema> {
    const result = ArvoExecutionState.tryBuild(input, dataschema);
    if (result.ok) return result.value;
    throw result.error;
  }
}
