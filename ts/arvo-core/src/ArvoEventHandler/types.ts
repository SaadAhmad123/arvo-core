import type { Span } from '@opentelemetry/api';
import type * as z from 'zod/v4/core';
import type { ArvoContract } from '../ArvoContract/index.js';
import type { VersionedArvoContract } from '../ArvoContract/versioned/index.js';
import type { ArvoSemanticVersion } from '../semver/index.js';
import type { PromiseAble } from '../types.js';
import type { ArvoEventHandlerRuntimeContext } from './context.js';

export type ArvoEventHandlerContract = {
  self: ArvoContract;
  services: Record<string, VersionedArvoContract>;
};

export type VersionedArvoEventHandlerContract<
  C extends ArvoEventHandlerContract = ArvoEventHandlerContract,
  V extends keyof C['self']['versions'] = keyof C['self']['versions'],
> = {
  self: C['self']['versions'][V];
  services: C['services'];
};

export type VersionedArvoEventHandlerExecutorParam<
  D extends Record<string, any> = Record<string, any>,
  C extends
    VersionedArvoEventHandlerContract = VersionedArvoEventHandlerContract,
  S extends z.$ZodObject = z.$ZodObject,
> = {
  ctx: ArvoEventHandlerRuntimeContext<D, C, S>;
  span: Span;
};

export type VersionedArvoEventHandlerExecutorResponse<
  C extends
    VersionedArvoEventHandlerContract = VersionedArvoEventHandlerContract,
  S extends z.$ZodObject = z.$ZodObject,
> = {};

export type VersionedArvoEventHandlerFunctionWithState<
  D extends Record<string, any> = Record<string, any>,
  C extends
    VersionedArvoEventHandlerContract = VersionedArvoEventHandlerContract,
  S extends z.$ZodObject = z.$ZodObject,
> = {
  state: S;
  func: (
    param: VersionedArvoEventHandlerExecutorParam<D, C, S>,
  ) => PromiseAble<VersionedArvoEventHandlerExecutorResponse<C, S>>;
};

export type ArvoEventHandlerFunctionMap<
  D extends Record<string, any> = Record<string, any>,
  C extends ArvoEventHandlerContract = ArvoEventHandlerContract,
> = {
  [V in keyof C['self']['versions'] & ArvoSemanticVersion]:
    | VersionedArvoEventHandlerFunctionWithState<
        D,
        VersionedArvoEventHandlerContract<C, V>
      >
    | ((
        param: VersionedArvoEventHandlerExecutorParam<
          D,
          VersionedArvoEventHandlerContract<C, V>,
          never
        >,
      ) => PromiseAble<
        VersionedArvoEventHandlerExecutorResponse<
          VersionedArvoEventHandlerContract<C, V>,
          never
        >
      >);
};

export type ArvoEventHandlerParam<
  D extends Record<string, any> = Record<string, any>,
  C extends ArvoEventHandlerContract = ArvoEventHandlerContract,
  V extends ArvoEventHandlerFunctionMap<D, C> = ArvoEventHandlerFunctionMap<
    D,
    C
  >,
> = {
  types?: Partial<{
    dependencies: D;
  }>;
  contract: C;
  handlers: V;
};
