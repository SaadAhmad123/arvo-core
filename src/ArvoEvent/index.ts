import { OTelNull } from '../OpenTelemetry';
import type { InferArvoEvent } from '../types';
import {
  ArvoDataContentType,
  ArvoDataSchema,
  ArvoExtensionSchema,
  CloudEventContextSchema,
  CloudEventExtensionSchema,
  OpenTelemetryExtensionSchema,
} from './schema';
import type {
  ArvoEventData,
  ArvoExtension,
  CloudEventContext,
  CloudEventExtension,
  OpenTelemetryExtension,
} from './types';

/**
 * Represents an ArvoEvent, which extends the CloudEvent specification with
 * Arvo-specific extensions for event routing, access control, execution metrics,
 * and OpenTelemetry distributed tracing support.
 */
export default class ArvoEvent<
  TData extends ArvoEventData = ArvoEventData,
  TExtension extends CloudEventExtension = CloudEventExtension,
  TType extends string = string,
> {
  /** Unique identifier of the event */
  public readonly id: string;

  /**
   * URI reference identifying the context in which the event happened.
   * Must be a properly encoded URI representing the event producer.
   */
  public readonly source: string;

  /**
   * The version of the CloudEvents specification which the event uses.
   * Must be '1.0' for this version of the specification.
   */
  public readonly specversion: string;

  /**
   * Describes the type of event related to the originating occurrence.
   * Must follow reverse-DNS naming convention (e.g., 'com.example.service.eventtype').
   */
  public readonly type: TType;

  /**
   * Identifies the subject of the event in the context of the event producer.
   * In Arvo, this must be the Process ID and must be a properly encoded URI.
   */
  public readonly subject: string;

  /**
   * Content type of the data value following RFC 2046 format.
   * Must contain 'application/cloudevents+json' or 'application/json'.
   * Defaults to 'application/cloudevents+json;charset=UTF-8;profile=arvo'.
   */
  public readonly datacontenttype: string;

  /**
   * URI identifying the schema that the data adheres to.
   * Must be a properly encoded URI if present, null otherwise.
   */
  public readonly dataschema: string | null;

  /** The event data payload as a JSON serializable object */
  public readonly data: TData;

  /**
   * Timestamp of when the occurrence happened in RFC 3339 format.
   * If the actual occurrence time cannot be determined, this may be set
   * to another time (such as current time) by the producer.
   */
  public readonly time: string;

  private readonly _extensions: TExtension & ArvoExtension & OpenTelemetryExtension;

  /**
   * Creates an instance of ArvoEvent with CloudEvent context, data, and optional extensions.
   *
   * @param context - The CloudEvent context combined with required Arvo and OpenTelemetry extensions
   * @param data - The event data payload (must be JSON serializable)
   * @param extensions - Optional additional custom extensions with lowercase alphanumeric keys
   *
   * @throws {Error} If datacontenttype is "application/cloudevents+json;charset=UTF-8;profile=arvo" but the 'to' field is not defined
   * @throws {Error} If any validation fails according to the respective schemas
   *
   * @example
   * ```typescript
   * const event = new ArvoEvent(
   *   {
   *     id: 'event-123',
   *     source: 'https://example.com/service',
   *     type: 'com.example.user.created',
   *     subject: 'https://example.com/users/123',
   *     time: new Date().toISOString(),
   *     specversion: '1.0',
   *     datacontenttype: 'application/cloudevents+json;charset=UTF-8;profile=arvo',
   *     dataschema: null,
   *     to: 'com.example.user.processor',
   *     accesscontrol: 'role:admin;department:hr',
   *     redirectto: null,
   *     executionunits: 10,
   *     parentid: 'parent-event-456',
   *     domain: 'analytics',
   *     traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
   *     tracestate: 'vendor=trace-data'
   *   },
   *   { userId: '123', name: 'John Doe' }
   * );
   * ```
   */
  constructor(
    context: CloudEventContext & ArvoExtension & OpenTelemetryExtension,
    data: TData,
    extensions?: TExtension,
  ) {
    const cloudEventContext = CloudEventContextSchema.parse(context);
    this.id = cloudEventContext.id;
    this.time = cloudEventContext.time;
    this.type = cloudEventContext.type as TType;
    this.subject = cloudEventContext.subject;
    this.source = cloudEventContext.source;
    this.datacontenttype = cloudEventContext.datacontenttype;
    this.specversion = cloudEventContext.specversion;
    this.dataschema = cloudEventContext.dataschema;
    this.data = ArvoDataSchema.parse(data) as TData;

    const arvoExtension = ArvoExtensionSchema.parse(context);
    const otelExtension = OpenTelemetryExtensionSchema.parse(context);

    this._extensions = {
      ...((extensions ? CloudEventExtensionSchema.parse(extensions) : {}) as TExtension),
      to: arvoExtension.to,
      accesscontrol: arvoExtension.accesscontrol,
      redirectto: arvoExtension.redirectto,
      executionunits: arvoExtension.executionunits,
      traceparent: otelExtension.traceparent,
      tracestate: otelExtension.tracestate,
      parentid: arvoExtension.parentid,
      domain: arvoExtension.domain,
    };

    if (this.datacontenttype === ArvoDataContentType) {
      if (!this._extensions.to) {
        throw new Error(`The ArvoEvent must have a non-empty 'to' field`);
      }
    }
    Object.freeze(this);
    Object.freeze(this._extensions);
  }

  /**
   * Gets the CloudEvent-specified fields separated into default attributes and extensions.
   *
   * @returns An object containing:
   * - `default`: Standard CloudEvent attributes (id, source, specversion, type, subject, datacontenttype, dataschema, data, time)
   * - `extensions`: All extension attributes including:
   *   - Arvo extensions
   *   - OpenTelemetry extensions
   *   - Custom extensions
   *
   * @example
   * ```typescript
   * const { default: defaults, extensions } = event.cloudevent;
   * console.log(defaults.id); // Event ID
   * console.log(extensions.to); // Arvo 'to' field
   * ```
   */
  get cloudevent() {
    return {
      default: {
        id: this.id,
        source: this.source,
        specversion: this.specversion,
        type: this.type,
        subject: this.subject,
        datacontenttype: this.datacontenttype,
        dataschema: this.dataschema,
        data: this.data,
        time: this.time,
      },
      extensions: {
        ...this._extensions,
      },
    };
  }

  /**
   * Converts the ArvoEvent to a JSON-serializable object by combining
   * all CloudEvent default fields with all extensions into a single flat object.
   *
   * @returns A flat object containing all CloudEvent fields and extensions,
   * suitable for JSON serialization and network transmission
   *
   * @remarks
   * This method creates a flattened representation where both standard CloudEvent
   * fields and all extensions (Arvo, OpenTelemetry, and custom) are at the same level.
   * For separated access to defaults and extensions, use the `cloudevent` getter instead.
   *
   * @example
   * ```typescript
   * const jsonObj = event.toJSON();
   * // Contains: id, source, type, subject, data, time, to, traceparent, etc.
   * ```
   */
  toJSON() {
    return {
      ...this.cloudevent.default,
      ...this._extensions,
    } as InferArvoEvent<typeof this>;
  }

  /**
   * Converts the ArvoEvent to a JSON string representation.
   *
   * @param spacing - The number of spaces to use for indentation (default: 0 for compact output)
   * @returns A JSON string representation of the complete ArvoEvent
   *
   * @example
   * ```typescript
   * const compactJson = event.toString(); // Compact JSON
   * const prettyJson = event.toString(2); // Pretty-printed with 2-space indentation
   * ```
   */
  toString(spacing = 0) {
    return JSON.stringify(this.toJSON(), null, spacing);
  }

  /**
   * Gets OpenTelemetry attributes derived from the ArvoEvent for distributed tracing.
   *
   * @returns An object containing OpenTelemetry semantic convention attributes:
   * - Standard CloudEvent attributes prefixed with 'cloudevents.event_*'
   * - Arvo-specific attributes prefixed with 'cloudevents.arvo.*'
   * - Uses 'N/A' for undefined/null values to maintain telemetry consistency
   *
   * @remarks
   * The attributes follow the OpenTelemetry semantic conventions for CloudEvents
   * as specified in the official documentation:
   * https://opentelemetry.io/docs/specs/semconv/attributes-registry/cloudevents/
   */
  get otelAttributes() {
    return {
      'cloudevents.event_id': this.id || OTelNull,
      'cloudevents.event_source': this.source || OTelNull,
      'cloudevents.event_spec_version': this.specversion || OTelNull,
      'cloudevents.event_subject': this.subject || OTelNull,
      'cloudevents.event_type': this.type || OTelNull,
      'cloudevents.event_time': this.time || OTelNull,
      'cloudevents.event_datacontenttype': this.datacontenttype || OTelNull,
      'cloudevents.event_dataschema': this.dataschema ?? OTelNull,
      'cloudevents.arvo.event_redirectto': this._extensions.redirectto ?? OTelNull,
      'cloudevents.arvo.event_to': this._extensions.to ?? OTelNull,
      'cloudevents.arvo.event_executionunits': this._extensions.executionunits ?? OTelNull,
      'cloudevents.arvo.event_parentid': this._extensions.parentid ?? OTelNull,
      'cloudevents.arvo.event_domain': this._extensions.domain ?? OTelNull,
    };
  }

  /**
   * Gets the target consumer machine for event routing.
   */
  get to() {
    return this._extensions.to;
  }

  /**
   * Gets the access control information for the event.
   * Can contain:
   * - A UserID (valid UUID)
   * - An encrypted base64 string with access control data
   * - Key-value pairs (semicolon-separated, colon-delimited)
   *   Example: "role:admin;department:finance;clearance:top-secret"
   */
  get accesscontrol() {
    return this._extensions.accesscontrol;
  }

  /**
   * Gets the alternative recipient or destination for dynamic routing.
   * Enables complex workflows and conditional event routing.
   */
  get redirectto() {
    return this._extensions.redirectto;
  }

  /**
   * Gets the execution units representing the cost associated with
   * generating this event. Used for tracking financial impact and
   * resource utilization in cloud-based systems.
   */
  get executionunits() {
    return this._extensions.executionunits;
  }

  /**
   * Gets the OpenTelemetry traceparent header containing trace context
   * information including trace ID, parent span ID, and trace flags
   * for distributed tracing across services.
   */
  get traceparent() {
    return this._extensions.traceparent;
  }

  /**
   * Gets the OpenTelemetry tracestate header containing vendor-specific
   * trace information as key-value pairs propagated alongside traceparent
   * in distributed tracing scenarios.
   */
  get tracestate() {
    return this._extensions.tracestate;
  }

  /**
   * Gets the unique identifier of the event that directly triggered
   * the creation of this event within the Arvo ecosystem.
   * Establishes direct causal relationships for event lineage tracking.
   * Null indicates an initiating event or generation outside direct causation.
   */
  get parentid() {
    return this._extensions.parentid;
  }

  /**
   * Gets the processing domain for event routing and workflow orchestration.
   */
  get domain() {
    return this._extensions.domain;
  }

  /**
   * Gets only the custom extensions (TExtension) added to the ArvoEvent,
   * excluding the standard Arvo and OpenTelemetry extensions.
   *
   * @returns The custom extensions object with Arvo and OpenTelemetry fields removed
   *
   * @remarks
   * For accessing all extensions including Arvo and OpenTelemetry, use `cloudevent.extensions`.
   * For accessing basic CloudEvent fields, use `cloudevent.default`.
   * Custom extension keys must follow lowercase alphanumeric naming (a-z, 0-9 only).
   */
  get extensions() {
    const { traceparent, tracestate, to, redirectto, accesscontrol, executionunits, parentid, domain, ...rest } = this
      ._extensions as Record<string, any>;
    return rest as TExtension;
  }
}
