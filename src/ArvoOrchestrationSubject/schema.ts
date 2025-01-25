import { z } from 'zod';
import { ArvoSemanticVersionSchema } from '../schema';
import { cleanString } from '../utils';

// Zod schema for ArvoOrchestrationSubjectContent
export const ArvoOrchestrationSubjectContentSchema = z
  .object({
    orchestrator: z
      .object({
        name: z
          .string()
          .regex(/^[a-z0-9]+(\.[a-z0-9]+)+\.[a-z0-9]+$/, 'Orchestrator name should be prefixed with a reverse-DNS name')
          .refine((value) => !value.includes(';'), 'Orchestrator name must not contain semicolon')
          .describe('Name of the orchestrator'),
        version: ArvoSemanticVersionSchema,
      })
      .describe('Information about the orchestrator'),
    execution: z
      .object({
        id: z
          .string()
          .min(1, 'ID must be a non-empty string')
          .refine((value) => !value.includes(';'), 'ID must not contain semicolon')
          .describe('Unique identifier for the execution'),
        initiator: z
          .string()
          .regex(
            /^[a-z0-9]+(\.[a-z0-9]+)+\.[a-z0-9]+$/,
            'Orchestration initiator should be prefixed with a reverse-DNS name',
          )
          .refine((value) => !value.includes(';'), 'Initiator must not contain semicolon')
          .describe('Entity or process that initiated the execution'),
      })
      .describe('Details about the current execution'),
    meta: z.record(z.string(), z.string()).describe(
      cleanString(`
        Additional metadata for the orchestration process. Store essential key-value pairs 
        that provide context or configuration details necessary for the orchestration. 
        Use selectively to maintain clarity and avoid storing unnecessary information.  
      `),
    ),
  })
  .describe('Context information for Arvo orchestration');
