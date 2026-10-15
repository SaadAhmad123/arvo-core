import { err, ok } from 'neverthrow';
import type * as z from 'zod/v4/core';
import type { ArvoContract } from '../ArvoContract/index.js';
import { fromNeverthrow } from '../result.js';
import type { ArvoSemanticVersion } from '../semver/index.js';
import type { Result } from '../types.js';
import { ArvoEventHandlerValidationError } from './errors.js';
import { ARVO_NO_STATE_SCHEMA } from './helpers/defaults.js';
import { ArvoEventHandler } from './index.js';
import type {
  ArvoAccumulatedVersion,
  ArvoAccumulatedVersions,
  ArvoAnyVersionInput,
  ArvoCreatedVersion,
  ArvoVersionInput,
} from './types/declaration.js';
import type { ArvoEventHandlerOptions } from './types/options.js';
import type { ArvoServiceMap } from './types/services.js';
import type { ArvoEventHandlerSetupParam } from './types/setup.js';
import type {
  ArvoDependencies,
  ArvoMechanismHooks,
  ArvoNone,
} from './types/supplied.js';

/**
 * Both ways of writing a version, settled into the one shape a chain
 * holds, so nothing downstream handles two.
 */
const accumulate = (
  version: ArvoSemanticVersion,
  declaration: ArvoAnyVersionInput,
): ArvoAccumulatedVersion => {
  const written =
    typeof declaration === 'function' ? { execute: declaration } : declaration;
  return {
    version,
    state: written.state ?? ARVO_NO_STATE_SCHEMA,
    declaresState: written.state !== undefined,
    options: written.options ?? null,
    // a chain holds versions under differing schemas, so it cannot name
    // this one's; it was checked where it was written
    execute: written.execute as ArvoAccumulatedVersion['execute'],
  };
};

/**
 * A handler declaration part way through being written.
 *
 * Reached through `setupArvoEventHandler`, which is the one way to begin
 * one. It gains one version at a time and is finished by `build`. Each `handler` call returns a new
 * declaration rather than changing this one, so a partly written
 * declaration can be shared, reused, or branched without one use
 * affecting another.
 *
 * Nothing is judged here. A declaration that cannot work — a version
 * without an executor, two capabilities sharing a type, an option outside
 * its domain — is refused when the handler is built from it.
 *
 * @example
 * ```typescript
 * declare const setup: ArvoEventHandlerSetup<typeof orderContract>;
 *
 * const handler = setup
 *   .handler('1.0.0', {
 *     state: z.object({ orderId: z.string() }),
 *     execute: async (ctx) =>
 *       ctx.build({ type: 'com_order_created', data: { order_id: '1' } }),
 *   })
 *   .build();
 * ```
 */
export class ArvoEventHandlerSetup<
  TSelf extends ArvoContract = ArvoContract,
  TServices extends ArvoServiceMap = ArvoServiceMap,
  TDependencies extends ArvoDependencies = ArvoNone,
  TMechanismHooks extends ArvoMechanismHooks = ArvoNone,
> {
  /** What this handler is bound to: what it implements, and what it may send to. */
  readonly contracts: {
    readonly self: TSelf;
    readonly services: Readonly<TServices>;
  };

  /** What the handler declared, or `null` where it declared nothing. */
  readonly options: Partial<ArvoEventHandlerOptions> | null;

  /**
   * Where this handler's executions will record, or `null` where nothing
   * was declared and every signal is a no-op.
   */
  readonly telemetry: ArvoEventHandlerSetupParam<
    ArvoContract,
    ArvoServiceMap,
    ArvoDependencies,
    ArvoMechanismHooks
  >['telemetry'];

  /** Every version declared so far, in the order they were declared. */
  readonly versions: ArvoAccumulatedVersions;

  /**
   * @param param - The contract, what it may send to, and how its
   * versions behave unless one says otherwise.
   * @param versions - Every version declared so far. Supplied by
   * `handler` when it carries a chain forward; a caller starting a
   * declaration passes none.
   */
  constructor(
    param: ArvoEventHandlerSetupParam<
      TSelf,
      TServices,
      TDependencies,
      TMechanismHooks
    >,
    versions: ArvoAccumulatedVersions = [],
  ) {
    this.contracts = Object.freeze({
      self: param.contracts.self,
      services: Object.freeze({ ...param.contracts.services } as TServices),
    });
    this.options = param.options ?? null;
    this.telemetry = param.telemetry;
    this.versions = Object.freeze([...versions]);
    Object.freeze(this);
  }

  /**
   * Declares the executor for one version of the contract.
   *
   * Takes the version in full, or its executor alone where it remembers
   * nothing and inherits every option.
   *
   * A version written away from the chain is passed on its own: it
   * already carries the version it was written for, so nothing names it
   * twice.
   *
   * @param version - Which version of the contract this runs. Only a
   * version the contract declares will type.
   * @param declaration - What this version is, or its executor alone.
   * @returns A new declaration carrying this version, leaving this one
   * as it was.
   *
   * @example
   * ```typescript
   * setup
   *   .handler('1.0.0', { state: orderState, execute: runOrder })
   *   .handler('1.1.0', runOrderNext)
   *   .handler(writtenElsewhere);
   * ```
   */
  handler<
    TVersion extends keyof TSelf['versions'] & ArvoSemanticVersion,
    TDataSchema extends z.$ZodObject = typeof ARVO_NO_STATE_SCHEMA,
  >(
    version: TVersion,
    declaration: ArvoVersionInput<
      TSelf['versions'][TVersion],
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >,
  ): ArvoEventHandlerSetup<TSelf, TServices, TDependencies, TMechanismHooks>;
  handler(
    created: ArvoCreatedVersion<
      TSelf,
      TServices,
      TDependencies,
      TMechanismHooks
    >,
  ): ArvoEventHandlerSetup<TSelf, TServices, TDependencies, TMechanismHooks>;
  handler(
    versionOrCreated:
      | (keyof TSelf['versions'] & ArvoSemanticVersion)
      | ArvoCreatedVersion<TSelf, TServices, TDependencies, TMechanismHooks>,
    // the overloads above are what a caller is held to; this signature
    // only has to admit both of them
    declaration?: unknown,
  ): ArvoEventHandlerSetup<TSelf, TServices, TDependencies, TMechanismHooks> {
    const accumulated =
      typeof versionOrCreated === 'string'
        ? accumulate(versionOrCreated, declaration as ArvoAnyVersionInput)
        : versionOrCreated;

    return new ArvoEventHandlerSetup(
      {
        contracts: {
          self: this.contracts.self,
          services: this.contracts.services as TServices,
        },
        ...(this.options === null ? {} : { options: this.options }),
        ...(this.telemetry === undefined ? {} : { telemetry: this.telemetry }),
      },
      [...this.versions, accumulated],
    );
  }

  /**
   * Judges this declaration and builds the handler, reporting a refusal
   * rather than throwing.
   *
   * The error names every rule the declaration broke rather than the
   * first, so one attempt tells you everything to fix.
   *
   * @returns The handler, or every rule the declaration broke.
   *
   * @example
   * ```typescript
   * declare const setup: ArvoEventHandlerSetup<typeof orderContract>;
   *
   * const declared = setup.handler('1.0.0', runOrder).tryBuild();
   * if (declared.ok) declared.value.versions.get('1.0.0');
   * else declared.error.issues;
   * ```
   */
  tryBuild(): Result<
    ArvoEventHandler<TSelf, TServices, TDependencies, TMechanismHooks>,
    ArvoEventHandlerValidationError
  > {
    try {
      return fromNeverthrow(ok(new ArvoEventHandler(this)));
    } catch (raised) {
      if (raised instanceof ArvoEventHandlerValidationError) {
        return fromNeverthrow(err(raised));
      }
      // anything else is not a refused declaration, so reporting it here
      // would make the error type say something untrue
      throw raised;
    }
  }

  /**
   * Judges this declaration and builds the handler, throwing a refusal.
   *
   * For a declaration you wrote yourself and expect to be valid.
   * `tryBuild` says the same thing without throwing.
   *
   * @returns The handler.
   * @throws {ArvoEventHandlerValidationError} Where the declaration
   * breaks any rule, naming every rule it broke.
   *
   * @example
   * ```typescript
   * declare const setup: ArvoEventHandlerSetup<typeof orderContract>;
   *
   * const handler = setup.handler('1.0.0', runOrder).build();
   * ```
   */
  build(): ArvoEventHandler<TSelf, TServices, TDependencies, TMechanismHooks> {
    const declared = this.tryBuild();
    if (declared.ok) return declared.value;
    throw declared.error;
  }
}
