import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import type { ArvoEvent } from '../../ArvoEvent/index.js';
import type { PayloadOf } from './schema.js';

/**
 * The contracts a handler may send events to, under whatever local name you
 * give each. The name is yours alone: an emitted event's destination comes
 * from its type, and nothing reads the key.
 */
export type ArvoServiceMap = Record<string, VersionedArvoContract>;

/** The event one version takes in. */
export type ArvoInitEvent<TSelf extends VersionedArvoContract> = ArvoEvent<
  TSelf['type'],
  PayloadOf<TSelf['input']>
>;

/** Anything one service may answer with: one of its outputs, or its handler error. */
export type ArvoServiceResponse<TContract extends VersionedArvoContract> =
  | {
      [TType in keyof TContract['outputs'] & string]: ArvoEvent<
        TType,
        PayloadOf<TContract['outputs'][TType]>
      >;
    }[keyof TContract['outputs'] & string]
  | ArvoEvent<
      TContract['error']['type'],
      PayloadOf<TContract['error']['schema']>
    >;

/** Anything any declared service may answer with. */
export type ArvoAnyServiceResponse<TServices extends ArvoServiceMap> = {
  [TName in keyof TServices]: ArvoServiceResponse<TServices[TName]>;
}[keyof TServices];
