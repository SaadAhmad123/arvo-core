import ArvoEvent from './ArvoEvent';
import {
  ArvoDataContentType,
  CloudEventContextSchema,
  CloudEventExtensionSchema,
  ArvoDataSchema,
  ArvoExtensionSchema,
  OpenTelemetryExtensionSchema,
} from './ArvoEvent/schema';
import { createArvoEvent } from './ArvoEvent/helpers';
import {
  CloudEventContext,
  CloudEventExtension,
  ArvoEventData,
  ArvoExtension,
  OpenTelemetryExtension,
  CreateArvoEvent,
} from './ArvoEvent/types';
import {
  exceptionToSpan,
  logToSpan,
  getTelemetryContext,
  getTelemetryCarrier,
  createOtelSpan,
  OTelNull,
} from './OpenTelemetry';
import {
  TelemetryCarrier,
  TelemetryContext,
  TelemetryLogLevel,
} from './OpenTelemetry/types';
import { validateURI, cleanString } from './utils';

/**
 * Collection of Zod schemas for validating various aspects of Arvo events.
 * @property {z.ZodObject} CloudEventContextSchema - Schema for core CloudEvent properties.
 * @property {z.ZodRecord} CloudEventExtensionSchema - Schema for custom CloudEvent extensions.
 * @property {z.ZodRecord} ArvoDataSchema - Schema for Arvo event data payload.
 * @property {z.ZodObject} ArvoExtensionSchema - Schema for Arvo-specific CloudEvent extensions.
 * @property {z.ZodObject} OpenTelemetryExtensionSchema - Schema for OpenTelemetry extensions.
 */
const ArvoEventSchemas = {
  CloudEventContextSchema,
  CloudEventExtensionSchema,
  ArvoDataSchema,
  ArvoExtensionSchema,
  OpenTelemetryExtensionSchema,
};

export {
  ArvoEvent,
  createArvoEvent,
  ArvoDataContentType,
  ArvoEventData,
  CloudEventExtension,
  ArvoEventSchemas,
  CloudEventContext,
  ArvoExtension,
  OpenTelemetryExtension,
  CreateArvoEvent,
  exceptionToSpan,
  logToSpan,
  getTelemetryCarrier,
  getTelemetryContext,
  createOtelSpan,
  TelemetryCarrier,
  TelemetryContext,
  TelemetryLogLevel,
  OTelNull,
  validateURI,
  cleanString,
};
