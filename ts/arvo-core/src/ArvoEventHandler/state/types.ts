import type * as z from 'zod/v4/core';
import type { ArvoEvent } from '../../ArvoEvent/index.js';
import type { ArvoSemanticVersion } from '../../semver/index.js';

/**
 * Every place an execution can rest, and the whole of the vocabulary.
 *
 * Declared as the list rather than as a bare union so that whatever checks a
 * value against it reads the same list this type is made of. Two copies of
 * six strings is two copies that drift.
 */
export const ARVO_EXECUTION_LIFECYCLES = Object.freeze([
  'idle',
  'waiting',
  'success',
  'error',
  'cancelled',
  'failure',
] as const);

/** Where an execution rests. See {@link ARVO_EXECUTION_LIFECYCLES}. */
export type ArvoExecutionLifecycle = (typeof ARVO_EXECUTION_LIFECYCLES)[number];

/**
 * The places an execution rests for good. A record at one of these is
 * finished, and nothing further reaches it.
 */
export const ARVO_TERMINAL_LIFECYCLES = Object.freeze([
  'success',
  'error',
  'cancelled',
  'failure',
] as const);

/** See {@link ARVO_TERMINAL_LIFECYCLES}. */
export type ArvoTerminalLifecycle = (typeof ARVO_TERMINAL_LIFECYCLES)[number];

/** Who an execution is, and where it sits. */
export type ArvoExecutionIdentity = {
  /** The workflow it belongs to. */
  readonly subject: string;
  /** This execution. */
  readonly executionId: string;
  /** The execution that caused this one. */
  readonly parentExecutionId: string;
  /** How far from the workflow's first event it sits. */
  readonly depth: number;
  /** Which version of the implemented contract is running. */
  readonly version: ArvoSemanticVersion;
};

/** Which way an event passed through an execution. */
export const ARVO_TOUCHED_EVENT_DIRECTIONS = Object.freeze([
  'received',
  'emitted',
] as const);

/** See {@link ARVO_TOUCHED_EVENT_DIRECTIONS}. */
export type ArvoTouchedEventDirection =
  (typeof ARVO_TOUCHED_EVENT_DIRECTIONS)[number];

/**
 * One event an execution has handled, and which way it went.
 *
 * The id alone, not the event: the log is a trail for whoever is reading
 * the execution back, and keeping every event whole would grow a record
 * without bound.
 */
export type ArvoTouchedEvent = {
  /** The event's id. */
  readonly id: string;
  /** Whether the execution received it or emitted it. */
  readonly direction: ArvoTouchedEventDirection;
};

/**
 * Every field an execution's memory holds, typed by the values themselves
 * rather than by the schema governing them.
 *
 * Split out from {@link ArvoExecutionStateParam} so that a caller holding a
 * record but not its schema can still describe that record's fields. A
 * record carries no schema, so anything working from one has the value type
 * and nothing else.
 *
 * No field is optional. Every one of them is known the moment an execution
 * opens, so an omitted field would mean nobody decided rather than that
 * there was nothing to say. Where there is nothing to say, say `null`.
 */
export type ArvoExecutionStateFields<
  TData = Record<string, unknown> | null,
  TInitEvent extends ArvoEvent = ArvoEvent,
  TTriggeringEvent extends ArvoEvent = ArvoEvent,
> = {
  /** The executor's own business state, `null` until something writes it. */
  data: TData;

  /** The workflow this execution belongs to. */
  subject: string;
  /** This execution. */
  executionId: string;
  /** The execution that caused this one, or this one where nothing did. */
  parentExecutionId: string;
  /** How far from the workflow's first event this execution sits. */
  depth: number;
  /** The contract this execution implements, by its addressable name. */
  source: string;
  /** Which version of that contract is running. */
  version: ArvoSemanticVersion;

  /** Where this execution rests. */
  lifecycle: ArvoExecutionLifecycle;
  /** Why it rests there, or `null` where nothing explains it. */
  lifecycleDescription: string | null;

  /** The event that opened this execution. */
  initEvent: TInitEvent;
  /** The event that caused the execution being processed. */
  triggeringEvent: TTriggeringEvent;

  /** Every event this execution has handled, in the order it handled them. */
  eventIds: readonly ArvoTouchedEvent[];
  /**
   * What it is waiting on, keyed by the id of the event it emitted: `null`
   * while unanswered, the answering event once it arrives.
   */
  inFlightEventMap: ReadonlyMap<string, ArvoEvent | null>;

  /** Which shape of record this is, so a later reader knows what it holds. */
  recordFormatVersion: string;
  /** How many times this record has been written, counting from 0. */
  casVersion: number;
};

/**
 * What an execution's memory is built from: every field it holds, with its
 * data typed by the schema governing that version.
 *
 * What a constructor takes. {@link ArvoExecutionStateFields} is the same set
 * typed by the values, for anything working from a record rather than from a
 * declaration.
 */
export type ArvoExecutionStateParam<
  TDataSchema extends z.$ZodObject = z.$ZodObject,
  TInitEvent extends ArvoEvent = ArvoEvent,
  TTriggeringEvent extends ArvoEvent = ArvoEvent,
> = ArvoExecutionStateFields<
  z.output<TDataSchema> | null,
  TInitEvent,
  TTriggeringEvent
>;
