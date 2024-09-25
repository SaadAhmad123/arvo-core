import { z } from 'zod';
import ArvoContract from './ArvoContract';
import ArvoEvent from './ArvoEvent';
import { ArvoExtension, OpenTelemetryExtension } from './ArvoEvent/types';

/**
 * A type utility that infers the structure of an ArvoEvent.
 *
 * @template T - The type to infer from, expected to be an ArvoEvent.
 *
 * @returns An object type that includes all properties of an ArvoEvent,
 * including its data, extensions, and standard CloudEvents properties.
 *
 * @example
 * type MyEvent = InferArvoEvent<ArvoEvent<{ message: string }, { customField: number }, 'my.event.type'>>;
 * // MyEvent will have properties like id, source, data.message, customField, etc.
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

/**
 * Helper type to infer the TypeScript type from a Zod schema.
 *
 * @template T - The Zod schema type to infer from.
 *
 * @returns The TypeScript type that corresponds to the Zod schema.
 *
 * @example
 * const mySchema = z.object({ name: z.string(), age: z.number() });
 * type MyType = InferZodSchema<typeof mySchema>;
 * // MyType will be { name: string; age: number; }
 */
type InferZodSchema<T> = T extends z.ZodTypeAny ? z.infer<T> : never;

/**
 * A type utility that infers the structure of an ArvoContract.
 *
 * @template T - The type to infer from, expected to be an ArvoContract.
 *
 * @returns An object type that includes the URI, accepted event type, and emitted event types of the contract.
 *
 * @example
 * const myContract = new ArvoContract('my-uri', 'my-type', z.object({ input: z.string() }), {
 *   'output.event': z.object({ result: z.number() })
 * });
 * type MyContractType = InferArvoContract<typeof myContract>;
 * // MyContractType will have properties uri, accepts, and emits
 */
export type InferArvoContract<
  T extends ArvoContract<
    string,
    string,
    z.ZodTypeAny,
    Record<string, z.ZodTypeAny>
  >,
> =
  T extends ArvoContract<
    infer TUri,
    infer TType,
    infer TAcceptSchema,
    infer TEmits
  >
    ? {
        uri: TUri;
        accepts: InferArvoEvent<
          ArvoEvent<InferZodSchema<TAcceptSchema>, {}, TType>
        >;
        emits: {
          [K in keyof TEmits]: InferArvoEvent<
            ArvoEvent<InferZodSchema<TEmits[K]>, {}, K & string>
          >;
        };
      }
    : never;
