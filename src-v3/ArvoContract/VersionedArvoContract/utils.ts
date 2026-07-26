import type ArvoContract from '..';
import type { ArvoSemanticVersion } from '../../types';
import type { ArvoContractRecord } from '../types';

export const transformEmitsToArray = <T extends ArvoContract, V extends ArvoSemanticVersion>(
  emitMap: T['versions'][V]['emits'],
) => {
  return Object.entries(emitMap).map(([type, schema]) => ({
    type,
    schema,
  })) as Array<
    {
      [K in keyof T['versions'][V]['emits'] & string]: ArvoContractRecord<K, T['versions'][V]['emits'][K]>;
    }[keyof T['versions'][V]['emits'] & string]
  >;
};
