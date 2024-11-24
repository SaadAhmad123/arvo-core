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
  OTelNull,
  currentOpenTelemetryHeaders,
} from './OpenTelemetry';
import { OpenTelemetryHeaders, TelemetryLogLevel, ExecutionOpenTelemetryConfiguration } from './OpenTelemetry/types';
import {
  validateURI,
  cleanString,
  compareSemanticVersions,
  parseSemanticVersion,
} from './utils';
import ArvoContract from './ArvoContract';
import {
  createArvoContract,
  createSimpleArvoContract,
} from './ArvoContract/helpers';
import { ArvoContractValidators } from './ArvoContract/validators';
import {
  ArvoContractRecord,
  IArvoContract,
  ResolveArvoContractRecord,
  ArvoContractJSONSchema,
} from './ArvoContract/types';
import ArvoEventFactory from './ArvoEventFactory';
import {
  createArvoEventFactory,
  parseEventDataSchema,
} from './ArvoEventFactory/helpers';
import { ArvoErrorSchema, ArvoSemanticVersionSchema } from './schema';
import OpenInference from './OpenTelemetry/OpenInference';
import ArvoExecution from './OpenTelemetry/ArvoExecution';
import { ArvoExecutionSpanKind } from './OpenTelemetry/ArvoExecution/types';
import { OpenInferenceSpanKind } from './OpenTelemetry/OpenInference/types';
import ArvoOrchestrationSubject from './ArvoOrchestrationSubject';
import { ArvoOrchestrationSubjectContentSchema } from './ArvoOrchestrationSubject/schema';
import { ArvoOrchestrationSubjectContent } from './ArvoOrchestrationSubject/type';
import ArvoEventHttp from './ArvoEventHttp';
import { ArvoEventHttpConfig } from './ArvoEventHttp/types';
import {
  InferArvoContract,
  InferArvoEvent,
  ArvoSemanticVersion,
  ArvoErrorType,
} from './types';
import { createArvoOrchestratorContract } from './ArvoOrchestratorContract';
import { ICreateArvoOrchestratorContract } from './ArvoOrchestratorContract/types';
import { ArvoOrchestratorEventTypeGen } from './ArvoOrchestratorContract/typegen';
import { OrchestrationInitEventBaseSchema } from './ArvoOrchestratorContract/schema';

/**
 * Collection of Zod schemas for validating various aspects of Arvo events.
 * @property {z.ZodObject} CloudEventContextSchema - Schema for core CloudEvent properties.
 * @property {z.ZodRecord} CloudEventExtensionSchema - Schema for custom CloudEvent extensions.
 * @property {z.ZodRecord} ArvoDataSchema - Schema for Arvo event data payload.
 * @property {z.ZodObject} ArvoExtensionSchema - Schema for Arvo-specific CloudEvent extensions.
 * @property {z.ZodObject} OpenTelemetryExtensionSchema - Schema for OpenTelemetry extensions.
 * @property {z.ZodObject} OrchestrationInitEventBaseSchema - The base schema for the orchestrator init events.
 */
const ArvoEventSchema = {
  CloudEventContextSchema,
  CloudEventExtensionSchema,
  ArvoDataSchema,
  ArvoExtensionSchema,
  OpenTelemetryExtensionSchema,
  OrchestrationInitEventBaseSchema,
};

export {
  ArvoEventHttpConfig,
  ArvoEventHttp,
  ArvoEvent,
  createArvoEvent,
  ArvoDataContentType,
  ArvoEventData,
  CloudEventExtension,
  ArvoEventSchema,
  CloudEventContext,
  ArvoExtension,
  OpenTelemetryExtension,
  CreateArvoEvent,
  exceptionToSpan,
  logToSpan,
  OpenTelemetryHeaders,
  TelemetryLogLevel,
  OTelNull,
  validateURI,
  cleanString,
  ArvoContract,
  createArvoContract,
  ArvoContractValidators,
  ArvoContractRecord,
  IArvoContract,
  ResolveArvoContractRecord,
  ArvoEventFactory,
  createArvoEventFactory,
  currentOpenTelemetryHeaders,
  OpenInference,
  OpenInferenceSpanKind,
  ArvoExecution,
  ArvoExecutionSpanKind,
  ArvoContractJSONSchema,
  ArvoOrchestrationSubject,
  ArvoOrchestrationSubjectContent,
  ArvoSemanticVersion,
  InferArvoEvent,
  InferArvoContract,
  createArvoOrchestratorContract,
  ICreateArvoOrchestratorContract,
  ArvoOrchestratorEventTypeGen,
  ExecutionOpenTelemetryConfiguration,
  parseEventDataSchema,
  ArvoOrchestrationSubjectContentSchema,
  ArvoSemanticVersionSchema,
  ArvoErrorSchema,
  ArvoErrorType,
  compareSemanticVersions,
  parseSemanticVersion,
  createSimpleArvoContract,
};
