import { z } from "zod";

// Zod schema for ArvoOchestratorVersion
export const ArvoOchestratorVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, 'Invalid version format')
  .refine(value => !value.includes(';'), 'Version must not contain semicolon')
  .describe('Semantic version of the Arvo Orchestrator in the format X.Y.Z');

// Zod schema for ArvoOrchestrationSubjectContent
export const ArvoOrchestrationSubjectContentSchema = z.object({
  orchestrator: z.object({
    name: z
      .string()
      .regex(
        /^[a-z0-9]+(\.[a-z0-9]+)+\.[a-z0-9]+$/,
        'Orchestrator name should be prefixed with a reverse-DNS name',
      )
      .refine(value => !value.includes(';'), 'Orchestrator name must not contain semicolon')
      .describe('Name of the orchestrator'),
    version: ArvoOchestratorVersionSchema,
  })
  .describe('Information about the orchestrator'),
  execution: z.object({
    id: z
      .string()
      .min(1, 'ID must be a non-empty string')
      .refine(value => !value.includes(';'), 'ID must not contain semicolon')
      .describe('Unique identifier for the execution'),
    initiator: z
      .string()
      .regex(
        /^[a-z0-9]+(\.[a-z0-9]+)+\.[a-z0-9]+$/,
        'Orchestration initiator should be prefixed with a reverse-DNS name',
      )
      .refine(value => !value.includes(';'), 'Initiator must not contain semicolon')
      .describe('Entity or process that initiated the execution'),
  }).describe('Details about the current execution'),
}).describe('Context information for Arvo orchestration');