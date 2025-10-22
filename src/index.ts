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
import {
  ArvoOpenTelemetry,
  OTelNull,
  currentOpenTelemetryHeaders,
  exceptionToSpan,
  getOtelHeaderFromSpan,
  logToSpan,
} from './OpenTelemetry';
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
  ArvoContractParam,
  ArvoContractRecord,
  ResolveArvoContractRecord,
} from './ArvoContract/types';
import { ArvoContractValidators } from './ArvoContract/validators';
import { ArvoEventIdObject, ArvoEventIdObjectSchema, createArvoEventId, parseArvoEventId } from './ArvoEvent/id';
import ArvoEventFactory from './ArvoEventFactory';
import { ArvoOrchestratorEventFactory } from './ArvoEventFactory/Orchestrator';
import { createArvoEventFactory, createArvoOrchestratorEventFactory } from './ArvoEventFactory/helpers';
import ArvoOrchestrationSubject from './ArvoOrchestrationSubject';
import { ArvoOrchestrationSubjectContentSchema } from './ArvoOrchestrationSubject/schema';
import { ArvoOrchestrationSubjectContent } from './ArvoOrchestrationSubject/type';
import { createArvoOrchestratorContract } from './ArvoOrchestratorContract';
import { OrchestrationInitEventBaseSchema } from './ArvoOrchestratorContract/schema';
import { ArvoOrchestratorEventTypeGen } from './ArvoOrchestratorContract/typegen';
import { ArvoOrchestratorContract, CreateArvoOrchestratorContractParam } from './ArvoOrchestratorContract/types';
import { ArvoExecution, ArvoExecutionSpanKind } from './OpenTelemetry/ArvoExecution';
import { OpenInference, OpenInferenceSpanKind } from './OpenTelemetry/OpenInference';
import { ViolationError, ViolationErrorParam, isViolationError } from './errors';
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
  ArvoContractParam as IArvoContract,
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
  CreateArvoOrchestratorContractParam as ICreateArvoOrchestratorContract,
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
  createArvoEventId,
  parseArvoEventId,
  ArvoEventIdObjectSchema,
  ArvoEventIdObject,
  isViolationError,
  getOtelHeaderFromSpan,
};
