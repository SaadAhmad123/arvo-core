import type { ArvoEventHandlerOptions } from '../types/options.js';
import { OPTION_KEYS } from './defaults.js';

/**
 * One option's value: what was declared here, or the fallback's.
 *
 * An option is inherited when its own value is `undefined`, which covers an
 * absent key and one written `undefined` alike, since a call site cannot
 * distinguish them and both mean the same thing. A written `null` is a value
 * and survives, which is what keeps unbounded distinct from inherited.
 *
 * Whether anything was declared at all is a separate question, answered by
 * `null` for the whole bag.
 */
const declaredOr = <K extends keyof ArvoEventHandlerOptions>(
  key: K,
  declared: Partial<ArvoEventHandlerOptions> | null,
  fallback: ArvoEventHandlerOptions,
): ArvoEventHandlerOptions[K] =>
  declared?.[key] === undefined
    ? fallback[key]
    : (declared[key] as ArvoEventHandlerOptions[K]);

/**
 * What one level runs with: its own value per option where it wrote one, the
 * fallback's otherwise.
 *
 * The fallback is always passed, never assumed, so which level is being
 * resolved is read at the call rather than inferred. A handler resolves
 * against `DEFAULT_OPTIONS`; a version resolves against the handler's, which
 * is complete by then and so cannot itself be missing a value.
 *
 * @param declared - What this level wrote, or `null` where it wrote nothing.
 * @param fallback - A complete set to inherit from.
 */
export const resolveOptions = (
  declared: Partial<ArvoEventHandlerOptions> | null,
  fallback: ArvoEventHandlerOptions,
): ArvoEventHandlerOptions =>
  Object.freeze(
    Object.fromEntries(
      OPTION_KEYS.map((key) => [key, declaredOr(key, declared, fallback)]),
    ),
  ) as ArvoEventHandlerOptions;
