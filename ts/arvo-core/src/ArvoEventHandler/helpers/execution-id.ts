import type { ArvoEvent } from '../../ArvoEvent/index.js';

/** How many hex characters SHA-256 produces. */
const EXECUTION_ID_LENGTH = 64;

/**
 * The identifier of the execution an init event opens.
 *
 * Derived, not minted, so an init event arriving twice resolves to the
 * execution the first execution opened rather than forking a new one.
 * Derive once, when an execution is entered; on every later execution the
 * identifier is read off the record.
 *
 * SHA-256 over the UTF-8 bytes of `dataschema`, the byte `0x00`, then the
 * UTF-8 bytes of `id`, as 64 lowercase hex characters. Every part of that
 * is fixed, and two implementations differing on any of it fork an
 * execution on every reexecution.
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
  const dataschemaBytes = encoder.encode(initEvent.dataschema);
  const eventIdBytes = encoder.encode(initEvent.id);

  const digestInput = new Uint8Array(
    dataschemaBytes.length + 1 + eventIdBytes.length,
  );
  digestInput.set(dataschemaBytes, 0);
  digestInput[dataschemaBytes.length] = 0x00;
  digestInput.set(eventIdBytes, dataschemaBytes.length + 1);

  const digest = await crypto.subtle.digest('SHA-256', digestInput);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

/** Whether a string is shaped like a derived execution identifier. */
export const isArvoExecutionId = (candidate: unknown): boolean =>
  typeof candidate === 'string' &&
  candidate.length === EXECUTION_ID_LENGTH &&
  /^[0-9a-f]+$/.test(candidate);
