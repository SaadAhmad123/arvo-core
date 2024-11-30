import { z } from 'zod';
import ArvoContract from './ArvoContract';
import ArvoEvent from './ArvoEvent';
import { ArvoExtension, OpenTelemetryExtension } from './ArvoEvent/types';
import { ArvoErrorSchema } from './schema';
import { VersionedArvoContract } from './ArvoContract/VersionedArvoContract';

/**
 * Represents the version of Arvo components following Semantic Versioning (SemVer).
 *
 * Format:
 * MAJOR.MINOR.PATCH where each component is a non-negative integer
 *
 * Restrictions:
 * Must not contain semicolons (;)
 *
 * @example
 * ```typescript
 * const version: ArvoSemanticVersion = "1.0.0";
 * const preRelease: ArvoSemanticVersion = "0.5.2";
 * const major: ArvoSemanticVersion = "2.0.0";
 * ```
 */
export type ArvoSemanticVersion = `${number}.${number}.${number}`;

/**
 * A type utility that infers the structure of an ArvoEvent.
 *
 * @template TData - The type of the event payload
 * @template TExtension - Additional extension properties for the event
 * @template TType - The literal type string identifying the event
 *
 * @property id - Unique identifier for the event (UUID v4 recommended)
 * @property source - Identifier for the context where the event occurred
 * @property specversion - CloudEvents specification version
 * @property type - Event type identifier
 * @property subject - Event subject in the producer's context
 * @property datacontenttype - MIME type of the event payload
 * @property dataschema - URI reference to the event's JSON schema
 * @property data - The actual event payload
 * @property time - ISO 8601 timestamp of event occurrence
 *
 * @example
 * ```typescript
 * type UserCreatedEvent = InferArvoEvent<ArvoEvent<
 *   { userId: string; email: string },
 *   { region: string },
 *   'user.created'
 * >>;
 *
 * // Results in:
 * // {
 * //   id: string;
 * //   source: string;
 * //   specversion: string;
 * //   type: 'user.created';
 * //   subject: string;
 * //   datacontenttype: string;
 * //   dataschema: string | null;
 * //   data: { userId: string; email: string };
 * //   time: string;
 * //   region: string;
 * //   // ... plus ArvoExtension & OpenTelemetryExtension properties
 * // }
 * ```
 */
export type InferArvoEvent<T> =
  T extends ArvoEvent<infer TData, infer TExtension, infer TType>
    ? {
        /** Unique identifier of the event */
        id: string;
        /** Identifies the context in which an event happened */
        source: string;
        /** The version of the CloudEvents specification */
        specversion: string;
        /** Describes the type of event related to the originating occurrence */
        type: TType;
        /** Describes the subject of the event in the context of the event producer */
        subject: string;
        /** Content type of the data value */
        datacontenttype: string;
        /** A link to the schema that the data adheres to */
        dataschema: string | null;
        /** Event payload */
        data: TData;
        /** Timestamp of when the occurrence happened */
        time: string;
      } & ArvoExtension &
        OpenTelemetryExtension &
        TExtension
    : never;

type InferZodSchema<T> = T extends z.ZodTypeAny ? z.infer<T> : never;

/**
 * Represents the structure of an Arvo system error.
 * This type is inferred from the ArvoErrorSchema and provides
 * the standard error format used across all Arvo contracts.
 *
 * @property errorName - The classification or type of the error
 * @property errorMessage - A human-readable description of what went wrong
 * @property errorStack - Optional stack trace for debugging (null if not available)
 *
 * @example
 * ```typescript
 * const error: ArvoErrorType = {
 *   errorName: 'ValidationError',
 *   errorMessage: 'Invalid input format',
 *   errorStack: 'Error: Invalid input format\n    at validate (/app.js:10)'
 * };
 * ```
 *
 * @see {@link ArvoErrorSchema} for the underlying Zod schema definition
 */
export type ArvoErrorType = z.infer<typeof ArvoErrorSchema>;

/**
 * A type utility that infers the complete event structure from a versioned Arvo contract.
 * This type extracts and transforms all event types, schemas, and error definitions
 * from a specific version of a contract into their fully resolved event forms.
 *
 * @template TVersion - The versioned contract to infer from, must extend VersionedArvoContract
 *
 * @property accepts - The fully resolved accept event type for this version
 * @property systemError - The fully resolved system error event type
 * @property emits - Record of all fully resolved emit event types
 *
 * @see {@link VersionedArvoContract} for the input contract structure
 * @see {@link InferArvoEvent} for the event inference utility
 * @see {@link ArvoEvent} for the base event structure
 */
export type InferVersionedArvoContract<
  TVersion extends VersionedArvoContract<any, any, any>,
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
    [K in string & keyof TVersion['emitMap']]: InferArvoEvent<
      ArvoEvent<InferZodSchema<TVersion['emitMap'][K]>, {}, K>
    >;
  };
  emits: Array<
    {
      [K in string & keyof TVersion['emitMap']]: InferArvoEvent<
        ArvoEvent<InferZodSchema<TVersion['emitMap'][K]>, {}, K>
      >;
    }[string & keyof TVersion['emitMap']]
  >;
  metadata: TVersion['metadata'];
};
