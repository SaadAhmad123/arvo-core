/** A single JSON scalar value: string, number, boolean, or null. */
export type JSONPrimitive = string | number | boolean | null;
/** Any valid JSON value: a scalar, an array of JSON values, or a JSON object. */
export type JSONValue = JSONPrimitive | JSONArray | JSONRecord;
/** A JSON array — an array of any valid JSON value. */
export type JSONArray = JSONValue[];
/** A JSON object: a string-keyed record whose values are any JSON value. For a scalar-only record, use `Record<string, JSONPrimitive>` directly instead. */
export type JSONRecord = { [key: string]: JSONValue };

/**
 * Intersects `T` with a mapped type that poisons every key in `Known` to
 * `never`, so an object literal (or a variable) supplying one of those keys
 * fails to typecheck. Used to guarantee `ArvoEvent`'s `extensions` can never
 * collide with one of its own known field names.
 */
export type NoKnownKeys<T, Known extends string> = T & { [K in Known]?: never };
