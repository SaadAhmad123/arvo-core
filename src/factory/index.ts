import { ArvoEvent } from '../ArvoEvent/index.js';
import type { CreateArvoEventParam } from './types.js';

const buildArvoEvent = <
  T extends string = string,
  D extends Record<string, any> = Record<string, any>,
>({
  parent,
  param,
  extensions,
}: CreateArvoEventParam<T, D>): ArvoEvent<T, D> => {
  if (parent) {
    return new ArvoEvent<T, D>(
      {
        ...param,
        depth: parent.depth + 1,
        rootsubject: parent.rootsubject,
        baggage: {
          ...(param.baggage ?? {}),
          ...parent.baggage, // Child baggage cannot override parent baggage
        },
        parentid: parent.id,
      },
      extensions,
    );
  }

  return new ArvoEvent<T, D>(
    {
      ...param,
    },
    extensions,
  );
};

type CreateArvoEvent = {
  <
    T extends string = string,
    D extends Record<string, any> = Record<string, any>,
  >(
    input: CreateArvoEventParam<T, D>,
  ): ArvoEvent<T, D>;
  /** Creates an event bound to a contract's `accepts` side. */
  for<
    C extends string,
    T extends string = string,
    D extends Record<string, any> = Record<string, any>,
  >(contract: C, input: CreateArvoEventParam<T, D>): ArvoEvent<T, D>;
  /** Creates an event bound to one of a contract's `emits` entries. */
  by<
    C extends string,
    T extends string = string,
    D extends Record<string, any> = Record<string, any>,
  >(contract: C, input: CreateArvoEventParam<T, D>): ArvoEvent<T, D>;
};

export const createArvoEvent: CreateArvoEvent = Object.assign(buildArvoEvent, {
  for: (_contract: string, input: CreateArvoEventParam<any, any>) =>
    buildArvoEvent(input),
  by: (_contract: string, input: CreateArvoEventParam<any, any>) =>
    buildArvoEvent(input),
}) as CreateArvoEvent;
