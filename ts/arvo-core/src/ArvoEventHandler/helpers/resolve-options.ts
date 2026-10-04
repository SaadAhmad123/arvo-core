import type { ArvoEventHandlerOptions } from '../types/options.js';

/**
 * Settles every option from what one level declared and what it falls back
 * to.
 *
 * An option is taken from `declared` where it was written and from
 * `fallback` where it was not. Only an absent key counts as not written:
 * `null` is a value, so a clock written `null` is unbounded rather than
 * inherited.
 *
 * The fallback is always passed, never assumed, so which level is being
 * settled reads at the call site. Handler against the protocol's own
 * values, then version against the handler.
 *
 * @param declared - What this level wrote, or `null` where it wrote nothing.
 * @param fallback - What every option is where this level left it alone.
 * @returns A new set, holding a value for all seven.
 *
 * @example
 * ```typescript
 * const handler = resolveOptions(declared, ARVO_DEFAULT_HANDLER_OPTIONS);
 * const version = resolveOptions({ maxDepth: 250 }, handler);
 * ```
 */
export const resolveOptions = (
  declared: Partial<ArvoEventHandlerOptions> | null,
  fallback: ArvoEventHandlerOptions,
): ArvoEventHandlerOptions => {
  const settled = { ...fallback };
  if (declared === null) return settled;

  for (const key of Object.keys(
    fallback,
  ) as (keyof ArvoEventHandlerOptions)[]) {
    const written = declared[key];
    if (written === undefined) continue;
    // one assignment for seven differently typed options; the key is the
    // same on both sides, which is what the loop exists to say
    (settled as Record<string, unknown>)[key] = written;
  }
  return settled;
};
