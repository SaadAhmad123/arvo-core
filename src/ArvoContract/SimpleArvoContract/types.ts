import type { z } from 'zod';
import type ArvoContract from '..';
import type { ArvoSemanticVersion } from '../../types';

export type SimpleArvoContractEmitType<T extends string> = `evt.${T}.success`;

export type SimpleArvoContract<
  TUri extends string = string,
  TType extends string = string,
  TVersions extends Record<
    ArvoSemanticVersion,
    {
      accepts: z.ZodTypeAny;
      emits: z.ZodTypeAny;
    }
  > = Record<
    ArvoSemanticVersion,
    {
      accepts: z.ZodTypeAny;
      emits: z.ZodTypeAny;
    }
  >,
  TMetaData extends Record<string, any> = Record<string, any>,
> = ArvoContract<
  TUri,
  `com.${TType}`,
  {
    [V in ArvoSemanticVersion & keyof TVersions]: {
      accepts: TVersions[V]['accepts'];
      emits: {
        [K in SimpleArvoContractEmitType<TType>]: TVersions[V]['emits'];
      };
    };
  },
  TMetaData & {
    contractType: 'SimpleArvoContract';
    rootType: TType;
  }
>;
