import ArvoContract from './ArvoContract';
import { createArvoContract } from './ArvoContract/helpers';
import ArvoEvent from './ArvoEvent';
import { createArvoEvent } from './ArvoEvent/helpers';
import {
  ArvoDataContentType,
  ArvoDataSchema,
  ArvoExtensionSchema,
  CloudEventContextSchema,
  CloudEventExtensionSchema,
  OpenTelemetryExtensionSchema,
} from './ArvoEvent/schema';
import {
  ArvoEventData,
  ArvoExtension,
  CloudEventContext,
  CloudEventExtension,
  CreateArvoEvent,
  OpenTelemetryExtension,
} from './ArvoEvent/types';
import { ArvoOpenTelemetry, OTelNull, currentOpenTelemetryHeaders, exceptionToSpan, logToSpan } from './OpenTelemetry';
import { OpenTelemetryHeaders, TelemetryLogLevel } from './OpenTelemetry/types';
import {
  EventDataschemaUtil,
  cleanString,
  compareSemanticVersions,
  createArvoError,
  parseSemanticVersion,
  validateURI,
} from './utils';

import { createSimpleArvoContract } from './ArvoContract/SimpleArvoContract';
import { SimpleArvoContract } from './ArvoContract/SimpleArvoContract/types';
import { VersionedArvoContract } from './ArvoContract/VersionedArvoContract';
import { WildCardArvoSemanticVersion, isWildCardArvoSematicVersion } from './ArvoContract/WildCardArvoSemanticVersion';
import {
  ArvoContractJSONSchema,
  ArvoContractRecord,
  IArvoContract,
  ResolveArvoContractRecord,
} from './ArvoContract/types';
import { ArvoContractValidators } from './ArvoContract/validators';
import ArvoEventFactory from './ArvoEventFactory';
import { ArvoOrchestratorEventFactory } from './ArvoEventFactory/Orchestrator';
import { createArvoEventFactory, createArvoOrchestratorEventFactory } from './ArvoEventFactory/helpers';
import ArvoOrchestrationSubject from './ArvoOrchestrationSubject';
import { ArvoOrchestrationSubjectContentSchema } from './ArvoOrchestrationSubject/schema';
import { ArvoOrchestrationSubjectContent } from './ArvoOrchestrationSubject/type';
import { createArvoOrchestratorContract } from './ArvoOrchestratorContract';
import { OrchestrationInitEventBaseSchema } from './ArvoOrchestratorContract/schema';
import { ArvoOrchestratorEventTypeGen } from './ArvoOrchestratorContract/typegen';
import { ArvoOrchestratorContract, ICreateArvoOrchestratorContract } from './ArvoOrchestratorContract/types';
import ArvoExecution from './OpenTelemetry/ArvoExecution';
import { ArvoExecutionSpanKind } from './OpenTelemetry/ArvoExecution/types';
import OpenInference from './OpenTelemetry/OpenInference';
import { OpenInferenceSpanKind } from './OpenTelemetry/OpenInference/types';
import { ViolationError, ViolationErrorParam } from './errors';
import { ArvoErrorSchema, ArvoSemanticVersionSchema, isValidArvoSemanticVersion } from './schema';
import { ArvoErrorType, ArvoSemanticVersion, InferArvoEvent, InferVersionedArvoContract } from './types';

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
  createArvoOrchestratorContract,
  ICreateArvoOrchestratorContract,
  ArvoOrchestratorEventTypeGen,
  EventDataschemaUtil,
  ArvoOrchestrationSubjectContentSchema,
  ArvoSemanticVersionSchema,
  ArvoErrorSchema,
  ArvoErrorType,
  compareSemanticVersions,
  parseSemanticVersion,
  createSimpleArvoContract,
  ArvoOrchestratorContract,
  VersionedArvoContract,
  InferVersionedArvoContract,
  isWildCardArvoSematicVersion,
  WildCardArvoSemanticVersion,
  isValidArvoSemanticVersion,
  SimpleArvoContract,
  ArvoOrchestratorEventFactory,
  createArvoOrchestratorEventFactory,
  ArvoOpenTelemetry,
  ViolationError,
  ViolationErrorParam,
  createArvoError,
};
