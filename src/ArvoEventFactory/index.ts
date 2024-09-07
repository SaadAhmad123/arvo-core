import ArvoContract from "../ArvoContract";
import { z } from 'zod'
import { createArvoEvent } from "../ArvoEvent/helpers";
import { CreateArvoEvent } from "../ArvoEvent/types";
import { ArvoDataContentType } from "../ArvoEvent/schema";
import { createOtelSpan } from "../OpenTelemetry";
import { TelemetryContext } from "../OpenTelemetry/types";
import { ArvoErrorSchema } from "../schema";

/**
 * A factory class for creating contractual ArvoEvents based on a given ArvoContract.
 * 
 * @template TUri - The URI of the contract
 * @template TType - The accept type, defaults to string.
 * @template TAcceptSchema - The type of the data which the contract bound can accept
 * @template TEmits - The type of records the contract bound handler emits.
 */
export default class ArvoEventFactory<
  TUri extends string = string,
  TType extends string = string,
  TAcceptSchema extends z.ZodTypeAny = z.ZodTypeAny,
  TEmits extends Record<string, z.ZodTypeAny> = Record<string, z.ZodTypeAny>
> {
  private contract: ArvoContract<TUri, TType, TAcceptSchema, TEmits>;

  /**
   * Creates an instance of ContractualArvoEventFactory.
   * 
   * @param contract - The ArvoContract to base the events on.
   */
  constructor(contract: ArvoContract<TUri, TType, TAcceptSchema, TEmits>) {
    this.contract = contract;
  }

  /**
   * Creates an ArvoEvent as per the accept record of the contract.
   *
   * @template TExtension - The type of extensions to add to the event.
   * @param event - The event to create. The field 'type' is automatically infered
   * @param [extensions] - Optional extensions to add to the event.
   * @param [telemetry] - Optional telemetry context for tracing.
   * @returns The created ArvoEvent as per the accept record of the contract.
   * @throws If the event data fails validation against the contract.
   */
  accepts<TExtension extends Record<string, any>>(
    event: Omit<CreateArvoEvent<z.infer<TAcceptSchema>, TType>, 'type'> & {to: string},
    extensions?: TExtension,
    telemetry?: TelemetryContext,
  ) {
    return createOtelSpan(
      telemetry || 'ArvoEvent Creation Tracer',
      'ContractualArvoEventFactory.accepts',
      {},
      (telemetryContext) => {
        const validationResult = this.contract.validateInput(this.contract.accepts.type, event.data);
        if (!validationResult.success) {
          throw new Error(
            `Accept Event data validation failed: ${validationResult.error.message}`,
          );
        }
        return createArvoEvent<z.infer<TAcceptSchema>, TExtension, TType>(
          {
            ...event,
            type: this.contract.accepts.type,
            datacontenttype: ArvoDataContentType,
            dataschema: this.contract.uri,
            data: validationResult.data,
          },
          extensions,
          telemetryContext,
        );
      },
    );
  }

  /**
   * Creates an ArvoEvent as per one of the emits record in the contract.
   *
   * @template U - The specific event type from TEmits.
   * @template TExtension - The type of extensions to add to the event.
   * @param event - The event to create.
   * @param [extensions] - Optional extensions to add to the event.
   * @param [telemetry] - Optional telemetry context for tracing.
   * @returns The created ArvoEvent as per one of the emits records of the contract.
   * @throws If the event data fails validation against the contract.
   */
  emits<
    U extends keyof TEmits & string,
    TExtension extends Record<string, any>,
  >(
    event: CreateArvoEvent<z.infer<TEmits[U]>, U> & {to: string},
    extensions?: TExtension,
    telemetry?: TelemetryContext,
  ) {
    return createOtelSpan(
      telemetry || 'ArvoEvent Creation Tracer',
      'ContractualArvoEventFactory.emits',
      {},
      (telemetryContext) => {
        const validationResult = this.contract.validateOutput(
          event.type,
          event.data,
        );
        if (!validationResult.success) {
          throw new Error(
            `Emit Event data validation failed: ${validationResult.error.message}`,
          );
        }
        return createArvoEvent<
          z.infer<TEmits[U]>,
          TExtension,
          U
        >(
          {
            ...event,
            datacontenttype: ArvoDataContentType,
            dataschema: this.contract.uri,
            data: validationResult.data,
          },
          extensions,
          telemetryContext,
        );
      },
    );
  }

  /**
   * Creates a system error ArvoEvent.
   *
   * @template TExtension - The type of extensions to add to the event.
   * @param event - The event to create, including the error.
   * @param [extensions] - Optional extensions to add to the event.
   * @param [telemetry] - Optional telemetry context for tracing.
   * @returns The created system error ArvoEvent.
   */
  systemError<TExtension extends Record<string, any>>(
    event: Omit<CreateArvoEvent<any, any>, 'data' | 'type'> & {
      error: Error;
      to: string;
    },
    extensions?: TExtension,
    telemetry?: TelemetryContext,
  ) {
    return createOtelSpan(
      telemetry || 'ArvoEvent Creation Tracer',
      'ContractualArvoEventFactory.systemError',
      {},
      (telemetryContext) => {
        const { error, ..._events } = event;
        return createArvoEvent<
          z.infer<typeof ArvoErrorSchema>,
          TExtension,
          `sys.${TType}.error`
        >(
          {
            ...event,
            type: `sys.${this.contract.accepts.type}.error`,
            data: {
              errorName: error.name,
              errorMessage: error.message,
              errorStack: error.stack || null,
            },
            datacontenttype: ArvoDataContentType,
            dataschema: this.contract.uri,
          },
          extensions,
          telemetryContext,
        );
      },
    );
  }
}