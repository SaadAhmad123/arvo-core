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
