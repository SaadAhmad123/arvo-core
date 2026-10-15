import type * as z from 'zod/v4/core';
import type { ArvoContract } from '../ArvoContract/index.js';
import { ARVO_NO_STATE_SCHEMA } from '../ArvoEventHandler/helpers/defaults.js';
import type { ArvoEventHandlerSetup } from '../ArvoEventHandler/setup.js';
import type {
  ArvoAccumulatedVersion,
  ArvoCreatedVersion,
  ArvoVersionInput,
} from '../ArvoEventHandler/types/declaration.js';
import type { ArvoServiceMap } from '../ArvoEventHandler/types/services.js';
import type {
  ArvoDependencies,
  ArvoMechanismHooks,
} from '../ArvoEventHandler/types/supplied.js';
import type { ArvoSemanticVersion } from '../semver/index.js';

/**
 * Writes one version away from the chain that will assemble it.
 *
 * For a version long enough to want its own file. The declaration it
 * belongs to is passed in so the executor's context is typed exactly as
 * it would be written inline — the contracts it may send to, what the
 * mechanism supplies, and the schema this version declares.
 *
 * What comes back carries the version it was written for, so assembling
 * it names that version once overall: `setup.handler(written)`.
 *
 * Nothing is judged here, and there is no reporting twin: creating a
 * version cannot fail. A version the contract does not declare, an
 * option outside its domain, a clock relation that cannot hold — each is
 * refused where the handler is built.
 *
 * @param _setup - The declaration this version belongs to. Read for its
 * types alone — nothing at runtime touches it, which the leading
 * underscore marks.
 * @param version - Which version of the contract this runs.
 * @param declaration - What this version is, or its executor alone.
 * @returns The version, ready to be assembled into that declaration.
 *
 * @example
 * ```typescript
 * export const orderV1 = createArvoEventHandlerVersion(setup, '1.0.0', {
 *   state: z.object({ orderId: z.string() }),
 *   execute: async (ctx) =>
 *     ctx.build({ type: 'com_payment_charge', data: { amount: 10 } }),
 * });
 *
 * const handler = setup.handler(orderV1).build();
 * ```
 */
export const createArvoEventHandlerVersion = <
  TSelf extends ArvoContract,
  TServices extends ArvoServiceMap,
  TDependencies extends ArvoDependencies,
  TMechanismHooks extends ArvoMechanismHooks,
  TVersion extends keyof TSelf['versions'] & ArvoSemanticVersion,
  TDataSchema extends z.$ZodObject = typeof ARVO_NO_STATE_SCHEMA,
>(
  _setup: ArvoEventHandlerSetup<
    TSelf,
    TServices,
    TDependencies,
    TMechanismHooks
  >,
  version: TVersion,
  declaration: ArvoVersionInput<
    TSelf['versions'][TVersion],
    TServices,
    TDataSchema,
    TDependencies,
    TMechanismHooks
  >,
): ArvoCreatedVersion<TSelf, TServices, TDependencies, TMechanismHooks> => {
  const written =
    typeof declaration === 'function' ? { execute: declaration } : declaration;

  return {
    version,
    state: written.state ?? ARVO_NO_STATE_SCHEMA,
    declaresState: written.state !== undefined,
    options: written.options ?? null,
    // checked against this version's own types just above; what the chain
    // holds cannot name them for every version at once
    execute: written.execute as ArvoAccumulatedVersion['execute'],
    // the binding to this declaration is for the compiler alone, so the
    // value carries nothing for it
  } as unknown as ArvoCreatedVersion<
    TSelf,
    TServices,
    TDependencies,
    TMechanismHooks
  >;
};
