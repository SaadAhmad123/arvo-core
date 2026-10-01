import type { ArvoContract } from '../../../ArvoContract/index.js';
import type { ArvoSemanticVersion } from '../../../semver/index.js';
import type { ArvoServiceMap } from '../../types/services.js';

/**
 * Which contract an event belongs to, and at which version.
 *
 * `self` is the contract the handler implements, `service` one it declared
 * it may send to. The version is the one the event's own `dataschema`
 * named, not one the caller supplied.
 */
export type ArvoEventOrigin = {
  /** Whose contract the event belongs to. */
  readonly source: 'self' | 'service';
  /** The version of that contract the event names. */
  readonly version: ArvoSemanticVersion;
};

/** What an event validator is built from: the contracts a handler declared. */
export type ArvoEventValidatorParam<
  TSelf extends ArvoContract = ArvoContract,
  TServices extends ArvoServiceMap = ArvoServiceMap,
> = {
  contracts: {
    /**
     * The contract implemented, whole. Every version of it, because an
     * event names its own and a validator resolves rather than is told.
     */
    self: TSelf;
    /** Every contract it may send to, each at the version declared. */
    services: TServices;
  };
};
