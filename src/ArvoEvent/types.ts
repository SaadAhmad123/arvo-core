import { z } from 'zod';
import {
  CloudEventContextSchema,
  ArvoExtensionSchema,
  CloudEventExtensionSchema,
  ArvoDataSchema,
  OpenTelemetryExtensionSchema,
} from './schema';
import ArvoEvent from '.';

export type CloudEventContext = z.infer<typeof CloudEventContextSchema>;
export type CloudEventExtension = z.infer<typeof CloudEventExtensionSchema>;

export type ArvoEventData = z.infer<typeof ArvoDataSchema>;

export type ArvoExtension = z.infer<typeof ArvoExtensionSchema>;
export type OpenTelemetryExtension = z.infer<
  typeof OpenTelemetryExtensionSchema
>;

export type CreateArvoEvent<
  TData extends ArvoEventData,
> = {
  id?: string;
  source: string;
  type: string;
  subject: string;
  data: TData;
  to?: string;
  accesscontrol?: string;
  redirectto?: string;
  executionunits?: number;
  traceparent?: string;
  tracestate?: string;
  datacontenttype?: string;
  specversion?: "1.0";
  time?: string;
  dataschema?: string;
}

export type CreateArvoEventResult<
  TData extends ArvoEventData,
  TExtension extends CloudEventExtension,
> = {
  event: ArvoEvent<TData, TExtension> |  null,
  errors: Error[],
  warnings: string[]
}