import type * as z from 'zod/v4/core';
import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import type { ArvoDomainInput } from '../../ArvoDomain/types.js';
import type { ArvoEvent } from '../../ArvoEvent/index.js';
import type { ArvoEventParam } from '../../ArvoEvent/types.js';
import type { TraceContextParam } from '../../factories/ArvoEventFactory/types.js';
import type { ArvoExecutionContextTelemetry } from '../context/telemetry/index.js';
import type { ArvoExecutionState } from '../state/index.js';
import type { PayloadOf } from '../types/schema.js';
import type { ArvoServiceMap } from '../types/services.js';

/** Where an emitted event goes: to a service, or back to the caller. */
export type ArvoEmissionTarget<TSelf extends VersionedArvoContract> =
  | { readonly role: 'service'; readonly contract: VersionedArvoContract }
  | { readonly role: 'completion'; readonly contract: TSelf };

/** Each type this version may emit, against the schema it selects. */
export type ArvoEmittableSchemas<
  TSelf extends VersionedArvoContract,
  TServices extends ArvoServiceMap,
> = {
  [TOutput in keyof TSelf['outputs'] & string]: TSelf['outputs'][TOutput];
} & {
  [TService in keyof TServices as TServices[TService]['type'] &
    string]: TServices[TService]['input'];
};

/** Every event type this version may emit. */
export type ArvoEmittableType<
  TSelf extends VersionedArvoContract,
  TServices extends ArvoServiceMap,
> = keyof ArvoEmittableSchemas<TSelf, TServices> & string;

/**
 * Fields already set correctly, whose wrong value spoils a reply path, a
 * correlation, a trace, or the whole workflow rather than only this event.
 *
 * Setting one is permitted, not blessed. An override that breaks a rule
 * of the event model emits a non-conformant event, and the consequences
 * are yours and whoever downstream never chose them.
 */
export type ArvoUnsafeEmissionFields = Pick<
  ArvoEventParam,
  | 'executionid'
  | 'to'
  | 'subject'
  | 'initid'
  | 'id'
  | 'parentid'
  | 'depth'
  | 'category'
  | 'baggage'
  | 'time'
> &
  TraceContextParam;

/**
 * What an executor says to build an event. Naming a `type` fixes what
 * `data` may be. Everything not listed here is the protocol's to fill in.
 */
export type ArvoEmissionParam<
  TSelf extends VersionedArvoContract,
  TServices extends ArvoServiceMap,
> = {
  [TType in ArvoEmittableType<TSelf, TServices>]: {
    /** A declared service's input type, or one of this version's outputs. */
    type: TType;
    /** The payload, which follows from `type`. */
    data: z.input<ArvoEmittableSchemas<TSelf, TServices>[TType]>;
    /** Which processing path fulfils this event. Omit for none. */
    domain?: ArvoDomainInput;
    /** What this event cost, for whoever reads cost reporting. */
    executionunits?: ArvoEventParam['executionunits'];
    /** Fields whose wrong value spoils something beyond this execution. */
    unsafe?: ArvoUnsafeEmissionFields;
  };
}[ArvoEmittableType<TSelf, TServices>];

/** The event an emission produces, typed by the type it names. */
export type ArvoEmittedEvent<
  TSelf extends VersionedArvoContract,
  TServices extends ArvoServiceMap,
  TType extends ArvoEmittableType<TSelf, TServices>,
> = ArvoEvent<TType, PayloadOf<ArvoEmittableSchemas<TSelf, TServices>[TType]>>;

/** Why an event could not be built, in the vocabulary a fault reports in. */
export type ArvoEmissionRefusal = {
  /** Which fault this is. */
  readonly faultKind: 'emission_not_permitted' | 'emission_schema_rejected';
  /** What was wrong, readable without this source at hand. */
  readonly message: string;
  /** Every check that failed, where the schema collected any. */
  readonly violations: readonly string[];
};

/** Everything the addressing defaults are read from. */
export type ArvoEmissionContext<
  TSelf extends VersionedArvoContract,
  TServices extends ArvoServiceMap,
> = {
  /** This version of the contract implemented. */
  self: TSelf;
  /** Every contract this version may send to. */
  services: TServices;
  /** The execution the event is emitted from. */
  state: ArvoExecutionState;
  /** The execution's tracing, which every emitted event descends from. */
  telemetry: ArvoExecutionContextTelemetry;
};

/**
 * What addressing a handler error event takes: where the execution sits,
 * and who it answers to.
 *
 * Read off the record where there is one, and off the event that caused
 * the execution where there is not.
 */
export type ArvoHandlerErrorAddressing = {
  /** The contract the execution implements, by its addressable name. */
  source: string;
  /** The workflow the execution belongs to. */
  subject: string;
  /** How far from the workflow's first event the execution sits. */
  depth: number;
  /** The execution this one answers to. */
  parentExecutionId: string;
  /** The event that opened the execution, whose source is the caller. */
  initEvent: ArvoEvent;
  /** The event that caused this execution, which the error answers. */
  event: ArvoEvent;
};
