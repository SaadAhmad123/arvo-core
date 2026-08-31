import { err, ok } from 'neverthrow';
import * as z from 'zod/v4/core';
import type { ArvoEvent } from '../ArvoEvent/index.js';
import { fromNeverthrow } from '../result.js';
import type { Result } from '../types.js';
import { ErrorIssue } from '../utils/error-issue.js';
import { ArvoContractAssertionError } from './errors.js';
import type { HandlerErrorContract } from './handler-error.js';
import type { ArvoContractEventAssertionScope } from './types.js';

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
  const uri = at === -1 ? '' : dataschema.slice(0, at);
  const version = at === -1 ? '' : dataschema.slice(at + 1);

  if (uri === '' || version === '') {
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
): ErrorIssue => {
  const wanted =
    declared.length === 1 ? declared[0] : `one of ${declared.join(', ')}`;
  return new ErrorIssue({
    path: 'event.dataschema.version',
    message: `must be ${wanted}`,
    received: found,
    blockingReason: BLOCKED_BY.version,
  });
};

/** Every type one version may legitimately carry, in reporting order. */
const declaredTypes = (
  type: string,
  outputs: Record<string, unknown>,
  handlerErrorType: string,
): string[] => [type, ...Object.keys(outputs), handlerErrorType];

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
  outputs: Record<string, unknown>,
  handlerErrorType: string,
): ArvoContractEventAssertionScope | null => {
  if (candidate === type) return 'input';
  if (candidate === handlerErrorType) return 'error';
  if (Object.hasOwn(outputs, candidate)) return 'output';
  return null;
};

/** The schema a scope selects. */
const schemaForScope = (
  scope: ArvoContractEventAssertionScope,
  eventType: string,
  input: z.$ZodType,
  outputs: Record<string, z.$ZodType>,
  error: HandlerErrorContract,
): z.$ZodType => {
  if (scope === 'input') return input;
  if (scope === 'error') return error.schema;
  return outputs[eventType];
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
  schema: z.$ZodType,
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
 * The expectation, checked before anything about the event is read.
 *
 * `null` when nothing was expected, or when what was expected is a shape this
 * version declares.
 */
const checkExpectation = (
  expectedType: string | undefined,
  expectedScope: ArvoContractEventAssertionScope | null,
  declared: readonly string[],
): ErrorIssue | null =>
  expectedType !== undefined && expectedScope === null
    ? undeclaredExpectationIssue(expectedType, declared)
    : null;

/**
 * The event's `dataschema`, read and compared against one version's identity.
 *
 * Three failures in one place because they are one question asked in
 * sequence: is there an identifier and a version at all, is the identifier
 * this contract's, is the version the one being asked about. Each answer is
 * what makes the next question meaningful.
 */
const checkIdentity = (
  dataschema: string,
  uri: string,
  version: string,
): ErrorIssue | null => {
  const parts = readDataschema(dataschema);
  if (!parts.ok) return parts.error;
  if (parts.value.uri !== uri) {
    return foreignContractIssue(parts.value.uri, uri);
  }
  if (parts.value.version !== version) {
    return unknownVersionIssue(parts.value.version, [version]);
  }
  return null;
};

/**
 * Which shape the event belongs to, or why it belongs to none being checked.
 *
 * `wanted` is what the caller expects, or the event's own type when they
 * expected nothing — so one lookup answers both paths. It fails when the
 * version declares no such shape, and when the event carries a type other
 * than the one expected.
 */
const resolveScope = (
  eventType: string,
  wanted: string,
  scope: ArvoContractEventAssertionScope | null,
  expectedType: string | undefined,
  declared: readonly string[],
): Result<ArvoContractEventAssertionScope, ErrorIssue> => {
  if (scope === null || eventType !== wanted) {
    return fromNeverthrow(
      err(
        typeDisagreementIssue(
          eventType,
          expectedType === undefined ? declared : [expectedType],
        ),
      ),
    );
  }
  return fromNeverthrow(ok(scope));
};

/**
 * Checks an event against one version's declaration.
 *
 * The single definition of "this event matches this version", reached by both
 * a contract and a version contract, so an event a contract takes in is
 * exactly an event one of its versions input.
 *
 * Five checks run in one order, and the first to fail is reported alone,
 * because each one establishes what the next is judged against:
 *
 * ```
 * expectedType -> event.dataschema -> uri -> version -> event.type -> event.data
 * ```
 *
 * `expectedType` leads because it is the only failure that says nothing about
 * the event: the call itself could not be answered, and replying with a fact
 * about the event would send the caller after something that was never the
 * problem. Only payload failures arrive together.
 *
 * Nothing is derived here. The identity to compare against, the version, and
 * the handler error all arrive as arguments — deriving any of them would put a
 * second copy of a rule the caller already holds inside the check that uses
 * it.
 */
export const checkAgainstVersion = (param: {
  /** The event to check. Returned by the caller as it arrived. */
  event: ArvoEvent;
  /** The contract's `type`, whose payload is its `input`. */
  type: string;
  /** The contract's identifier, compared for equality and never parsed. */
  uri: string;
  /** The one version this check is against. */
  version: string;
  input: z.$ZodType;
  outputs: Record<string, z.$ZodType>;
  /** Supplied, never derived: the caller already holds it. */
  error: HandlerErrorContract;
  /** What the caller expects the event to be, if they said. */
  expectedType?: string;
}): Result<ArvoContractEventAssertionScope, ErrorIssue[]> => {
  const { event, type, uri, version, input, outputs, error, expectedType } =
    param;

  const declared = declaredTypes(type, outputs, error.type);
  /** What is being checked against: the expectation, else the event itself. */
  const wanted = expectedType ?? event.type;
  const wantedScope = scopeOfType(wanted, type, outputs, error.type);

  const blocking =
    checkExpectation(expectedType, wantedScope, declared) ??
    checkIdentity(event.dataschema, uri, version);
  if (blocking !== null) return fromNeverthrow(err([blocking]));

  const scope = resolveScope(
    event.type,
    wanted,
    wantedScope,
    expectedType,
    declared,
  );
  if (!scope.ok) return fromNeverthrow(err([scope.error]));

  const issues = checkPayload(
    schemaForScope(scope.value, event.type, input, outputs, error),
    event.data,
  );
  return fromNeverthrow(issues.length > 0 ? err(issues) : ok(scope.value));
};

/**
 * Maps a successful outcome's value, leaving a failure untouched.
 *
 * The one shape both classes need on the way out: the check reports which
 * scope matched, and the caller turns that into the result it publishes.
 */
export const mapOk = <A, B, E>(
  outcome: Result<A, E>,
  f: (value: A) => B,
): Result<B, E> =>
  fromNeverthrow(outcome.ok ? ok(f(outcome.value)) : err(outcome.error));

/**
 * A failed assertion, for a caller that has issues rather than an outcome.
 *
 * The counterpart to {@link assertionResult} for a check that has not run
 * anything to succeed at — a version that was never declared, say.
 */
export const assertionFailure = <R>(
  issues: ErrorIssue[],
): Result<R, ArvoContractAssertionError> =>
  fromNeverthrow(err(new ArvoContractAssertionError(issues)));

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
