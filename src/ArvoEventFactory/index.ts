import type { z } from 'zod';
import type { VersionedArvoContract } from '../ArvoContract/VersionedArvoContract';
import { createArvoEvent } from '../ArvoEvent/helpers';
import { ArvoDataContentType } from '../ArvoEvent/schema';
import type { CreateArvoEvent } from '../ArvoEvent/types';
import ArvoOrchestrationSubject from '../ArvoOrchestrationSubject';
import { ArvoOpenTelemetry, currentOpenTelemetryHeaders } from '../OpenTelemetry';
import type { ArvoErrorSchema } from '../schema';
import { EventDataschemaUtil, createArvoError } from '../utils';
import { createSpanOptions } from './utils';

/**
 * Factory class for creating and validating events based on a versioned Arvo contract.
 * Handles event creation, validation, and OpenTelemetry integration for a specific
 * contract version.
 *
 * @example
 * ```typescript
 * const contract = createArvoContract({
 *   uri: 'example/api',
 *   type: 'user.create',
 *   versions: { '1.0.0': { ... } }
 * });
 *
 * const factory = createArvoEventFactory(contract.version('1.0.0'));
 * ```
 */
export default class ArvoEventFactory<TContract extends VersionedArvoContract<any, any>> {
  protected readonly _name: string = 'EventFactory';
  protected readonly contract: TContract;

  /**
   * Creates an ArvoEventFactory instance for a specific version of a contract.
   *
   * @param contract - The versioned contract to use for event creation and validation
   */
  constructor(contract: TContract) {
    this.contract = contract;
  }

  /**
   * Creates and validates an event matching the contract's accept specification.
   *
   * @param event - The event configuration object
   * @param [extensions] - Optional additional properties for the event
   *
   * @returns A validated ArvoEvent matching the contract's accept specification
   *
   * @throws {Error} If validation fails or OpenTelemetry operations fail
   *
   * @example
   * ```typescript
   * const event = factory.accepts({
   *   source: 'api/users',
   *   data: { name: 'John', email: 'john@example.com' }
   * });
   * ```
   */
  accepts<TExtension extends Record<string, any>>(
    event: Omit<
      CreateArvoEvent<z.input<TContract['accepts']['schema']>, TContract['accepts']['type']>,
      'type' | 'datacontenttype' | 'dataschema' | 'subject' | 'domain'
    > & { subject?: string; domain?: string | null },
    extensions?: TExtension,
  ) {
    return ArvoOpenTelemetry.getInstance().startActiveSpan({
      name: `${this._name}.accepts<${this.contract.accepts.type}>`,
      spanOptions: createSpanOptions(this.contract),
      fn: (span) => {
        const otelHeaders = currentOpenTelemetryHeaders();
        const validationResult = this.contract.accepts.schema.safeParse(event.data);
        if (!validationResult.success) {
          throw new Error(`Accept Event data validation failed: ${validationResult.error.message}`);
        }
        const eventType = this.contract.accepts.type;
        const eventSubject: string =
          event.subject ??
          ArvoOrchestrationSubject.new({
            initiator: event.source,
            version: this.contract.version,
            orchestator: this.contract.accepts.type,
            meta: event.redirectto
              ? {
                  redirectto: event.redirectto,
                }
              : undefined,
          });
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
            type: eventType,
            datacontenttype: ArvoDataContentType,
            dataschema: EventDataschemaUtil.create(this.contract),
            data: validationResult.data,
            domain: event.domain === null ? undefined : (event.domain ?? this.contract.domain ?? undefined),
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
   * Creates and validates an event matching one of the contract's emit specifications.
   *
   * @param event - The event configuration object
   * @param [extensions] - Optional additional properties for the event
   *
   * @returns A validated ArvoEvent matching the specified emit type
   *
   * @throws {Error} If validation fails, emit type doesn't exist, or OpenTelemetry operations fail
   *
   * @example
   * ```typescript
   * const event = factory.emits({
   *   type: 'user.created',
   *   source: 'api/users',
   *   data: { id: '123', timestamp: new Date() }
   * });
   * ```
   */
  emits<U extends string & keyof TContract['emits'], TExtension extends Record<string, any>>(
    event: Omit<
      CreateArvoEvent<z.input<TContract['emits'][U]>, U>,
      'datacontenttype' | 'dataschema' | 'subject' | 'domain'
    > & {
      subject?: string;
      domain?: string | null;
    },
    extensions?: TExtension,
  ) {
    return ArvoOpenTelemetry.getInstance().startActiveSpan({
      name: `${this._name}.emits<${event.type}>`,
      spanOptions: createSpanOptions(this.contract),
      fn: (span) => {
        const otelHeaders = currentOpenTelemetryHeaders();
        const validationResult = this.contract.emits?.[event.type]?.safeParse(event.data);
        if (!validationResult?.success) {
          const msg = validationResult?.error?.message ?? `No contract available for ${event.type}`;
          throw new Error(`Emit Event data validation failed: ${msg}`);
        }

        const eventSubject =
          event.subject ??
          ArvoOrchestrationSubject.new({
            initiator: event.source,
            version: this.contract.version,
            orchestator: event.type,
            meta: event.redirectto
              ? {
                  redirectto: event.redirectto,
                }
              : undefined,
          });

        const generatedEvent = createArvoEvent<z.infer<TContract['emits'][U]>, TExtension, U>(
          {
            ...event,
            subject: eventSubject,
            traceparent: event.traceparent ?? otelHeaders.traceparent ?? undefined,
            tracestate: event.tracestate ?? otelHeaders.tracestate ?? undefined,
            datacontenttype: ArvoDataContentType,
            dataschema: EventDataschemaUtil.create(this.contract),
            data: validationResult.data,
            domain: event.domain === null ? undefined : (event.domain ?? this.contract.domain ?? undefined),
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
   * Creates a system error event for error reporting and handling.
   *
   * @param event - The error event configuration
   * @param event.error - The Error instance to convert to an event
   * @param [extensions] - Optional additional properties for the event
   *
   * @returns A system error ArvoEvent
   *
   * @throws {Error} If event creation or OpenTelemetry operations fail
   *
   * @example
   * ```typescript
   * const errorEvent = factory.systemError({
   *   error: new Error('Validation failed'),
   *   source: 'api/validation'
   * });
   * ```
   */
  systemError<TExtension extends Record<string, any>>(
    event: Omit<
      CreateArvoEvent<any, any>,
      'data' | 'type' | 'datacontenttype' | 'dataschema' | 'subject' | 'domain'
    > & {
      error: Error;
      subject?: string;
      domain?: string | null;
    },
    extensions?: TExtension,
  ) {
    return ArvoOpenTelemetry.getInstance().startActiveSpan({
      name: `${this._name}.systemError<${this.contract.systemError.type}>`,
      spanOptions: createSpanOptions(this.contract),
      fn: (span) => {
        const otelHeaders = currentOpenTelemetryHeaders();
        const { error, ..._event } = event;

        const eventType = this.contract.systemError.type;
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
          z.infer<typeof ArvoErrorSchema>,
          TExtension,
          TContract['systemError']['type']
        >(
          {
            ..._event,
            subject: eventSubject,
            traceparent: event.traceparent ?? otelHeaders.traceparent ?? undefined,
            tracestate: event.tracestate ?? otelHeaders.tracestate ?? undefined,
            type: eventType,
            data: createArvoError(error),
            datacontenttype: ArvoDataContentType,
            dataschema: EventDataschemaUtil.createWithWildCardVersion(this.contract),
            domain: event.domain === null ? undefined : (event.domain ?? this.contract.domain ?? undefined),
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
