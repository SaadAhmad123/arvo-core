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
 * Infers the complete contract structure from a versioned Arvo contract.
 * This provides type-safe access to all events, schemas, and metadata defined in a contract.
 *
 * @remarks
 * The inferred contract includes:
 * - `accepts`: Events the contract can receive
 * - `systemError`: Standard error events
 * - `emitMap`: Dictionary of all possible emit events
 * - `emits`: Array type containing all possible emit events
 * - `metadata`: Contract metadata
 *
 * @see {@link VersionedArvoContract} for the input contract structure
 * @see {@link InferArvoEvent} for the event inference utility
 * @see {@link ArvoEvent} for the base event structure
 */
export type InferVersionedArvoContract<
  TVersion extends VersionedArvoContract<any, any>,
> = {
  accepts: InferArvoEvent<
    ArvoEvent<
      InferZodSchema<TVersion['accepts']['schema']>,
      {},
      TVersion['accepts']['type']
    >
  >;
  systemError: InferArvoEvent<
    ArvoEvent<
      InferZodSchema<TVersion['systemError']['schema']>,
      {},
      TVersion['systemError']['type']
    >
  >;
  emitMap: {
    [K in string & keyof TVersion['emits']]: InferArvoEvent<
      ArvoEvent<InferZodSchema<TVersion['emits'][K]>, {}, K>
    >;
  };
  emits: Array<
    {
      [K in string & keyof TVersion['emits']]: InferArvoEvent<
        ArvoEvent<InferZodSchema<TVersion['emits'][K]>, {}, K>
      >;
    }[string & keyof TVersion['emits']]
  >;
  metadata: TVersion['metadata'];
};
