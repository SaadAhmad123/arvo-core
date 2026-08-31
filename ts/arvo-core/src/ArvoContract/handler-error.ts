import * as z from 'zod/v4/core';

/**
 * The two schema constructors this module needs, each keeping the type of what
 * it was given.
 *
 * `zod/v4/core`'s constructors accept no type arguments and widen their shape
 * to an index signature, so a schema built through them directly infers
 * nothing — `z.input` of it would be `{ [k: string]: unknown }`. These
 * restate the type the runtime object actually has. The cast is confined to
 * one line each rather than spreading to whatever is built from them.
 */
const string = (): z.$ZodString<string> =>
  new z.$ZodString({ type: 'string' }) as unknown as z.$ZodString<string>;

const nullable = <T extends z.$ZodType>(innerType: T): z.$ZodNullable<T> =>
  new z.$ZodNullable({ type: 'nullable', innerType }) as z.$ZodNullable<T>;

const object = <S extends Record<string, z.$ZodType>>(
  shape: S,
): z.$ZodObject<S> =>
  new z.$ZodObject({ type: 'object', shape }) as unknown as z.$ZodObject<S>;

/**
 * Payload of every handler error. Identical for every contract and every
 * version, so this one schema is shared rather than rebuilt per contract.
 */
export const HANDLER_ERROR_SCHEMA = object({
  error_name: string(),
  error_message: string(),
  error_stack: nullable(string()),
});

/** The handler error event type for a contract of this `type`. */
export const handlerErrorType = <T extends string>(
  type: T,
): `handler_${T}_error` => `handler_${type}_error`;

/**
 * The error a handler puts out when its own code fails, or when it cannot do
 * what its contract declared.
 *
 * Shaped like an entry of `outputs` so a handler can treat everything it may
 * put out the same way, but it never appears in `outputs`: every version has
 * one, including a version declaring none at all. Its `dataschema` is that of
 * the version that produced it, so a caught error still says which version
 * was running.
 */
export type HandlerErrorContract<T extends string = string> = {
  readonly type: `handler_${T}_error`;
  readonly schema: typeof HANDLER_ERROR_SCHEMA;
};

/** Builds the {@link HandlerErrorContract} for a contract of this `type`. */
export const handlerErrorContract = <T extends string>(
  type: T,
): HandlerErrorContract<T> =>
  Object.freeze({
    type: handlerErrorType(type),
    schema: HANDLER_ERROR_SCHEMA,
  });

/**
 * The event type of the handler error a contract of this `type` carries.
 *
 * The one place this string's shape is written at the type level, so a rule
 * about how it is formed has a single copy.
 */
export type HandlerErrorType<T extends string = string> =
  HandlerErrorContract<T>['type'];

/** The payload of a handler error, as it arrives on the wire. */
export type HandlerErrorPayload = z.input<typeof HANDLER_ERROR_SCHEMA>;
