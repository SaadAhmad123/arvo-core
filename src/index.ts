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
import ArvoContract from './ArvoContract';
import {
  createArvoContract,
  InferArvoContract,
  createContractualArvoEvent,
} from './ArvoContract/helpers';
import { ArvoContractValidators } from './ArvoContract/validators';
import {
  ArvoContractRecord,
  IArvoContract,
  ResolveArvoContractRecord,
} from './ArvoContract/types';
import ArvoContractLibrary from './ArvoContractLibrary';
import { createArvoContractLibrary } from './ArvoContractLibrary/helpers';

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
  ArvoContract,
  createArvoContract,
  ArvoContractValidators,
  ArvoContractRecord,
  InferArvoContract,
  IArvoContract,
  ResolveArvoContractRecord,
  ArvoContractLibrary,
  createArvoContractLibrary,
  createContractualArvoEvent,
};
