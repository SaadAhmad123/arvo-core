import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import type { ArvoEvent } from '../../ArvoEvent/index.js';
import type { PayloadOf } from './schema.js';

/**
 * The contracts a handler may send events to, under whatever local name you
 * give each. The name is yours alone: an emitted event's destination comes
 * from its type, and nothing reads the key.
 */
export type ArvoServiceMap = Record<string, VersionedArvoContract>;

/** Anything one service may answer with: one of its outputs, or its handler error. */
export type ArvoServiceResponse<C extends VersionedArvoContract> =
  | {
      [K in keyof C['outputs'] & string]: ArvoEvent<
        K,
        PayloadOf<C['outputs'][K]>
      >;
    }[keyof C['outputs'] & string]
  | ArvoEvent<C['error']['type'], PayloadOf<C['error']['schema']>>;

/** Anything any declared service may answer with. */
export type ArvoAnyServiceResponse<X extends ArvoServiceMap> = {
  [N in keyof X]: ArvoServiceResponse<X[N]>;
}[keyof X];
