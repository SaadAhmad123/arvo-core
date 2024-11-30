import { z } from 'zod';
import ArvoContract from '..';
import { ArvoSemanticVersion } from '../../types';

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
        [K in `evt.${TType}.succes`]: TVersions[V]['emits'];
      };
    };
  },
  TMetaData & {
    contractType: 'SimpleArvoContract';
    rootType: TType;
  }
>;
