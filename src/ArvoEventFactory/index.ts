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
import { ArvoSemanticVersion } from '../types';
import ArvoOrchestrationSubject from '../ArvoOrchestrationSubject';

/**
 * Factory class for creating contractual ArvoEvents based on a given ArvoContract.
 * This class handles the creation and validation of events according to contract specifications.
 *
 * @template TContract - The type of ArvoContract this factory is bound to
 */
export default class ArvoEventFactory<TContract extends ArvoContract> {
  private readonly contract: TContract;

  /**
   * Creates an instance of ArvoEventFactory.
   *
   * @param contract - The ArvoContract to base the events on.
   */
  constructor(contract: TContract) {
    this.contract = contract;
  }

  /**
   * Creates a validated ArvoEvent that matches the contract's accept specifications.
   * This method ensures the created event conforms to the contract's input schema.
   *
   * @template V - The semantic version of the contract to use
   * @template TExtension - Additional custom properties to include in the event
   *
   * @param event - The event configuration object
   * @param event.version - The semantic version of the contract to use
   * @param event.data - The event payload that must conform to the contract's accept schema
   * @param [extensions] - Optional additional properties to include in the event
   * @param [opentelemetry] - Optional OpenTelemetry configuration for tracing
   *
   * @returns A validated ArvoEvent instance conforming to the contract's accept specifications
   *
   * @throws {Error} If event data validation fails against the contract schema
   * @throws {Error} If OpenTelemetry operations fail
   */
  accepts<
    V extends ArvoSemanticVersion & keyof TContract['versions'],
    TExtension extends Record<string, any>,
  >(
    event: {
      version: V;
    } & Omit<
      CreateArvoEvent<
        z.input<TContract['versions'][V]['accepts']>,
        TContract['type']
      >,
      'type' | 'datacontenttype' | 'dataschema'
    >,
    extensions?: TExtension,
    opentelemetry?: ExecutionOpenTelemetryConfiguration,
  ) {
    opentelemetry = opentelemetry ?? {
      tracer: fetchOpenTelemetryTracer(),
    };
    const span = opentelemetry.tracer.startSpan(
      `ArvoEventFactory<${this.contract.uri}/${event.version}>.accepts`,
    );
    return context.with(trace.setSpan(context.active(), span), () => {
      span.setStatus({ code: SpanStatusCode.OK });
      const otelHeaders = currentOpenTelemetryHeaders();
      try {
        const validationResult = this.contract.validateAccepts(
          event.version,
          this.contract.type,
          event.data,
        );
        if (!validationResult.success) {
          throw new Error(
            `Accept Event data validation failed: ${validationResult.error.message}`,
          );
        }
        return createArvoEvent<
          z.infer<TContract['versions'][V]['accepts']>,
          TExtension,
          TContract['type']
        >(
          {
            ...event,
            traceparent:
              event.traceparent ?? otelHeaders.traceparent ?? undefined,
            tracestate: event.tracestate ?? otelHeaders.tracestate ?? undefined,
            type: this.contract.type,
            datacontenttype: ArvoDataContentType,
            dataschema: `${this.contract.uri}/${event.version}`,
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
   * Creates a validated ArvoEvent that matches one of the contract's emit specifications.
   * This method ensures the created event conforms to the contract's output schema.
   *
   * @template V - The semantic version of the contract to use
   * @template U - The specific emit event type from the contract
   * @template TExtension - Additional custom properties to include in the event
   *
   * @param event - The event configuration object
   * @param event.version - The semantic version of the contract to use
   * @param event.type - The type of emit event to create
   * @param event.data - The event payload that must conform to the contract's emit schema
   * @param [extensions] - Optional additional properties to include in the event
   * @param [opentelemetry] - Optional OpenTelemetry configuration for tracing
   *
   * @returns A validated ArvoEvent instance conforming to the contract's emit specifications
   *
   * @throws {Error} If event data validation fails against the contract schema
   * @throws {Error} If the specified emit type doesn't exist in the contract
   * @throws {Error} If OpenTelemetry operations fail
   */
  emits<
    V extends ArvoSemanticVersion & keyof TContract['versions'],
    U extends string & keyof TContract['versions'][V]['emits'],
    TExtension extends Record<string, any>,
  >(
    event: {
      version: V;
    } & Omit<
      CreateArvoEvent<z.input<TContract['versions'][V]['emits'][U]>, U>,
      'datacontenttype' | 'dataschema'
    >,
    extensions?: TExtension,
    opentelemetry?: ExecutionOpenTelemetryConfiguration,
  ) {
    opentelemetry = opentelemetry ?? {
      tracer: fetchOpenTelemetryTracer(),
    };
    const span = opentelemetry.tracer.startSpan(
      `ArvoEventFactory<${this.contract.uri}/${event.version}>.emits<${event.type}>`,
    );
    return context.with(trace.setSpan(context.active(), span), () => {
      span.setStatus({ code: SpanStatusCode.OK });
      const otelHeaders = currentOpenTelemetryHeaders();
      try {
        const validationResult = this.contract.validateEmits(
          event.version,
          event.type,
          event.data,
        );
        if (!validationResult.success) {
          throw new Error(
            `Emit Event data validation failed: ${validationResult.error.message}`,
          );
        }
        return createArvoEvent<
          z.infer<TContract['versions'][V]['emits'][U]>,
          TExtension,
          U
        >(
          {
            ...event,
            traceparent:
              event.traceparent ?? otelHeaders.traceparent ?? undefined,
            tracestate: event.tracestate ?? otelHeaders.tracestate ?? undefined,
            datacontenttype: ArvoDataContentType,
            dataschema: `${this.contract.uri}/${event.version}`,
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
   * Creates a system error ArvoEvent for handling and reporting errors within the system.
   *
   * @template TExtension - Additional custom properties to include in the error event
   *
   * @param event - The error event configuration object
   * @param event.error - The Error instance to be converted into an event
   * @param [extensions] - Optional additional properties to include in the event
   * @param [opentelemetry] - Optional OpenTelemetry configuration for tracing
   *
   * @returns A system error ArvoEvent containing the error details
   *
   * @throws {Error} If event creation fails
   * @throws {Error} If OpenTelemetry operations fail
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
    };
    const span = opentelemetry.tracer.startSpan(
      `ArvoEventFactory<${this.contract.uri}>.systemError`,
    );
    return context.with(trace.setSpan(context.active(), span), () => {
      span.setStatus({ code: SpanStatusCode.OK });
      const otelHeaders = currentOpenTelemetryHeaders();
      try {
        const { error, ..._event } = event;
        return createArvoEvent<
          z.infer<typeof ArvoErrorSchema>,
          TExtension,
          `sys.${TContract['type']}.error`
        >(
          {
            ..._event,
            traceparent:
              event.traceparent ?? otelHeaders.traceparent ?? undefined,
            tracestate: event.tracestate ?? otelHeaders.tracestate ?? undefined,
            type: `sys.${this.contract.type}.error`,
            data: {
              errorName: error.name,
              errorMessage: error.message,
              errorStack: error.stack ?? null,
            },
            datacontenttype: ArvoDataContentType,
            dataschema: `${this.contract.uri}/${ArvoOrchestrationSubject.WildCardMachineVersion}`,
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
