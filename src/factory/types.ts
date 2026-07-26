import type { ArvoEvent } from '../ArvoEvent/index.js';
import type { ArvoEventParam } from '../ArvoEvent/types.js';
import type { JSONPrimitive, NoKnownKeys } from '../types.js';

export type CreateArvoEventParam<
  T extends string = string,
  D extends Record<string, any> = Record<string, any>,
> = {
  parent?: ArvoEvent;
  param: ArvoEventParam<T, D>;
  extensions?: NoKnownKeys<
    Record<string, JSONPrimitive>,
    keyof ArvoEventParam<string, any>
  >;
};
