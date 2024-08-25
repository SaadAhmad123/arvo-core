import {
  ArvoEventData,
  ArvoExtension,
  CloudEventContext,
  CloudEventExtension,
  OpenTelemetryExtension,
} from './types';
import {
  ArvoDataContentType,
  ArvoDataSchema,
  ArvoExtensionSchema,
  CloudEventContextSchema,
  CloudEventExtensionSchema,
  OpenTelemetryExtensionSchema,
} from './schema';
import { OTelNull } from '../OpenTelemetry';

/**
 * Represents an ArvoEvent, which extends the CloudEvent specification.
 * @template TData - The type of the event data, extending ArvoEventData.
 * @template TExtension - The type of additional extensions, extending CloudEventExtension.
 */
export default class ArvoEvent<
  TData extends ArvoEventData = ArvoEventData,
  TExtension extends CloudEventExtension = CloudEventExtension,
> {
  readonly id: string;
  readonly source: string;
  readonly specversion: string;
  readonly type: string;
  readonly subject: string;
  readonly datacontenttype: string;
  readonly dataschema: string | null;
  readonly data: TData;
  readonly time: string;
  extensions: TExtension & ArvoExtension & OpenTelemetryExtension;

  /**
   * Creates an instance of ArvoEvent.
   * @param context - The CloudEvent context along with Arvo and OpenTelemetry extensions.
   * @param data - The event data.
   * @param extensions - Optional additional extensions.
   */
  constructor(
    context: CloudEventContext & ArvoExtension & OpenTelemetryExtension,
    data: TData,
    extensions?: TExtension,
  ) {
    const cloudEventContext = CloudEventContextSchema.parse(context);
    this.id = cloudEventContext.id;
    this.time = cloudEventContext.time;
    this.type = cloudEventContext.type;
    this.subject = cloudEventContext.subject;
    this.source = cloudEventContext.source;
    this.datacontenttype = cloudEventContext.datacontenttype;
    this.specversion = cloudEventContext.specversion;
    this.dataschema = cloudEventContext.dataschema;
    this.data = ArvoDataSchema.parse(data) as TData;

    const arvoExtension = ArvoExtensionSchema.parse(context);
    const otelExtension = OpenTelemetryExtensionSchema.parse(context);

    this.extensions = {
      ...((extensions
        ? CloudEventExtensionSchema.parse(extensions)
        : {}) as TExtension),
      to: arvoExtension.to,
      accesscontrol: arvoExtension.accesscontrol,
      redirectto: arvoExtension.redirectto,
      executionunits: arvoExtension.executionunits,
      traceparent: otelExtension.traceparent,
      tracestate: otelExtension.tracestate,
    };

    if (this.datacontenttype === ArvoDataContentType) {
      if (!this.extensions.to) {
        throw new Error(`The ArvoEvent must have a non-empty 'to' field`);
      }
    }

    Object.freeze(this);
    Object.freeze(this.extensions);
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
      extensions: this.extensions,
    };
  }

  /**
   * Converts the ArvoEvent to a JSON-serializable object.
   * @returns A plain object representation of the ArvoEvent.
   */
  toJSON() {
    return {
      ...this.cloudevent.default,
      ...this.extensions,
    } as Record<string, any>;
  }

  /**
   * Converts the ArvoEvent to a JSON string.
   * @param [spacing=0] - The number of spaces to use for indentation in the resulting JSON string.
   * @returns A JSON string representation of the ArvoEvent.
   */
  toString(spacing: number = 0) {
    return JSON.stringify(this.toJSON(), null, spacing);
  }

  /**
   * Gets OpenTelemetry attributes derived from the ArvoEvent.
   * @returns An object containing OpenTelemetry attributes.
   * The OpenTelemetry attributes for CloudEvents is as per
   * the spec provided [here](https://opentelemetry.io/docs/specs/semconv/attributes-registry/cloudevents/)
   * Additionally, the Arvo extension attributed are also returned
   * as `cloudevents.arvo.event_*` fields
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
      'cloudevents.event_dataschema': this.dataschema || OTelNull,
      'cloudevents.arvo.event_redirectto':
        this.extensions.redirectto || OTelNull,
      'cloudevents.arvo.event_to': this.extensions.to || OTelNull,
      'cloudevents.arvo.event_executionunits':
        this.extensions.executionunits || OTelNull,
    };
  }
}
