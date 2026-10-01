import { ArvoEvent } from '../../ArvoEvent/index.js';
import { ArvoSemanticVersion } from '../../semver/index.js';
import { ErrorIssue } from '../../utils/error-issue.js';
import {
  ARVO_EXECUTION_LIFECYCLES,
  ARVO_TOUCHED_EVENT_DIRECTIONS,
} from './types.js';

/** Whether a value is a plain object, which arrays and `null` are not. */
export const isPlainObject = (
  value: unknown,
): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): boolean =>
  typeof value === 'string' && value.length > 0;

const isCount = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** The identifiers, each of which must be there and must say something. */
const IDENTIFIER_FIELDS = [
  'subject',
  'executionId',
  'parentExecutionId',
  'source',
] as const;

/** The counts, each of which must be a whole number and cannot go backwards. */
const COUNT_FIELDS = ['depth', 'casVersion'] as const;

const checkIdentifiers = (
  record: Record<string, unknown>,
): (ErrorIssue | null)[] =>
  IDENTIFIER_FIELDS.map((field) =>
    isNonEmptyString(record[field])
      ? null
      : new ErrorIssue({
          path: field,
          message: 'must be a non-empty string',
          received: record[field],
        }),
  );

const checkCounts = (record: Record<string, unknown>): (ErrorIssue | null)[] =>
  COUNT_FIELDS.map((field) =>
    isCount(record[field])
      ? null
      : new ErrorIssue({
          path: field,
          message: 'must be an integer of 0 or more',
          received: record[field],
        }),
  );

const checkEvents = (record: Record<string, unknown>): (ErrorIssue | null)[] =>
  (['initEvent', 'triggeringEvent'] as const).map((field) =>
    record[field] instanceof ArvoEvent
      ? null
      : new ErrorIssue({
          path: field,
          message: 'must be an ArvoEvent',
          received: record[field],
        }),
  );

/** The event log: an array, and every entry an id with a direction. */
const checkTouchedEvents = (value: unknown): (ErrorIssue | null)[] => {
  if (!Array.isArray(value)) {
    return [
      new ErrorIssue({
        path: 'eventIds',
        message: 'must be an array of touched events',
        received: value,
      }),
    ];
  }
  return value.flatMap((entry, index) => {
    const path = `eventIds[${index}]`;
    if (!isPlainObject(entry)) {
      return [
        new ErrorIssue({ path, message: 'must be an object', received: entry }),
      ];
    }
    return [
      isNonEmptyString(entry.id)
        ? null
        : new ErrorIssue({
            path: `${path}.id`,
            message: 'must be a non-empty string',
            received: entry.id,
          }),
      ARVO_TOUCHED_EVENT_DIRECTIONS.includes(
        entry.direction as (typeof ARVO_TOUCHED_EVENT_DIRECTIONS)[number],
      )
        ? null
        : new ErrorIssue({
            path: `${path}.direction`,
            message: `must be one of ${ARVO_TOUCHED_EVENT_DIRECTIONS.join(', ')}`,
            received: entry.direction,
          }),
    ];
  });
};

/** What is awaited: a map from an emitted event's id to its answer, or none. */
const checkInFlightEvents = (value: unknown): (ErrorIssue | null)[] => {
  if (!(value instanceof Map)) {
    return [
      new ErrorIssue({
        path: 'inFlightEventMap',
        message: 'must be a Map keyed by the id of the event emitted',
        received: value,
      }),
    ];
  }
  return [...value.entries()].map(([key, answer]) =>
    isNonEmptyString(key) && (answer === null || answer instanceof ArvoEvent)
      ? null
      : new ErrorIssue({
          path: `inFlightEventMap[${String(key)}]`,
          message: 'must map a non-empty id to an ArvoEvent or to null',
          received: answer,
        }),
  );
};

/**
 * Every rule about the shape of what an execution remembers, all of them
 * evaluated so a caller is told about four wrong fields at once rather than
 * one run at a time.
 *
 * Shape and domain only. Whether a record agrees with the contract it names,
 * or whether its data satisfies a schema, is asked elsewhere: the first where
 * a delivery is admitted, the second by whoever holds the schema.
 */
export const checkExecutionState = (input: unknown): ErrorIssue[] => {
  if (!isPlainObject(input)) {
    return [
      new ErrorIssue({
        path: '(root)',
        message: 'must be an object',
        received: input,
      }),
    ];
  }

  const found: (ErrorIssue | null)[] = [
    ...checkIdentifiers(input),
    ...checkCounts(input),
    ...checkEvents(input),
    ...checkTouchedEvents(input.eventIds),
    ...checkInFlightEvents(input.inFlightEventMap),

    input.data === null || isPlainObject(input.data)
      ? null
      : new ErrorIssue({
          path: 'data',
          message: 'must be an object, or null where nothing has been written',
          received: input.data,
        }),

    ArvoSemanticVersion.check(input.version)
      ? null
      : new ErrorIssue({
          path: 'version',
          message: 'must be a semantic version',
          received: input.version,
        }),

    ARVO_EXECUTION_LIFECYCLES.includes(
      input.lifecycle as (typeof ARVO_EXECUTION_LIFECYCLES)[number],
    )
      ? null
      : new ErrorIssue({
          path: 'lifecycle',
          message: `must be one of ${ARVO_EXECUTION_LIFECYCLES.join(', ')}`,
          received: input.lifecycle,
        }),

    input.lifecycleDescription === null ||
    typeof input.lifecycleDescription === 'string'
      ? null
      : new ErrorIssue({
          path: 'lifecycleDescription',
          message: 'must be a string, or null where nothing explains it',
          received: input.lifecycleDescription,
        }),

    ArvoSemanticVersion.check(input.recordFormatVersion)
      ? null
      : new ErrorIssue({
          path: 'recordFormatVersion',
          message: 'must be a semantic version',
          received: input.recordFormatVersion,
        }),
  ];

  return found.filter((issue): issue is ErrorIssue => issue !== null);
};
