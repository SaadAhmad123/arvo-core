import { err, ok } from 'neverthrow';
import { z } from 'zod';
import type { ArvoEvent } from '../ArvoEvent/index.js';
import { fromNeverthrow } from '../result.js';
import type { Result } from '../types.js';
import { ErrorIssue } from '../utils/error-issue.js';
import { ArvoContractAssertionError } from './errors.js';
import { HANDLER_ERROR_SCHEMA, handlerErrorType } from './handler-error.js';
import type {
  ArvoContractEventAssertionScope,
  ArvoContractVersionParam,
} from './types.js';

/**
 * Why a prerequisite failure stops everything after it. Each names what it
 * was establishing, so the issue says what became unanswerable rather than
 * only that something did.
 */
const BLOCKED_BY = {
  expectedType:
    'the expected type is not one this version declares, so there is no schema to check the payload against',
  structure:
    'the dataschema does not separate into an identifier and a version, so neither could be checked',
  uri: 'the event belongs to another contract, so this contract has no declaration to check it against',
  version:
    'the version is not the one being asked about, so there is no declaration to check the event against',
  type: 'the type is not the shape being checked, so the payload belongs to a different schema',
} as const;

/** The two halves of a `dataschema`, once it has been read as one. */
export type DataschemaParts = { uri: string; version: string };

/**
 * Reads a `dataschema` as an identifier and a version.
 *
 * The version is the final segment and the identifier is everything before
 * it, so the split is at the last separator — an identifier carries
 * separators of its own, and splitting anywhere else hands part of it to the
 * version. Nothing looks inside the identifier: it is compared for equality
 * by the caller, never parsed or rebuilt.
 */
export const readDataschema = (
  dataschema: string,
): Result<DataschemaParts, ErrorIssue> => {
  const at = dataschema.lastIndexOf('/');
  const uri = dataschema.slice(0, at);
  const version = dataschema.slice(at + 1);

  if (at === -1 || uri === '' || version === '') {
    return fromNeverthrow(
      err(
        new ErrorIssue({
          path: 'event.dataschema',
          message:
            'must be a contract identifier and a version separated by "/", both non-empty',
          received: dataschema,
          blockingReason: BLOCKED_BY.structure,
        }),
      ),
    );
  }

  return fromNeverthrow(ok({ uri, version }));
};

/** Reports an event addressed to a contract other than the one asked. */
export const foreignContractIssue = (
  found: string,
  expected: string,
): ErrorIssue =>
  new ErrorIssue({
    path: 'event.dataschema.uri',
    message: `must be this contract's identifier, ${expected}`,
    received: found,
    blockingReason: BLOCKED_BY.uri,
  });

/**
 * Reports a version that is not the one being asked about.
 *
 * `declared` is what the asking level can offer — one version for a version
 * contract, every declared version for a contract — so the message points at
 * the list the caller should be looking at.
 */
export const unknownVersionIssue = (
  found: string,
  declared: readonly string[],
): ErrorIssue =>
  new ErrorIssue({
    path: 'event.dataschema.version',
    message: `must be ${declared.length === 1 ? declared[0] : `one of ${declared.join(', ')}`}`,
    received: found,
    blockingReason: BLOCKED_BY.version,
  });

/** Every type one version may legitimately carry, in reporting order. */
const declaredTypes = (
  type: string,
  emits: Record<string, unknown>,
): string[] => [type, ...Object.keys(emits), handlerErrorType(type)];

/**
 * Which of a version's three shapes a type names, or `null` for none.
 *
 * The contract's own `type` wins over an emit key of the same name, which
 * cannot happen — a contract declaring an emit keyed by its own `type` is
 * rejected at declaration — but the order makes the precedence explicit
 * rather than incidental.
 */
export const scopeOfType = (
  candidate: string,
  type: string,
  emits: Record<string, unknown>,
): ArvoContractEventAssertionScope | null => {
  if (candidate === type) return 'accepts';
  if (candidate === handlerErrorType(type)) return 'handlerError';
  if (Object.hasOwn(emits, candidate)) return 'emits';
  return null;
};

/** The schema a scope selects. */
const schemaForScope = (
  scope: ArvoContractEventAssertionScope,
  eventType: string,
  accepts: z.core.$ZodType,
  emits: Record<string, z.core.$ZodType>,
): z.core.$ZodType => {
  if (scope === 'accepts') return accepts;
  if (scope === 'handlerError') return HANDLER_ERROR_SCHEMA;
  return emits[eventType];
};

/** Reports an expected type this version does not declare. */
const undeclaredExpectationIssue = (
  expected: string,
  declared: readonly string[],
): ErrorIssue =>
  new ErrorIssue({
    path: 'expectedType',
    message: `must be a type this version declares: ${declared.join(', ')}`,
    received: expected,
    blockingReason: BLOCKED_BY.expectedType,
  });

/** Reports a type that is not the shape being checked. */
const typeDisagreementIssue = (
  found: string,
  wanted: readonly string[],
): ErrorIssue =>
  new ErrorIssue({
    path: 'event.type',
    message:
      wanted.length === 1
        ? `must be ${wanted[0]}, the type expected`
        : `must be one of the types this version declares: ${wanted.join(', ')}`,
    received: found,
    blockingReason: BLOCKED_BY.type,
  });

/**
 * Reads the value at a zod issue's path out of the payload.
 *
 * Zod reports which rule broke and where, but not the value that broke it —
 * measured against zod 4.4.3, an issue carries no input of its own. So the
 * value is fetched here, `received` meaning the offending value everywhere
 * else in this package. A path reaching nothing yields `undefined`, which is
 * how an absent value is already rendered: without a `received` clause.
 */
const valueAt = (payload: unknown, path: readonly PropertyKey[]): unknown => {
  let current: unknown = payload;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
};

/**
 * Checks a payload against one schema, reporting every rule it broke.
 *
 * Each issue is zod's own: its path beneath `event.data`, its message
 * verbatim, and the value found at that position. Nothing re-implements a
 * check zod performs, and nothing paraphrases what it reported.
 *
 * The value zod produces is discarded. Only its verdict and its issues are
 * used, the event being returned as it arrived.
 */
export const checkPayload = (
  schema: z.core.$ZodType,
  data: unknown,
): ErrorIssue[] => {
  const result = z.safeParse(schema, data);
  if (result.success) return [];

  return result.error.issues.map(
    (issue) =>
      new ErrorIssue({
        path: ['event', 'data', ...issue.path].join('.'),
        message: issue.message,
        received: valueAt(data, issue.path),
      }),
  );
};

/**
 * Checks an event against one version's declaration.
 *
 * The single definition of "this event matches this version", reached by
 * both a contract and a version contract, so an event a contract accepts is
 * exactly an event one of its versions accepts.
 *
 * Everything before the payload is a prerequisite: an expected type the
 * version does not declare, then a type that is not the shape being checked.
 * The first to fail is reported alone, because a payload judged against a
 * shape the event did not claim reports rules the event never claimed to
 * satisfy. Only payload failures arrive together.
 */
export const checkAgainstVersion = <
  T extends string,
  C extends ArvoContractVersionParam,
>(param: {
  event: ArvoEvent;
  type: T;
  accepts: C['accepts'];
  emits: C['emits'];
  expectedType?: string;
}): Result<ArvoContractEventAssertionScope, ErrorIssue[]> => {
  const { event, type, accepts, emits, expectedType } = param;
  const declared = declaredTypes(type, emits);

  const expectedScope =
    expectedType === undefined ? null : scopeOfType(expectedType, type, emits);

  if (expectedType !== undefined && expectedScope === null) {
    return fromNeverthrow(
      err([undeclaredExpectationIssue(expectedType, declared)]),
    );
  }

  const scope =
    expectedType === undefined
      ? scopeOfType(event.type, type, emits)
      : event.type === expectedType
        ? expectedScope
        : null;

  if (scope === null) {
    return fromNeverthrow(
      err([
        typeDisagreementIssue(
          event.type,
          expectedType === undefined ? declared : [expectedType],
        ),
      ]),
    );
  }

  const issues = checkPayload(
    schemaForScope(scope, event.type, accepts, emits),
    event.data,
  );
  return fromNeverthrow(issues.length > 0 ? err(issues) : ok(scope));
};

/**
 * Builds an assertion's outcome in the shape every fallible operation in
 * this package reports, wrapping issues in the one error asserting has.
 */
export const assertionResult = <R>(
  outcome: Result<R, ErrorIssue[]>,
): Result<R, ArvoContractAssertionError> =>
  fromNeverthrow(
    outcome.ok
      ? ok(outcome.value)
      : err(new ArvoContractAssertionError(outcome.error)),
  );
