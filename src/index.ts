import ArvoEvent from "./ArvoEvent";
import { ArvoDataContentType, CloudEventContextSchema, CloudEventExtensionSchema, ArvoDataSchema, ArvoExtensionSchema, OpenTelemetryExtensionSchema } from "./ArvoEvent/schema";
import { createArvoEvent } from "./ArvoEvent/helpers";
import { CloudEventContext, CloudEventExtension, ArvoEventData, ArvoExtension, OpenTelemetryExtension, CreateArvoEvent, CreateArvoEventResult } from "./ArvoEvent/types";
import { exceptionToSpan, logToSpan, getTelemetryContext, getTelemetryCarrier, newOtelSpan, OTelNull } from "./OpenTelemetry";
import {TelemetryCarrier, TelemetryContext, TelemetryLogLevel} from './OpenTelemetry/types'
import { validateURI, cleanString } from "./utils";

const ArvoEventSchemas = {
  CloudEventContextSchema,
  CloudEventExtensionSchema,
  ArvoDataSchema,
  ArvoExtensionSchema, 
  OpenTelemetryExtensionSchema
}

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
  CreateArvoEventResult,
  CreateArvoEvent,

  exceptionToSpan,
  logToSpan,
  getTelemetryCarrier,
  getTelemetryContext,
  newOtelSpan,
  TelemetryCarrier,
  TelemetryContext, 
  TelemetryLogLevel,
  OTelNull,

  validateURI,
  cleanString

}