import { z } from 'zod';

/**
 * Payload of every handler error. Identical for every contract and every
 * version, so this one schema is shared rather than rebuilt per contract.
 */
export const HANDLER_ERROR_SCHEMA = z.object({
  error_name: z.string(),
  error_message: z.string(),
  error_stack: z.string().nullable(),
});

/** The handler error event type for a contract of this `type`. */
export const handlerErrorType = <T extends string>(
  type: T,
): `handler_${T}_error` => `handler_${type}_error`;

/**
 * The error a handler emits when its own code fails, or when it cannot do
 * what its contract declared.
 *
 * Shaped like an entry of `emits` so a handler can treat everything it may
 * emit the same way, but it never appears in `emits`: every version has one,
 * including a version declaring no emits at all. Its `dataschema` is that of
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
