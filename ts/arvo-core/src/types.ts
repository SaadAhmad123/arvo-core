/** A string, number, boolean, or null. */
export type JSONScalar = string | number | boolean | null;

/** An array of JSON values. */
export type JSONArray = JSONValue[];

/** A string-keyed map of JSON values. */
export type JSONObject = { [key: string]: JSONValue };

/** Any JSON value: a scalar, an array, or an object. */
export type JSONValue = JSONScalar | JSONArray | JSONObject;

/**
 * A string-keyed map of scalars, with no nesting at any depth.
 *
 * The shape of an ArvoEvent's `baggage`.
 */
export type FlatMap = { [key: string]: JSONScalar };

/** The outcome of an operation that succeeded, carrying its value. */
export type Ok<R> = { readonly ok: true; readonly value: R };

/** The outcome of an operation that failed, carrying its error. */
export type Err<E> = { readonly ok: false; readonly error: E };

/**
 * The outcome of a fallible operation: either success, carrying a value, or
 * failure, carrying an error. Narrows on `ok`:
 *
 * ```typescript
 * if (result.ok) {
 *   result.value;
 * } else {
 *   result.error;
 * }
 * ```
 */
export type Result<R, E> = Ok<R> | Err<E>;

/** A {@link Result} produced by an asynchronous operation. */
export type AsyncResult<R, E> = Promise<Result<R, E>>;

export type PartialExcept<T extends object, E extends keyof T> = Partial<T> &
  Required<Pick<T, E>>;
