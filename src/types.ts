import { z } from 'zod';
import ArvoContract from './ArvoContract';
import ArvoEvent from './ArvoEvent';
import { ArvoExtension, OpenTelemetryExtension } from './ArvoEvent/types';
import { ArvoErrorSchema } from './schema';

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
 * A comprehensive type utility that infers the complete structure of an ArvoContract,
 * including versioned event types, accepted events, and emitted events.
 *
 * @template T - The ArvoContract type to infer from
 *
 * @property uri - Unique identifier for the contract
 * @property type - The event type this contract handles
 * @property versions - Version-specific contract definitions
 * @property versions[version].accepts - Events this contract version can handle
 * @property versions[version].emits - Events this contract version can produce
 * @property systemError - System error event definition for this contract
 *
 * @example
 * ```typescript
 * const userContract = new ArvoContract(
 *   'user-service',
 *   'user.operation',
 *   {
 *     '1.0.0': {
 *       accepts: z.object({ userId: z.string() }),
 *       emits: {
 *         'user.created': z.object({ userId: z.string(), timestamp: z.string() }),
 *         'user.failed': z.object({ error: z.string() })
 *       }
 *     }
 *   }
 * );
 *
 * type UserContractType = InferArvoContract<typeof userContract>;
 * // Results in:
 * // {
 * //   uri: 'user-service';
 * //   type: 'user.operation';
 * //   versions: {
 * //     '1.0.0': {
 * //       accepts: { ... inferred input event type ... };
 * //       emits: {
 * //         'user.created': { ... inferred output event type ... };
 * //         'user.failed': { ... inferred error event type ... };
 * //       }
 * //     }
 * //   };
 * //   systemError: { ... inferred system error event type ... };
 * // }
 * ```
 *
 * @remarks
 * - All version keys must be valid {@link ArvoSemanticVersion} strings
 * - The contract must define at least one version
 * - Each version must specify both accepted and emitted event schemas
 * - System error handling is automatically included for all contracts
 */
export type InferArvoContract<
  T extends ArvoContract<
    string,
    string,
    Record<
      ArvoSemanticVersion,
      {
        accepts: z.ZodTypeAny;
        emits: Record<string, z.ZodTypeAny>;
      }
    >
  >,
> =
  T extends ArvoContract<infer TUri, infer TType, infer TVersion>
    ? {
        uri: TUri;
        type: TType;
        versions: {
          [V in ArvoSemanticVersion & keyof TVersion]: {
            accepts: InferArvoEvent<
              ArvoEvent<InferZodSchema<TVersion[V]['accepts']>, {}, TType>
            >;
            emits: {
              [K in keyof TVersion[V]['emits']]: InferArvoEvent<
                ArvoEvent<
                  InferZodSchema<TVersion[V]['emits'][K]>,
                  {},
                  K & string
                >
              >;
            };
          };
        };
        systemError: InferArvoEvent<
          ArvoEvent<
            InferZodSchema<T['systemError']['schema']>,
            {},
            T['systemError']['type']
          >
        >;
      }
    : never;

export type ArvoErrorType = z.infer<typeof ArvoErrorSchema>;
