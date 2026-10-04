import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import type { ArvoServiceMap } from '../types/services.js';

/**
 * Every event type one version of a handler may emit.
 *
 * What each declared service takes in, every output this version declares,
 * and this version's handler error type. Nothing else: an execution that
 * emits a type outside this set is refused.
 *
 * The set is per version, not per handler. Two versions of one contract
 * share their service types and differ in their outputs and their handler
 * error type.
 *
 * Returning it says nothing about whether an executor may emit a given
 * member — the handler error type is in the set because the handler emits
 * it, and is refused where an executor returns it.
 *
 * @param self - The version whose outputs and handler error these are.
 * @param services - The contracts this handler may send to.
 * @returns The closed set, in no particular order.
 *
 * @example
 * ```typescript
 * const emittable = emittableTypes(orderVersion, { payments });
 * emittable.has('com_payment_charge'); // true
 * ```
 */
export const emittableTypes = (
  self: VersionedArvoContract,
  services: ArvoServiceMap,
): ReadonlySet<string> => {
  const emittable = new Set<string>();
  for (const service of Object.values(services)) emittable.add(service.type);
  for (const output of Object.keys(self.outputs)) emittable.add(output);
  emittable.add(self.error.type);
  return emittable;
};
