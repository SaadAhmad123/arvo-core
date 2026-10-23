import type { ArvoAnyEventHandler } from '../typing.js';

/**
 * The largest run timeout any version of any handler resolves to, in
 * milliseconds, or `null` where none sets one.
 *
 * @param handlers - The set's flattened handlers.
 */
export const longestRunTimeoutMs = (
  handlers: readonly ArvoAnyEventHandler[],
): number | null => {
  let longest: number | null = null;
  for (const handler of handlers) {
    for (const version of handler.versions.values()) {
      const { runTimeout } = version.options;
      if (runTimeout !== null && (longest === null || runTimeout > longest)) {
        longest = runTimeout;
      }
    }
  }
  return longest;
};
