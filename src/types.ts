import { z } from 'zod';
import ArvoEvent from './ArvoEvent';
import { ArvoExtension, OpenTelemetryExtension } from './ArvoEvent/types';
import { ArvoErrorSchema } from './schema';
import { VersionedArvoContract } from './ArvoContract/VersionedArvoContract';
/**
 * Represents a semantic version string following the SemVer format (MAJOR.MINOR.PATCH).
 */
export type ArvoSemanticVersion = `${number}.${number}.${number}`;

/**
 * Infers the complete structure of an ArvoEvent by combining base CloudEvents fields,
 * Arvo-specific extensions, OpenTelemetry extensions, and custom extensions.
 *
 * @example
 * ```typescript
 * type UserCreatedEvent = InferArvoEvent<ArvoEvent
 *   { userId: string; email: string },
 *   { region: string },
 *   'user.created'
 * >>;
 * ```
 */
export type InferArvoEvent<TEvent extends ArvoEvent<any, any, any>> = {
  id: string;
  source: string;
  specversion: string;
  type: TEvent['type'];
  subject: string;
  datacontenttype: string;
  dataschema: string | null;
  data: TEvent['data'];
  time: string;
} & ArvoExtension &
  OpenTelemetryExtension &
  TEvent['extensions'];

/**
 * Utility type to infer the TypeScript type from a Zod schema.
 */
type InferZodSchema<T extends z.ZodTypeAny> = z.infer<T>;

/**
 * Represents the structure of an Arvo system error, inferred from the ArvoErrorSchema.
 * Provides the standard error format used across all Arvo contracts.
 *
 * @see {@link ArvoErrorSchema} for the underlying Zod schema definition
 */
export type ArvoErrorType = z.infer<typeof ArvoErrorSchema>;

/**
 * Infers that complete ArvoEvent structure for all the events
 * that can be accepted and emitted by the handler bound to the 
 * provided versioned ArvoContract.
 *
 * @see {@link VersionedArvoContract} for the input contract structure
 * @see {@link InferArvoEvent} for the event inference utility
 * @see {@link ArvoEvent} for the base event structure
 */
export type InferVersionedArvoContract<
  TVersion extends VersionedArvoContract<any, any>,
> = {
  uri: TVersion['uri'];
  version: TVersion['version'];
  description: TVersion['description'];
  metadata: TVersion['metadata'];
  systemError: InferArvoEvent<
    ArvoEvent<
      InferZodSchema<TVersion['systemError']['schema']>,
      {},
      TVersion['systemError']['type']
    >
  >;
  accepts: InferArvoEvent<
    ArvoEvent<
      InferZodSchema<TVersion['accepts']['schema']>,
      {},
      TVersion['accepts']['type']
    >
  >;
  emits: {
    [K in string & keyof TVersion['emits']]: InferArvoEvent<
      ArvoEvent<InferZodSchema<TVersion['emits'][K]>, Record<string, any>, K>
    >;
  };
  emitList: Array<
    {
      [K in string & keyof TVersion['emits']]: InferArvoEvent<
        ArvoEvent<InferZodSchema<TVersion['emits'][K]>, Record<string, any>, K>
      >;
    }[string & keyof TVersion['emits']]
  >;
  
};
