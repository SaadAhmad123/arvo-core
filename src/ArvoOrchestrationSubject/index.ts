import {
  ArvoOchestratorVersion,
  ArvoOrchestrationSubjectContent,
} from './type';
import { ArvoOrchestrationSubjectContentSchema } from './schema';
import * as zlib from 'zlib';
import { cleanString } from '../utils';
import { v4 as uuid4 } from 'uuid';

/**
 * Handles the creation and parsing of Arvo orchestration subjects.
 */
export default class ArvoOrchestrationSubject {
  /**
   * Creates a new Arvo orchestration subject.
   *
   * @param param - Parameters for creating the subject
   * @param param.orchestrator - Name of the orchestrator
   * @param param.version - Version of the orchestrator
   * @param param.initiator - Initiator of the orchestration
   * @returns A base64 encoded string representing the orchestration subject
   */
  static new(param: {
    orchestator: string;
    version: ArvoOchestratorVersion;
    initiator: string;
  }): string {
    return ArvoOrchestrationSubject.create({
      orchestrator: {
        name: param.orchestator,
        version: param.version,
      },
      execution: {
        id: uuid4(),
        initiator: param.initiator,
      },
    });
  }

  /**
   * Creates an Arvo orchestration subject from the provided content.
   *
   * @param param - The orchestration subject content
   * @returns A base64 encoded string representing the orchestration subject
   * @throws Error if the provided content is invalid or if compression fails
   */
  static create(param: ArvoOrchestrationSubjectContent): string {
    try {
      const validationResult =
        ArvoOrchestrationSubjectContentSchema.safeParse(param);
      if (!validationResult.success) {
        throw new Error(
          `Invalid ArvoOrchestrationContextType: ${validationResult.error}`,
        );
      }
      const jsonString = JSON.stringify(param);
      const compressed = zlib.deflateSync(jsonString);
      return compressed.toString('base64');
    } catch (e) {
      throw new Error(
        cleanString(`
        Error creating orchestration subject string from the provided context. 
        Error -> ${(e as Error).message}  
        Context -> ${JSON.stringify(param, null, 2)}
      `),
      );
    }
  }

  /**
   * Parses a base64 encoded Arvo orchestration subject string.
   *
   * @param subject - The base64 encoded subject string to parse
   * @returns The parsed ArvoOrchestrationSubjectContent
   * @throws Error if parsing or validation fails
   */
  static parse(subject: string): ArvoOrchestrationSubjectContent {
    try {
      const compressed = Buffer.from(subject, 'base64');
      const jsonString = zlib.inflateSync(compressed).toString();
      const parsed = JSON.parse(jsonString);
      const validationResult =
        ArvoOrchestrationSubjectContentSchema.safeParse(parsed);
      if (!validationResult.success) {
        throw new Error(
          `Invalid ArvoOrchestrationContextType: ${validationResult.error}`,
        );
      }
      return parsed as ArvoOrchestrationSubjectContent;
    } catch (e) {
      throw new Error(
        cleanString(`
        Error parsing orchestration subject string to the context. 
        Error -> ${(e as Error).message}  
        subject -> ${subject}
      `),
      );
    }
  }
}
