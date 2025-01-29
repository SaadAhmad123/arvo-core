import type { z } from 'zod';
import ArvoEventFactory from '.';
import type { VersionedArvoContract } from '../ArvoContract/VersionedArvoContract';
import { createArvoEvent } from '../ArvoEvent/helpers';
import { ArvoDataContentType } from '../ArvoEvent/schema';
import type { CreateArvoEvent } from '../ArvoEvent/types';
import ArvoOrchestrationSubject from '../ArvoOrchestrationSubject';
import type { ArvoOrchestratorContract } from '../ArvoOrchestratorContract/types';
import { ArvoOpenTelemetry, currentOpenTelemetryHeaders } from '../OpenTelemetry';
import { EventDataschemaUtil } from '../utils';
import { createSpanOptions } from './utils';

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
    if ((contract.metadata as ArvoOrchestratorContract['metadata'])?.contractType !== 'ArvoOrchestratorContract') {
      throw new Error('This factory can only be used for ArvoOrchestratorContract');
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
   * @returns Validated orchestration event with proper subject hierarchy
   *
   * @throws Error if event validation fails
   */
  init<TExtension extends Record<string, any>>(
    event: Omit<
      CreateArvoEvent<z.input<TContract['accepts']['schema']>, TContract['accepts']['type']>,
      'type' | 'datacontenttype' | 'dataschema' | 'subject'
    > & { subject?: string },
    extensions?: TExtension,
  ) {
    return ArvoOpenTelemetry.getInstance().startActiveSpan({
      name: `${this._name}.init`,
      spanOptions: createSpanOptions(this.contract),
      fn: (span) => {
        const otelHeaders = currentOpenTelemetryHeaders();
        const validationResult = this.contract.accepts.schema.safeParse(event.data);
        if (!validationResult.success) {
          throw new Error(`Init Event data validation failed: ${validationResult.error.message}`);
        }
        const parentSubject: string | null = validationResult.data.parentSubject$$;
        const eventSubject: string =
          event.subject ??
          (parentSubject
            ? ArvoOrchestrationSubject.from({
                orchestator: this.contract.accepts.type,
                subject: parentSubject,
                version: this.contract.version,
                meta: Object.fromEntries(
                  Object.entries({
                    redirectto: event.redirectto ?? ArvoOrchestrationSubject.parse(parentSubject).execution.initiator,
                  }).filter((item) => Boolean(item[1])),
                ),
              })
            : ArvoOrchestrationSubject.new({
                orchestator: this.contract.accepts.type,
                initiator: event.source,
                version: this.contract.version,
                meta: event.redirectto
                  ? {
                      redirectto: event.redirectto,
                    }
                  : undefined,
              }));
        const generatedEvent = createArvoEvent<
          z.infer<TContract['accepts']['schema']>,
          TExtension,
          TContract['accepts']['type']
        >(
          {
            ...event,
            subject: eventSubject,
            traceparent: event.traceparent ?? otelHeaders.traceparent ?? undefined,
            tracestate: event.tracestate ?? otelHeaders.tracestate ?? undefined,
            type: this.contract.accepts.type,
            datacontenttype: ArvoDataContentType,
            dataschema: EventDataschemaUtil.create(this.contract),
            data: validationResult.data,
          },
          extensions,
          { disable: true },
        );
        span.setAttributes(generatedEvent.otelAttributes);
        return generatedEvent;
      },
    });
  }

  /**
   * Creates a completion event for the orchestration flow.
   * Uses the contract's configured complete event type from metadata.
   *
   * @param event - Completion event configuration
   * @param [extensions] - Optional additional properties
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
      'datacontenttype' | 'dataschema' | 'type' | 'subject'
    > & {
      subject?: string;
    },
    extensions?: TExtension,
  ) {
    return ArvoOpenTelemetry.getInstance().startActiveSpan({
      name: `${this._name}.complete`,
      spanOptions: createSpanOptions(this.contract),
      fn: (span) => {
        const otelHeaders = currentOpenTelemetryHeaders();
        const validationResult = this.contract.emits?.[this.contract.metadata.completeEventType]?.safeParse(event.data);
        if (!validationResult?.success) {
          const msg =
            validationResult?.error?.message ?? `No schema available for ${this.contract.metadata.completeEventType}`;
          throw new Error(`Emit Event data validation failed: ${msg}`);
        }

        const eventType = this.contract.metadata.completeEventType;
        const eventSubject =
          event.subject ??
          ArvoOrchestrationSubject.new({
            initiator: event.source,
            version: this.contract.version,
            orchestator: eventType,
            meta: event.redirectto
              ? {
                  redirectto: event.redirectto,
                }
              : undefined,
          });

        const generatedEvent = createArvoEvent<
          z.infer<TContract['emits'][TContract['metadata']['completeEventType']]>,
          TExtension,
          TContract['metadata']['completeEventType']
        >(
          {
            ...event,
            subject: eventSubject,
            type: eventType,
            traceparent: event.traceparent ?? otelHeaders.traceparent ?? undefined,
            tracestate: event.tracestate ?? otelHeaders.tracestate ?? undefined,
            datacontenttype: ArvoDataContentType,
            dataschema: EventDataschemaUtil.create(this.contract),
            data: validationResult.data,
          },
          extensions,
          { disable: true },
        );
        span.setAttributes(generatedEvent.otelAttributes);
        return generatedEvent;
      },
    });
  }
}
