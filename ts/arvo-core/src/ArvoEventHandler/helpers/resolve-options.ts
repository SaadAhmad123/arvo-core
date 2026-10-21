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
 * @returns A new set, holding a value for every option.
 *
 * @example
 * ```typescript
 * const handler = resolveOptions(declared, ARVO_DEFAULT_HANDLER_OPTIONS);
 * const version = resolveOptions({ maxDepth: 250 }, handler);
 * ```
 */
export const resolveOptions = (
  declaredOptions: Partial<ArvoEventHandlerOptions> | null,
  fallbackOptions: ArvoEventHandlerOptions,
): ArvoEventHandlerOptions => {
  const options = { ...fallbackOptions };
  if (declaredOptions === null) return options;

  for (const optionName of Object.keys(
    fallbackOptions,
  ) as (keyof ArvoEventHandlerOptions)[]) {
    const option = declaredOptions[optionName];
    if (option === undefined) continue;
    // one assignment for differently typed options; the key is the same
    // on both sides, which is what the loop exists to say
    (options as Record<string, unknown>)[optionName] = option;
  }
  return options;
};
