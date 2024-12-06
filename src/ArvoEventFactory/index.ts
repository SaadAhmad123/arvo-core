import { z } from 'zod';
import { createArvoEvent } from '../ArvoEvent/helpers';
import { CreateArvoEvent } from '../ArvoEvent/types';
import { ArvoDataContentType } from '../ArvoEvent/schema';
import { ArvoErrorSchema } from '../schema';
import {
  ArvoOpenTelemetry,
  currentOpenTelemetryHeaders,
} from '../OpenTelemetry';
import { VersionedArvoContract } from '../ArvoContract/VersionedArvoContract';
import { EventDataschemaUtil } from '../utils';

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
export default class ArvoEventFactory<
  TContract extends VersionedArvoContract<any, any>,
> {
  protected readonly _name: string = 'ArvoEventFactory';
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
      CreateArvoEvent<
        z.input<TContract['accepts']['schema']>,
        TContract['accepts']['type']
      >,
      'type' | 'datacontenttype' | 'dataschema'
    >,
    extensions?: TExtension,
  ) {
    return ArvoOpenTelemetry.getInstance().startActiveSpan({
      name: `${this._name}<${EventDataschemaUtil.create(this.contract)}>.accepts`,
      fn: (span) => {
        const otelHeaders = currentOpenTelemetryHeaders();
        const validationResult = this.contract.accepts.schema.safeParse(
          event.data,
        );
        if (!validationResult.success) {
          throw new Error(
            `Accept Event data validation failed: ${validationResult.error.message}`,
          );
        }
        const generatedEvent = createArvoEvent<
          z.infer<TContract['accepts']['schema']>,
          TExtension,
          TContract['accepts']['type']
        >(
          {
            ...event,
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
  emits<
    U extends string & keyof TContract['emits'],
    TExtension extends Record<string, any>,
  >(
    event: Omit<
      CreateArvoEvent<z.input<TContract['emits'][U]>, U>,
      'datacontenttype' | 'dataschema'
    >,
    extensions?: TExtension,
  ) {
    return ArvoOpenTelemetry.getInstance().startActiveSpan({
      name: `${this._name}<${EventDataschemaUtil.create(this.contract)}>.emits<${event.type}>`,
      fn: (span) => {
        const otelHeaders = currentOpenTelemetryHeaders();
        const validationResult = this.contract.emits?.[event.type]?.safeParse(
          event.data,
        );
        if (!validationResult?.success) {
          const msg =
            validationResult?.error?.message ??
            `No contract available for ${event.type}`;
          throw new Error(`Emit Event data validation failed: ${msg}`);
        }
        const generatedEvent = createArvoEvent<
          z.infer<TContract['emits'][U]>,
          TExtension,
          U
        >(
          {
            ...event,
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
      'data' | 'type' | 'datacontenttype' | 'dataschema'
    > & {
      error: Error;
    },
    extensions?: TExtension,
  ) {
    return ArvoOpenTelemetry.getInstance().startActiveSpan({
      name: `${this._name}<${EventDataschemaUtil.createWithWildCardVersion(this.contract)}>.systemError`,
      fn: (span) => {
        const otelHeaders = currentOpenTelemetryHeaders();
        const { error, ..._event } = event;
        const generatedEvent = createArvoEvent<
          z.infer<typeof ArvoErrorSchema>,
          TExtension,
          TContract['systemError']['type']
        >(
          {
            ..._event,
            traceparent:
              event.traceparent ?? otelHeaders.traceparent ?? undefined,
            tracestate: event.tracestate ?? otelHeaders.tracestate ?? undefined,
            type: this.contract.systemError.type,
            data: {
              errorName: error.name,
              errorMessage: error.message,
              errorStack: error.stack ?? null,
            },
            datacontenttype: ArvoDataContentType,
            dataschema: EventDataschemaUtil.createWithWildCardVersion(
              this.contract,
            ),
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
