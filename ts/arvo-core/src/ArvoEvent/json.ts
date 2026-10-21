import type {
  FlatMap,
  JSONArray,
  JSONObject,
  JSONScalar,
  JSONValue,
} from '../types.js';
import { ErrorIssue } from '../utils/error-issue.js';
import { textOfThrown } from '../utils/thrown-text.js';

/**
 * The outcome of walking a value: the normalized, frozen result and every
 * rule it broke. `value` is only meaningful when `issues` is empty.
 */
export type JSONWalkResult<T> = {
  value: T;
  issues: ErrorIssue[];
};

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Extends a path with a map key, bracketing keys that are not identifiers. */
const keyPath = (path: string, key: string): string =>
  IDENTIFIER.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;

/** Extends a path with an array index. */
const indexPath = (path: string, index: number): string => `${path}[${index}]`;

/** Sentinel returned by {@link classifyScalar} for a value that is not a scalar. */
const NOT_SCALAR = Symbol('json.not-scalar');

/**
 * Classifies a value as a JSON scalar, or reports it and returns
 * {@link NOT_SCALAR}.
 *
 * Shared between the payload walk and the ambient-context walk so a bigint,
 * function, symbol, or non-finite number is diagnosed identically wherever it
 * appears. Does not report an object or an array — whether one is allowed
 * there is the caller's decision, not this function's.
 */
const classifyScalar = (
  candidate: unknown,
  path: string,
  issues: ErrorIssue[],
): JSONScalar | typeof NOT_SCALAR => {
  if (candidate === null) return null;

  switch (typeof candidate) {
    case 'string':
    case 'boolean':
      return candidate;

    case 'number':
      if (!Number.isFinite(candidate)) {
        issues.push(
          new ErrorIssue({
            path,
            message:
              'must be a finite number. NaN and Infinity have no JSON representation and would not survive transmission',
            received: candidate,
          }),
        );
        return NOT_SCALAR;
      }
      return candidate;

    case 'bigint':
      issues.push(
        new ErrorIssue({
          path,
          message:
            'is a bigint, which JSON cannot represent. Convert it to a number if it fits, or to a string if it does not',
          received: candidate,
        }),
      );
      return NOT_SCALAR;

    case 'function':
      issues.push(
        new ErrorIssue({
          path,
          message: 'is a function, which cannot be carried in an event payload',
        }),
      );
      return NOT_SCALAR;

    case 'symbol':
      issues.push(
        new ErrorIssue({
          path,
          message: 'is a symbol, which JSON cannot represent',
          received: candidate,
        }),
      );
      return NOT_SCALAR;

    default:
      // object, array, or undefined — not this function's concern
      return NOT_SCALAR;
  }
};

/**
 * True for objects that carry JSON data rather than behaviour: object
 * literals, `Object.create(null)`, and nothing else.
 *
 * By the time this runs, anything with a callable `toJSON` — `Date`
 * included — has already been resolved to its serialized form and walked in
 * its place. What reaches this check is a non-plain object with no `toJSON`:
 * a `Map`, a `Set`, a `RegExp`, or a class instance that never opted into a
 * serialization. Those are rejected rather than silently coerced —
 * `JSON.stringify` would quietly turn most of them into `{}`, discarding
 * their contents with no signal that anything was lost.
 */
const isPlainObject = (candidate: object): boolean => {
  const prototype = Object.getPrototypeOf(candidate);
  return prototype === Object.prototype || prototype === null;
};

/** Names a rejected object's type well enough to act on. */
const constructorName = (instance: object): string =>
  Object.getPrototypeOf(instance)?.constructor?.name ?? 'object';

/**
 * Walks one value, collecting issues and returning its normalized form.
 *
 * `ancestors` holds the objects on the path from the root to here, which is
 * what distinguishes a cycle from a value that merely appears twice. Repeated
 * references are legal — JSON duplicates them — while a cycle has no JSON
 * representation at all.
 */
const walk = (
  input: unknown,
  path: string,
  issues: ErrorIssue[],
  ancestors: Set<object>,
): JSONValue => {
  const scalar = classifyScalar(input, path, issues);
  if (scalar !== NOT_SCALAR) return scalar;

  if (typeof input !== 'object' || input === null) {
    // undefined, bigint, function, or symbol. undefined is silently absent;
    // the other three were already reported by classifyScalar above.
    return null;
  }

  const node = input;

  if (ancestors.has(node)) {
    issues.push(
      new ErrorIssue({
        path,
        message:
          'is a circular reference. An event must be representable as JSON, and a cycle has no JSON form',
      }),
    );
    return null;
  }

  if (Array.isArray(node)) {
    ancestors.add(node);
    const normalizedArray = node.map((element, index) =>
      walk(element, indexPath(path, index), issues, ancestors),
    );
    ancestors.delete(node);
    return Object.freeze(normalizedArray) as JSONArray;
  }

  const toJSON = (node as { toJSON?: unknown }).toJSON;
  if (typeof toJSON === 'function') {
    ancestors.add(node);
    let toJSONOutput: unknown;
    try {
      toJSONOutput = toJSON.call(node);
    } catch (thrown) {
      ancestors.delete(node);
      issues.push(
        new ErrorIssue({
          path,
          message: `toJSON() threw: ${textOfThrown(thrown)}`,
        }),
      );
      return null;
    }
    const normalizedSerialization = walk(toJSONOutput, path, issues, ancestors);
    ancestors.delete(node);
    return normalizedSerialization;
  }

  if (!isPlainObject(node)) {
    issues.push(
      new ErrorIssue({
        path,
        message: `is a ${constructorName(node)}, which has no JSON representation. Convert it to a plain object, array, or scalar first`,
      }),
    );
    return null;
  }

  ancestors.add(node);
  const normalizedMap: JSONObject = {};
  for (const [key, element] of Object.entries(node)) {
    // Absent rather than invalid: an undefined map value is dropped, exactly
    // as serializing the object would have dropped it.
    if (element === undefined) continue;
    normalizedMap[key] = walk(element, keyPath(path, key), issues, ancestors);
  }
  ancestors.delete(node);
  return Object.freeze(normalizedMap);
};

/**
 * Walks an event payload: validates it against the JSON value domain,
 * normalizes it, and deep-freezes the result.
 *
 * The top level must be a map. An array or scalar is rejected, because a
 * payload's keys are what a contract names.
 */
export const walkPayload = (
  input: unknown,
  path: string,
): JSONWalkResult<JSONObject> => {
  const issues: ErrorIssue[] = [];

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    issues.push(
      new ErrorIssue({
        path,
        message: 'must be an object of JSON values',
        received: input,
      }),
    );
    return { value: Object.freeze({}), issues };
  }

  const payload = walk(input, path, issues, new Set());
  return { value: payload as JSONObject, issues };
};

/**
 * Walks ambient context: a map of scalars with no nesting at any depth.
 *
 * Flatness is checked here rather than by reusing the payload walk, so that a
 * nested value is reported as nesting rather than as a valid inner structure.
 */
export const walkFlatMap = (
  input: unknown,
  path: string,
): JSONWalkResult<FlatMap> => {
  const issues: ErrorIssue[] = [];

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    issues.push(
      new ErrorIssue({
        path,
        message: 'must be an object whose values are all scalars',
        received: input,
      }),
    );
    return { value: Object.freeze({}), issues };
  }

  const flatMap: FlatMap = {};
  for (const [key, element] of Object.entries(input)) {
    if (element === undefined) continue;

    const entryPath = keyPath(path, key);
    const scalar = classifyScalar(element, entryPath, issues);

    if (scalar !== NOT_SCALAR) {
      flatMap[key] = scalar;
      continue;
    }

    if (typeof element === 'object' && element !== null) {
      issues.push(
        new ErrorIssue({
          path: entryPath,
          message:
            'must be a string, number, boolean, or null. Ambient context is flat, so it cannot nest — anything structured belongs in the payload',
          received: element,
        }),
      );
    }
    // else: bigint, function, or symbol — classifyScalar already reported it
  }

  return { value: Object.freeze(flatMap), issues };
};
