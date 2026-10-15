import type * as z from 'zod/v4/core';

/**
 * A payload inferred from a schema, re-established as an object.
 *
 * `z.infer` over a schema TypeScript has not resolved yields `unknown`,
 * which an event's payload will not accept. This narrows it back.
 */
export type PayloadOf<TSchema> = TSchema extends z.$ZodType
  ? z.infer<TSchema> extends infer TPayload
    ? TPayload extends Record<string, any>
      ? TPayload
      : never
    : never
  : never;
