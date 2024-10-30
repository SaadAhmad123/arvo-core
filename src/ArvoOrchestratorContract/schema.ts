import { z } from 'zod';
import { cleanString } from '../utils';

/**
 * Defines the base schema for orchestrator acceptance in the context of ArvoEvents.
 * This schema is used to validate and type-check the minimal required fields
 * for an orchestrator to accept a task or event.
 */
export const OrchestrationInitEventBaseSchema = z.object({
  parentSubject$$: z
    .string()
    .min(1, 'The parent subject must not be an empty string')
    .nullable()
    .describe(
      cleanString(`
    Identifies the subject of the parent process or event in the ArvoEvent system.
    
    Purpose:
    1. Enables the orchestrator to return its final output to the initiating process or orchestrator.
    2. Maintains the event chain and process hierarchy in a distributed system.
    3. Facilitates proper event routing and traceability.
    
    Usage:
    - For non-root processes: Set to the subject of the parent process/orchestrator.
    - For root processes/orchestrations: Must be set to null.
    
    This field aligns with the ArvoEvent 'subject' field, which is a URI identifying the event's subject.
    It plays a crucial role in distributed tracing, debugging, and maintaining system coherence.
    
    Example:
    - Parent process subject: "process/parent-id-123"
    - Child process parentSubject$$: "process/parent-id-123"
    
    Note: Ensure this value is a valid URI as per ArvoEvent specifications.
  `),
    ),
});
