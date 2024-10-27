import { z } from 'zod';
import ArvoContract from './ArvoContract';
import ArvoEvent from './ArvoEvent';
import { ArvoExtension, OpenTelemetryExtension } from './ArvoEvent/types';
import ArvoOrchestratorContract from './ArvoOrchestratorContract';
import { Tracer } from '@opentelemetry/api';

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
        /** The URI of the contract */
        uri: TUri;
        /** The event type that this contract accepts */
        accepts: InferArvoEvent<
          ArvoEvent<InferZodSchema<TAcceptSchema>, {}, TType>
        >;
        /** The event types that this contract can emit */
        emits: {
          [K in keyof TEmits]: InferArvoEvent<
            ArvoEvent<InferZodSchema<TEmits[K]>, {}, K & string>
          >;
        };
        /** The system error event type for this contract */
        systemError: InferArvoEvent<
          ArvoEvent<
            InferZodSchema<T['systemError']['schema']>,
            {},
            T['systemError']['type']
          >
        >;
        /** Union type of all emittable events, including regular events and system error */
        emittableEvents: ({
          [K in keyof TEmits]: InferArvoEvent<
            ArvoEvent<InferZodSchema<TEmits[K]>, {}, K & string>
          >;
        } & {
          [K in `sys.${TType}.error`]: InferArvoEvent<
            ArvoEvent<
              InferZodSchema<T['systemError']['schema']>,
              {},
              T['systemError']['type']
            >
          >;
        })[keyof TEmits | `sys.${TType}.error`];
      }
    : never;

/**
 * A type utility that infers the structure of an ArvoOrchestratorContract.
 *
 * @template T - The type to infer from, expected to be an ArvoOrchestratorContract.
 *
 * @returns An object type that includes the URI, accepted event type (init),
 * emitted event type (complete), system error event type, and other properties
 * of the orchestrator contract.
 *
 * @example
 * const myOrchestratorContract = new ArvoOrchestratorContract({
 *   uri: 'my-orchestrator',
 *   init: { type: 'init', schema: z.object({ input: z.string() }) },
 *   complete: { type: 'complete', schema: z.object({ result: z.number() }) }
 * });
 * type MyOrchestratorContractType = InferArvoOrchestratorContract<typeof myOrchestratorContract>;
 * // MyOrchestratorContractType will have properties uri, accepts, emits, systemError, etc.
 */
export type InferArvoOrchestratorContract<
  T extends ArvoOrchestratorContract<
    string,
    string,
    z.ZodTypeAny,
    string,
    z.ZodTypeAny
  >,
> =
  T extends ArvoOrchestratorContract<
    infer TUri,
    infer TInitType,
    infer TInit,
    infer TCompleteType,
    infer TComplete
  >
    ? {
        /** The URI of the orchestrator contract */
        uri: TUri;

        /** The event type that this orchestrator contract accepts to initiate the process */
        accepts: InferArvoEvent<
          ArvoEvent<InferZodSchema<TInit>, {}, TInitType>
        >;

        /** The event type that this orchestrator contract emits upon completion */
        emits: {
          [K in TCompleteType]: InferArvoEvent<
            ArvoEvent<InferZodSchema<TComplete>, {}, K>
          >;
        };

        /** The system error event type for this orchestrator contract */
        systemError: InferArvoEvent<
          ArvoEvent<
            InferZodSchema<T['systemError']['schema']>,
            {},
            T['systemError']['type']
          >
        >;

        /**
         * Union type of all emittable events, including the completion event and system error.
         * This can be used to represent all possible outcomes of the orchestration process.
         */
        emittableEvents: ({
          [K in TCompleteType]: InferArvoEvent<
            ArvoEvent<InferZodSchema<TComplete>, {}, K>
          >;
        } & {
          [K in `sys.${TInitType}.error`]: InferArvoEvent<
            ArvoEvent<
              InferZodSchema<T['systemError']['schema']>,
              {},
              T['systemError']['type']
            >
          >;
        })[TCompleteType | `sys.${TInitType}.error`];

        /** The initial event type and schema that starts the orchestration process */
        init: InferArvoEvent<ArvoEvent<InferZodSchema<TInit>, {}, TInitType>>;

        /** The completion event type and schema that signifies the end of the orchestration process */
        complete: InferArvoEvent<
          ArvoEvent<InferZodSchema<TComplete>, {}, TCompleteType>
        >;
      }
    : never;
