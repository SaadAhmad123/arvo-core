import { ArvoEvent } from '../../ArvoEvent/index.js';
import { ArvoSemanticVersion } from '../../semver/index.js';
import { ErrorIssue } from '../../utils/error-issue.js';
import {
  ARVO_EXECUTION_LIFECYCLES,
  ARVO_TOUCHED_EVENT_DIRECTIONS,
} from './types.js';

/** Whether a value is a plain object, which arrays and `null` are not. */
export const isPlainObject = (
  candidate: unknown,
): candidate is Record<string, unknown> =>
  typeof candidate === 'object' &&
  candidate !== null &&
  !Array.isArray(candidate);

const isNonEmptyString = (candidate: unknown): boolean =>
  typeof candidate === 'string' && candidate.length > 0;

const isCount = (candidate: unknown): boolean =>
  typeof candidate === 'number' &&
  Number.isInteger(candidate) &&
  candidate >= 0;

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
const checkTouchedEvents = (eventIds: unknown): (ErrorIssue | null)[] => {
  if (!Array.isArray(eventIds)) {
    return [
      new ErrorIssue({
        path: 'eventIds',
        message: 'must be an array of touched events',
        received: eventIds,
      }),
    ];
  }
  return eventIds.flatMap((touchedEvent, position) => {
    const path = `eventIds[${position}]`;
    if (!isPlainObject(touchedEvent)) {
      return [
        new ErrorIssue({
          path,
          message: 'must be an object',
          received: touchedEvent,
        }),
      ];
    }
    return [
      isNonEmptyString(touchedEvent.id)
        ? null
        : new ErrorIssue({
            path: `${path}.id`,
            message: 'must be a non-empty string',
            received: touchedEvent.id,
          }),
      ARVO_TOUCHED_EVENT_DIRECTIONS.includes(
        touchedEvent.direction as (typeof ARVO_TOUCHED_EVENT_DIRECTIONS)[number],
      )
        ? null
        : new ErrorIssue({
            path: `${path}.direction`,
            message: `must be one of ${ARVO_TOUCHED_EVENT_DIRECTIONS.join(', ')}`,
            received: touchedEvent.direction,
          }),
    ];
  });
};

/** What is awaited: a map from an emitted event's id to its answer, or none. */
const checkInFlightEvents = (
  inFlightEventMap: unknown,
): (ErrorIssue | null)[] => {
  if (!(inFlightEventMap instanceof Map)) {
    return [
      new ErrorIssue({
        path: 'inFlightEventMap',
        message: 'must be a Map keyed by the id of the event emitted',
        received: inFlightEventMap,
      }),
    ];
  }
  return [...inFlightEventMap.entries()].map(([requestId, answer]) =>
    isNonEmptyString(requestId) &&
    (answer === null || answer instanceof ArvoEvent)
      ? null
      : new ErrorIssue({
          path: `inFlightEventMap[${String(requestId)}]`,
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
 * an execution is admitted, the second by whoever holds the schema.
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

  const issues: (ErrorIssue | null)[] = [
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

  return issues.filter((issue): issue is ErrorIssue => issue !== null);
};
