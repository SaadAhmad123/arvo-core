import ArvoEventFactory from '.';
import { ArvoOrchestratorContract } from '../ArvoOrchestratorContract/types';
import { z } from 'zod';
import { createArvoEvent } from '../ArvoEvent/helpers';
import { CreateArvoEvent } from '../ArvoEvent/types';
import { ArvoDataContentType } from '../ArvoEvent/schema';
import {
  fetchOpenTelemetryTracer,
  currentOpenTelemetryHeaders,
  exceptionToSpan,
} from '../OpenTelemetry';
import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import { ExecutionOpenTelemetryConfiguration } from '../OpenTelemetry/types';
import { VersionedArvoContract } from '../ArvoContract/VersionedArvoContract';
import { EventDataschemaUtil } from '../utils';
import ArvoOrchestrationSubject from '../ArvoOrchestrationSubject';

/**
 * Factory class for creating and validating orchestrator-specific events with managed subject hierarchies.
 * Extends ArvoEventFactory with parent-child subject relationship handling and orchestration flows.
 *
 * @example
 * ```typescript
 * const contract = createArvoOrchestratorContract({ ... });
 *
 * const factory = createArvoOrchestratorEventFactory(contract.version('1.0.0'));
 * ```
 */
export class ArvoOrchestratorEventFactory<
  TContract extends VersionedArvoContract<any, any>,
> extends ArvoEventFactory<TContract> {
  protected readonly _name: string = 'ArvoOrchestratorEventFactory';

  constructor(contract: TContract) {
    if (
      (contract.metadata as ArvoOrchestratorContract['metadata'])
        ?.contractType !== 'ArvoOrchestratorContract'
    ) {
      throw new Error(
        `This factory can only be used for ArvoOrchestratorContract`,
      );
    }
    super(contract);
  }

  /**
   * Initializes a new orchestration event, handling parent-child subject relationships.
   * - If parentSubject$$ is provided, creates a child subject
   * - If no parent, creates a new root orchestration subject
   *
   * @param event - Event configuration without type/schema/subject
   * @param [extensions] - Optional additional properties
   * @param [opentelemetry] - Optional telemetry configuration
   * @returns Validated orchestration event with proper subject hierarchy
   *
   * @throws Error if event validation fails
   */
  init<TExtension extends Record<string, any>>(
    event: Omit<
      CreateArvoEvent<
        z.input<TContract['accepts']['schema']>,
        TContract['accepts']['type']
      >,
      'type' | 'datacontenttype' | 'dataschema' | 'subject'
    >,
    extensions?: TExtension,
    opentelemetry?: ExecutionOpenTelemetryConfiguration,
  ) {
    opentelemetry = opentelemetry ?? {
      tracer: fetchOpenTelemetryTracer(),
    };
    const span = opentelemetry.tracer.startSpan(
      `${this._name}<${this.contract.uri}/${this.contract.version}>.init`,
    );
    return context.with(trace.setSpan(context.active(), span), () => {
      span.setStatus({ code: SpanStatusCode.OK });
      const otelHeaders = currentOpenTelemetryHeaders();
      try {
        const validationResult = this.contract.accepts.schema.safeParse(
          event.data,
        );
        if (!validationResult.success) {
          throw new Error(
            `Accept Event data validation failed: ${validationResult.error.message}`,
          );
        }
        const parentSubject: string | null =
          validationResult.data.parentSubject$$;
        let newSubject: string = parentSubject
          ? ArvoOrchestrationSubject.from({
              orchestator: this.contract.accepts.type,
              subject: parentSubject,
              version: this.contract.version,
            })
          : ArvoOrchestrationSubject.new({
              orchestator: this.contract.accepts.type,
              initiator: event.source,
              version: this.contract.version,
            });

        return createArvoEvent<
          z.infer<TContract['accepts']['schema']>,
          TExtension,
          TContract['accepts']['type']
        >(
          {
            ...event,
            subject: newSubject,
            traceparent:
              event.traceparent ?? otelHeaders.traceparent ?? undefined,
            tracestate: event.tracestate ?? otelHeaders.tracestate ?? undefined,
            type: this.contract.accepts.type,
            datacontenttype: ArvoDataContentType,
            dataschema: EventDataschemaUtil.create(this.contract),
            data: validationResult.data,
          },
          extensions,
          { disable: true },
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
   * Creates a completion event for the orchestration flow.
   * Uses the contract's configured complete event type from metadata.
   *
   * @param event - Completion event configuration
   * @param [extensions] - Optional additional properties
   * @param [opentelemetry] - Optional telemetry configuration
   * @returns Validated completion event
   *
   * @throws Error if event validation fails or complete event type not configured
   */
  complete<TExtension extends Record<string, any>>(
    event: Omit<
      CreateArvoEvent<
        z.input<TContract['emits'][TContract['metadata']['completeEventType']]>,
        TContract['metadata']['completeEventType']
      >,
      'datacontenttype' | 'dataschema' | 'type'
    >,
    extensions?: TExtension,
    opentelemetry?: ExecutionOpenTelemetryConfiguration,
  ) {
    opentelemetry = opentelemetry ?? {
      tracer: fetchOpenTelemetryTracer(),
    };
    const span = opentelemetry.tracer.startSpan(
      `${this._name}<${this.contract.uri}/${this.contract.version}>.complete`,
    );
    return context.with(trace.setSpan(context.active(), span), () => {
      span.setStatus({ code: SpanStatusCode.OK });
      const otelHeaders = currentOpenTelemetryHeaders();
      try {
        const validationResult = this.contract.emits?.[
          this.contract.metadata.completeEventType
        ]?.safeParse(event.data);
        if (!validationResult?.success) {
          const msg =
            validationResult?.error?.message ??
            `No contract available for ${this.contract.metadata.completeEventType}`;
          throw new Error(`Emit Event data validation failed: ${msg}`);
        }
        return createArvoEvent<
          z.infer<
            TContract['emits'][TContract['metadata']['completeEventType']]
          >,
          TExtension,
          TContract['metadata']['completeEventType']
        >(
          {
            ...event,
            type: this.contract.metadata.completeEventType,
            traceparent:
              event.traceparent ?? otelHeaders.traceparent ?? undefined,
            tracestate: event.tracestate ?? otelHeaders.tracestate ?? undefined,
            datacontenttype: ArvoDataContentType,
            dataschema: EventDataschemaUtil.create(this.contract),
            data: validationResult.data,
          },
          extensions,
          { disable: true },
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