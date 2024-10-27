import ArvoContract from '../ArvoContract';
import { z } from 'zod';
import { createArvoEvent } from '../ArvoEvent/helpers';
import { CreateArvoEvent } from '../ArvoEvent/types';
import { ArvoDataContentType } from '../ArvoEvent/schema';
import { ArvoErrorSchema } from '../schema';
import {
  fetchOpenTelemetryTracer,
  currentOpenTelemetryHeaders,
  exceptionToSpan,
} from '../OpenTelemetry';
import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import { ExecutionOpenTelemetryConfiguration } from '../OpenTelemetry/types';

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
  TEmits extends Record<string, z.ZodTypeAny> = Record<string, z.ZodTypeAny>,
> {
  private readonly contract: ArvoContract<TUri, TType, TAcceptSchema, TEmits>;

  /**
   * Creates an instance of ArvoEventFactory.
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
   * @param [opentelemetry] - Optional opentelemetry configuration object
   * @returns The created ArvoEvent as per the accept record of the contract.
   * @throws If the event data fails validation against the contract.
   */
  accepts<TExtension extends Record<string, any>>(
    event: Omit<
      CreateArvoEvent<z.input<TAcceptSchema>, TType>,
      'type' | 'datacontenttype' | 'dataschema'
    >,
    extensions?: TExtension,
    opentelemetry?: ExecutionOpenTelemetryConfiguration,
  ) {
    opentelemetry = opentelemetry ?? {
      tracer: fetchOpenTelemetryTracer(),
    }
    const span = opentelemetry.tracer.startSpan(
      `ArvoEventFactory<${this.contract.uri}>.accepts<${this.contract.accepts.type}>.create`,
    );
    return context.with(trace.setSpan(context.active(), span), () => {
      span.setStatus({ code: SpanStatusCode.OK });
      const otelHeaders = currentOpenTelemetryHeaders();
      try {
        const validationResult = this.contract.validateAccepts(
          this.contract.accepts.type,
          event.data,
        );
        if (!validationResult.success) {
          throw new Error(
            `Accept Event data validation failed: ${validationResult.error.message}`,
          );
        }
        return createArvoEvent<z.infer<TAcceptSchema>, TExtension, TType>(
          {
            ...event,
            traceparent:
              event.traceparent ?? otelHeaders.traceparent ?? undefined,
            tracestate: event.tracestate ?? otelHeaders.tracestate ?? undefined,
            type: this.contract.accepts.type,
            datacontenttype: ArvoDataContentType,
            dataschema: this.contract.uri,
            data: validationResult.data,
          },
          extensions,
          opentelemetry,
        );
      } catch (error) {
        exceptionToSpan(error as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (error as Error).message,
        });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Creates an ArvoEvent as per one of the emits record in the contract.
   *
   * @template U - The specific event type from TEmits.
   * @template TExtension - The type of extensions to add to the event.
   * @param event - The event to create.
   * @param [extensions] - Optional extensions to add to the event.
   * @param [opentelemetry] - Optional opentelemetry configuration object
   * @returns The created ArvoEvent as per one of the emits records of the contract.
   * @throws If the event data fails validation against the contract.
   */
  emits<
    U extends keyof TEmits & string,
    TExtension extends Record<string, any>,
  >(
    event: Omit<
      CreateArvoEvent<z.input<TEmits[U]>, U>,
      'datacontenttype' | 'dataschema'
    >,
    extensions?: TExtension,
    opentelemetry?: ExecutionOpenTelemetryConfiguration,
  ) {
    opentelemetry = opentelemetry ?? {
      tracer: fetchOpenTelemetryTracer()
    }
    const span = opentelemetry.tracer.startSpan(
      `ArvoEventFactory<${this.contract.uri}>.emits<${event.type}>.create`,
    );
    return context.with(trace.setSpan(context.active(), span), () => {
      span.setStatus({ code: SpanStatusCode.OK });
      const otelHeaders = currentOpenTelemetryHeaders();
      try {
        const validationResult = this.contract.validateEmits(
          event.type,
          event.data,
        );
        if (!validationResult.success) {
          throw new Error(
            `Emit Event data validation failed: ${validationResult.error.message}`,
          );
        }
        return createArvoEvent<z.infer<TEmits[U]>, TExtension, U>(
          {
            ...event,
            traceparent:
              event.traceparent ?? otelHeaders.traceparent ?? undefined,
            tracestate: event.tracestate ?? otelHeaders.tracestate ?? undefined,
            datacontenttype: ArvoDataContentType,
            dataschema: this.contract.uri,
            data: validationResult.data,
          },
          extensions,
          opentelemetry,
        );
      } catch (error) {
        exceptionToSpan(error as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (error as Error).message,
        });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Creates a system error ArvoEvent.
   *
   * @template TExtension - The type of extensions to add to the event.
   * @param event - The event to create, including the error.
   * @param [extensions] - Optional extensions to add to the event.
   * @param [opentelemetry] - Optional opentelemtry configuration object
   * @returns The created system error ArvoEvent.
   */
  systemError<TExtension extends Record<string, any>>(
    event: Omit<
      CreateArvoEvent<any, any>,
      'data' | 'type' | 'datacontenttype' | 'dataschema'
    > & {
      error: Error;
    },
    extensions?: TExtension,
    opentelemetry?: ExecutionOpenTelemetryConfiguration,
  ) {
    opentelemetry = opentelemetry ?? {
      tracer: fetchOpenTelemetryTracer(),
    }
    const span = opentelemetry.tracer.startSpan(
      `ArvoEventFactory<${this.contract.uri}>.systemError<sys.${this.contract.accepts.type}.error>.create`,
    );
    return context.with(trace.setSpan(context.active(), span), () => {
      span.setStatus({ code: SpanStatusCode.OK });
      const otelHeaders = currentOpenTelemetryHeaders();
      try {
        const { error, ..._event } = event;
        return createArvoEvent<
          z.infer<typeof ArvoErrorSchema>,
          TExtension,
          `sys.${TType}.error`
        >(
          {
            ..._event,
            traceparent:
              event.traceparent ?? otelHeaders.traceparent ?? undefined,
            tracestate: event.tracestate ?? otelHeaders.tracestate ?? undefined,
            type: `sys.${this.contract.accepts.type}.error`,
            data: {
              errorName: error.name,
              errorMessage: error.message,
              errorStack: error.stack ?? null,
            },
            datacontenttype: ArvoDataContentType,
            dataschema: this.contract.uri,
          },
          extensions,
          opentelemetry,
        );
      } catch (error) {
        exceptionToSpan(error as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (error as Error).message,
        });
        throw error;
      } finally {
        span.end();
      }
    });
  }
}
