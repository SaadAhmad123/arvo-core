import type { ArvoContract } from '../ArvoContract/index.js';
import { ArvoEventHandlerSetup } from '../ArvoEventHandler/setup.js';
import type { ArvoServiceMap } from '../ArvoEventHandler/types/services.js';
import type { ArvoEventHandlerSetupParam } from '../ArvoEventHandler/types/setup.js';
import type {
  ArvoDependencies,
  ArvoMechanismHooks,
  ArvoNone,
} from '../ArvoEventHandler/types/supplied.js';

/**
 * Begins a handler declaration.
 *
 * Declare the contract being implemented, what it may send to, and how its
 * versions behave unless one says otherwise. Then add one executor per
 * version with `handler`, and finish with `build`.
 *
 * Nothing is judged until then: a declaration that cannot work is refused
 * where it is built, naming every rule it broke at once.
 *
 * @param param - The contract, its services, its options, and the types a
 * mechanism will supply. See {@link ArvoEventHandlerSetupParam}.
 * @returns A declaration to add versions to.
 *
 * @example
 * ```typescript
 * const handler = setupArvoEventHandler({
 *   contracts: {
 *     self: orderContract,
 *     services: { payments: paymentContract.versions['1.0.0'] },
 *   },
 * })
 *   .handler('1.0.0', {
 *     state: z.object({ orderId: z.string() }),
 *     execute: async (ctx) =>
 *       ctx.build({ type: 'com_payment_charge', data: { amount: 10 } }),
 *   })
 *   .build();
 * ```
 */
export const setupArvoEventHandler = <
  TSelf extends ArvoContract,
  TServices extends ArvoServiceMap = ArvoNone,
  TDependencies extends ArvoDependencies = ArvoNone,
  TMechanismHooks extends ArvoMechanismHooks = ArvoNone,
>(
  param: ArvoEventHandlerSetupParam<
    TSelf,
    TServices,
    TDependencies,
    TMechanismHooks
  >,
): ArvoEventHandlerSetup<TSelf, TServices, TDependencies, TMechanismHooks> =>
  new ArvoEventHandlerSetup<TSelf, TServices, TDependencies, TMechanismHooks>(
    param,
  );
