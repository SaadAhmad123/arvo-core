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
 * Represents an ArvoEvent, which extends the CloudEvent specification.
 */
export default class ArvoEvent<
  TData extends ArvoEventData = ArvoEventData,
  TExtension extends CloudEventExtension = CloudEventExtension,
  TType extends string = string,
> {
  public readonly id: string;
  public readonly source: string;
  public readonly specversion: string;
  public readonly type: TType;
  public readonly subject: string;
  public readonly datacontenttype: string;
  public readonly dataschema: string | null;
  public readonly data: TData;
  public readonly time: string;
  private readonly _extensions: TExtension & ArvoExtension & OpenTelemetryExtension;

  /**
   * Creates an instance of ArvoEvent.
   * @param context - The CloudEvent context along with Arvo and OpenTelemetry extensions.
   * @param data - The event data.
   * @param extensions - Optional additional extensions.
   *
   * @throws {Error} If the datacontenttype is {@link ArvoDataContentType} but the `to` field
   *                 is not defined
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
   * Gets the CloudEvent-specified default fields and extensions.
   * @returns An object containing the base CloudEvent default fields and extensions.
   * `default` fields are the standard CloudEvents attributes, which include:
   * `extension` fields are additional attributes that provide extra context or functionality:
   * - ArvoExtension: Arvo-specific extensions (to, accesscontrol, redirectto, executionunits)
   * - OpenTelemetryExtension: OpenTelemetry-specific extensions (traceparent, tracestate)
   * - TExtension: Any additional custom extensions
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
   * Converts the ArvoEvent to a JSON-serializable object.
   * It bundles the extensions and the cloudevent fields into
   * one object.
   *
   * @remarks
   * This method combines the default CloudEvent fields and all extensions
   * (including Arvo and OpenTelemetry extensions) into a single object.
   * If you need to access the CloudEvent fields and extensions separately,
   * use the `cloudevent` getter instead.
   */
  toJSON() {
    return {
      ...this.cloudevent.default,
      ...this._extensions,
    } as InferArvoEvent<typeof this>;
  }

  /**
   * Converts the ArvoEvent to a JSON string.
   * @param [spacing=0] - The number of spaces to use for indentation in the resulting JSON string.
   * @returns A JSON string representation of the ArvoEvent.
   */
  toString(spacing = 0) {
    return JSON.stringify(this.toJSON(), null, spacing);
  }

  /**
   * Gets OpenTelemetry attributes derived from the ArvoEvent.
   * @returns An object containing OpenTelemetry attributes.
   * The OpenTelemetry attributes for CloudEvents is as per
   * the spec provided [in the official documentation](https://opentelemetry.io/docs/specs/semconv/attributes-registry/cloudevents/).
   * Additionally, the Arvo extension attributed are also returned
   * as `cloudevents.arvo.event_*` fields.
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
    };
  }

  get to() {
    return this._extensions.to;
  }

  get accesscontrol() {
    return this._extensions.accesscontrol;
  }

  get redirectto() {
    return this._extensions.redirectto;
  }

  get executionunits() {
    return this._extensions.executionunits;
  }

  get traceparent() {
    return this._extensions.traceparent;
  }

  get tracestate() {
    return this._extensions.tracestate;
  }

  /**
   * Gets the custom extensions of the ArvoEvent.
   *
   * @remarks
   * This getter returns only the custom extensions (TExtension) added to the ArvoEvent,
   * excluding the standard Arvo and OpenTelemetry extensions.
   * For accessing all extensions including Arvo and OpenTelemetry,
   * use `<ArvoEvent>.cloudevent.extensions`.
   * For accessing the basic CloudEvent fields, use `<ArvoEvent>.cloudevent.default`.
   */
  get extensions() {
    const { traceparent, tracestate, to, redirectto, accesscontrol, executionunits, ...rest } = this
      ._extensions as Record<string, any>;
    return rest as TExtension;
  }
}
