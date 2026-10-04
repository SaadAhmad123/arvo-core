import type { ArvoContract } from '../ArvoContract/index.js';
import type { ArvoSemanticVersion } from '../semver/index.js';
import type { ErrorIssue } from '../utils/error-issue.js';
import { pathSegmentForKey } from '../utils/issue-path.js';
import { ArvoEventHandlerValidationError } from './errors.js';
import { checkCollisions } from './helpers/check-collisions.js';
import { checkContract } from './helpers/check-contract.js';
import { checkOptions } from './helpers/check-options.js';
import { checkServices } from './helpers/check-services.js';
import { checkTimeouts } from './helpers/check-timeouts.js';
import { checkVersions } from './helpers/check-versions.js';
import { ARVO_DEFAULT_HANDLER_OPTIONS } from './helpers/defaults.js';
import { resolveOptions } from './helpers/resolve-options.js';
import type { ArvoEventHandlerSetup } from './setup.js';
import type { ArvoEventHandlerOptions } from './types/options.js';
import type { ArvoServiceMap } from './types/services.js';
import type {
  ArvoDependencies,
  ArvoMechanismHooks,
  ArvoNone,
} from './types/supplied.js';
import type { ArvoVersionMap } from './types/version-map.js';
import { ArvoEventHandlerVersion } from './version/index.js';

/**
 * A handler, declared and judged: one contract implemented, one executor
 * for each version it declares, and the contracts it may send to.
 *
 * Reached by declaring one through `setupArvoEventHandler` and finishing
 * with `build`. A handler that exists is one every declaration rule
 * accepted, so nothing downstream re-checks the declaration.
 *
 * It holds nothing between executions and reaches no store.
 *
 * @example
 * ```typescript
 * declare const handler: ArvoEventHandler<typeof orderContract>;
 *
 * handler.contracts.self.type;                     // what it implements
 * handler.versions.get('1.0.0').options.maxDepth;  // what that version runs under
 * ```
 */
export class ArvoEventHandler<
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

  /** Every option this handler holds, which each version falls back to. */
  readonly options: ArvoEventHandlerOptions;

  /** Every version of the contract, reachable by the version it runs. */
  readonly versions: ArvoVersionMap<
    TSelf,
    TServices,
    TDependencies,
    TMechanismHooks
  >;

  /**
   * Judges a finished declaration and holds what it accepted.
   *
   * Not the way to declare a handler: `setupArvoEventHandler` begins one
   * and `build` finishes it, which is what reaches this.
   *
   * @param setup - The declaration, with every version on it.
   * @throws {ArvoEventHandlerValidationError} Where the declaration
   * breaks any rule, naming every rule it broke.
   */
  constructor(
    setup: ArvoEventHandlerSetup<
      TSelf,
      TServices,
      TDependencies,
      TMechanismHooks
    >,
  ) {
    const contract = setup.contracts.self;
    const services = setup.contracts.services;

    const unreadable = checkContract(contract);
    if (unreadable.length > 0) {
      throw new ArvoEventHandlerValidationError(unreadable);
    }

    const handlerOptions = resolveOptions(
      setup.options,
      ARVO_DEFAULT_HANDLER_OPTIONS,
    );

    const issues: ErrorIssue[] = [
      ...checkOptions(setup.options, 'options'),
      ...checkVersions(
        contract,
        setup.versions.map((declared) => declared.version),
      ),
      ...checkServices(services),
      ...checkCollisions(contract, services),
    ];

    const optionsByVersion = new Map<string, ArvoEventHandlerOptions>();
    for (const declared of setup.versions) {
      const declaredAt = `versions${pathSegmentForKey(declared.version)}`;
      issues.push(...checkOptions(declared.options, `${declaredAt}.options`));

      const inForce = resolveOptions(declared.options, handlerOptions);
      issues.push(...checkTimeouts(inForce, declaredAt));
      optionsByVersion.set(declared.version, inForce);
    }

    if (issues.length > 0) throw new ArvoEventHandlerValidationError(issues);

    const versions = new Map<string, ArvoEventHandlerVersion>();
    for (const declared of setup.versions) {
      versions.set(
        declared.version,
        new ArvoEventHandlerVersion({
          contracts: {
            self: contract.versions[
              declared.version as keyof TSelf['versions'] & ArvoSemanticVersion
            ],
            services,
          },
          // every version was judged above, so each has one in force
          options: optionsByVersion.get(
            declared.version,
          ) as ArvoEventHandlerOptions,
          state: declared.state,
          execute: declared.execute,
        }),
      );
    }

    this.contracts = Object.freeze({
      self: contract,
      services: Object.freeze({ ...services }),
    });
    this.options = Object.freeze(handlerOptions);
    this.versions = versions as unknown as ArvoVersionMap<
      TSelf,
      TServices,
      TDependencies,
      TMechanismHooks
    >;
    Object.freeze(this);
  }
}
