import type { ArvoEvent } from '../../ArvoEvent/index.js';

/** How many hex characters SHA-256 produces. */
const EXECUTION_ID_LENGTH = 64;

/**
 * The identifier of the execution an init event opens.
 *
 * Derived, not minted, so a redelivered init event resolves to the
 * execution the first delivery opened rather than forking a new one.
 * Derive once, when an execution is entered; on every later delivery the
 * identifier is read off the record.
 *
 * SHA-256 over the UTF-8 bytes of `dataschema`, the byte `0x00`, then the
 * UTF-8 bytes of `id`, as 64 lowercase hex characters. Every part of that
 * is fixed, and two implementations differing on any of it fork an
 * execution on every redelivery.
 *
 * @param initEvent - The event opening the execution.
 *
 * @example
 * ```typescript
 * const executionId = await deriveArvoExecutionId(initEvent);
 * const stored = await store.get(executionId);
 * ```
 */
export const deriveArvoExecutionId = async (
  initEvent: ArvoEvent,
): Promise<string> => {
  const encoder = new TextEncoder();
  const dataschema = encoder.encode(initEvent.dataschema);
  const id = encoder.encode(initEvent.id);

  const input = new Uint8Array(dataschema.length + 1 + id.length);
  input.set(dataschema, 0);
  input[dataschema.length] = 0x00;
  input.set(id, dataschema.length + 1);

  const digest = await crypto.subtle.digest('SHA-256', input);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

/** Whether a string is shaped like a derived execution identifier. */
export const isArvoExecutionId = (value: unknown): boolean =>
  typeof value === 'string' &&
  value.length === EXECUTION_ID_LENGTH &&
  /^[0-9a-f]+$/.test(value);
