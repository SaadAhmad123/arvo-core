import { ArvoEvent } from '../ArvoEvent/index.js';
import type { CreateArvoEventParam } from './types.js';

export const createArvoEvent = <
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
