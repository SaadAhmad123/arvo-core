import * as z from 'zod/v4/core';
import type { VersionedArvoContract } from '../ArvoContract/versioned/index.js';
import type { ArvoEvent } from '../ArvoEvent/index.js';
import type { Result } from '../types.js';

export type ArvoEventHandlerLifecycle = 'init' | 'followup';

export type ArvoEventHandlerRuntimeContextParam<
  D extends Record<string, any> = Record<string, any>,
  S extends z.$ZodObject = z.$ZodObject,
  C extends {
    self: VersionedArvoContract;
    services: Record<string, VersionedArvoContract>;
  } = {
    self: VersionedArvoContract;
    services: Record<string, VersionedArvoContract>;
  },
> = {
  lifecycle: ArvoEventHandlerLifecycle;
  dependencies: D;
  state: S | null;
  contracts: C;
  initEvent: ArvoEvent<C['self']['type'], z.output<C['self']['input']>>;
  triggeringEvent: {
    [K in keyof C['services'] & string]:
      | ArvoEvent<
          C['services'][K]['error']['type'],
          z.output<C['services'][K]['error']['schema']>
        >
      | {
          [O in keyof C['services'][K]['outputs'] & string]: ArvoEvent<
            O,
            z.output<C['services'][K]['outputs'][O]>
          >;
        }[keyof C['services'][K]['outputs'] & string];
  }[keyof C['services'] & string];
};

export class ArvoEventHandlerRuntimeContext<
  D extends Record<string, any> = Record<string, any>,
  C extends {
    self: VersionedArvoContract;
    services: Record<string, VersionedArvoContract>;
  } = {
    self: VersionedArvoContract;
    services: Record<string, VersionedArvoContract>;
  },
  S extends z.$ZodObject = z.$ZodObject,
> {
  private _stateSchema: S;
  private _state: z.output<S> | null = null;

  readonly initEvent: ArvoEvent<
    C['self']['type'],
    z.output<C['self']['input']>
  >;
  readonly triggeringEvent: {
    [K in keyof C['services'] & string]:
      | ArvoEvent<
          C['services'][K]['error']['type'],
          z.output<C['services'][K]['error']['schema']>
        >
      | {
          [O in keyof C['services'][K]['outputs'] & string]: ArvoEvent<
            O,
            z.output<C['services'][K]['outputs'][O]>
          >;
        }[keyof C['services'][K]['outputs'] & string];
  }[keyof C['services'] & string];

  get state(): z.output<S> | null {
    return this.state;
  }

  // have the initState as well please
  tryInitState(state: (() => z.output<S>) | z.output<S>): Result<z.output<S>> {
    // do somethignl.iek the follwing sketch buit properly
    const data = typeof state === 'function' ? state() : state;
    this._state = z.safeParse(this._stateSchema, data);
    return this._state;
  }

  // have the setState as well please
  trySetState(
    state: (() => Partial<z.output<S>>) | Partial<z.output<S>>,
  ): Result<z.output<S>> {
    // do somethignl.iek the follwing sketch buit properly
    const data = typeof state === 'function' ? state() : state;
    this._state = z.parse(this._stateSchema, {
      ...(this._state ?? {}),
      ...data,
    });
    return this._state;
  }

  readonly lifecycle: ArvoEventHandlerLifecycle;
  readonly dependencies: D;
  readonly contracts: C;
}
