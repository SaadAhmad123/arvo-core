import { ArvoOrchestrationSubjectContent } from './type';
import { ArvoSemanticVersion } from '../types';
import { ArvoOrchestrationSubjectContentSchema } from './schema';
import * as zlib from 'node:zlib';
import { cleanString } from '../utils';
import { v4 as uuid4 } from 'uuid';

/**
 * Handles the creation and parsing of Arvo orchestration subjects.
 */
export default class ArvoOrchestrationSubject {
  /**
   * Represents a wildcard version number used when version matching is not required.
   * Format follows semantic versioning pattern.
   */
  public static readonly WildCardMachineVersion: ArvoSemanticVersion = '0.0.0';

  /**
   * Creates a new Arvo orchestration subject with basic required parameters.
   * This is a convenience method that wraps the more detailed {@link create} method.
   *
   * @param param - Configuration object for the orchestration subject
   * @param param.orchestator - Name identifier of the orchestrator
   * @param param.version - Version of the orchestrator. If null, defaults to {@link WildCardMachineVersion}
   * @param param.initiator - Identifier of the entity initiating the orchestration
   * @param param.meta - Optional metadata key-value pairs for additional orchestration context
   * @returns A base64 encoded string containing the compressed orchestration subject data
   * @throws Error if the provided parameters result in invalid subject content
   *
   * @example
   * ```typescript
   * const subject = ArvoOrchestrationSubject.new({
   *   orchestator: "mainProcess",
   *   version: "1.0.0",
   *   initiator: "systemA"
   * });
   *
   * // With metadata
   * const subjectWithMeta = ArvoOrchestrationSubject.new({
   *   orchestator: "com.company.mainProcess",
   *   version: "1.0.0",
   *   initiator: "com.company.systemA",
   *   meta: {
   *     priority: "high",
   *     environment: "production"
   *   }
   * });
   * ```
   */
  static new(param: {
    orchestator: string;
    version: ArvoSemanticVersion | null;
    initiator: string;
    meta?: Record<string, string>;
  }): string {
    return ArvoOrchestrationSubject.create({
      orchestrator: {
        name: param.orchestator,
        version:
          param.version ?? ArvoOrchestrationSubject.WildCardMachineVersion,
      },
      execution: {
        id: uuid4(),
        initiator: param.initiator,
      },
      meta: param.meta ?? {},
    });
  }

  /**
   * Creates a new orchestration subject string from an existing parent subject.
   * This method parses the parent subject, merges its metadata with new metadata (if available),
   * and creates a new subject with updated orchestrator information while maintaining
   * the relationship to the parent context.
   *
   * @param param - Configuration object for creating a new subject from a parent
   * @param param.orchestator - Name identifier of the new orchestrator
   * @param param.version - Version of the new orchestrator. If null, defaults to {@link WildCardMachineVersion}
   * @param param.subject - Base64 encoded string of the parent orchestration subject
   * @param param.meta - Optional additional metadata to merge with the parent's metadata
   * @returns A new base64 encoded string containing the compressed orchestration subject data
   * @throws Error if the parent subject is invalid or if the new parameters result in invalid subject content
   *
   * @example
   * ```typescript
   * // Create a parent subject
   * const parentSubject = ArvoOrchestrationSubject.new({
   *   orchestator: "parentProcess",
   *   version: "1.0.0",
   *   initiator: "systemA",
   *   meta: { environment: "production" }
   * });
   *
   * // Create a new subject from the parent
   * const childSubject = ArvoOrchestrationSubject.from({
   *   orchestator: "childProcess",
   *   version: "2.0.0",
   *   subject: parentSubject,
   *   meta: { step: "processing" }  // Will be merged with parent's metadata
   * });
   * ```
   */
  static from(param: {
    orchestator: string;
    version: ArvoSemanticVersion | null;
    subject: string;
    meta?: Record<string, string>;
  }): string {
    const parsedSubject = ArvoOrchestrationSubject.parse(param.subject);
    return ArvoOrchestrationSubject.new({
      initiator: parsedSubject.orchestrator.name,
      version: param.version ?? ArvoOrchestrationSubject.WildCardMachineVersion,
      orchestator: param.orchestator,
      meta: {
        ...(parsedSubject.meta ?? {}),
        ...(param.meta ?? {}),
      },
    });
  }

  /**
   * Creates an Arvo orchestration subject from detailed content parameters.
   * The content is validated, compressed using zlib, and encoded in base64 format.
   *
   * @param param - Detailed orchestration subject content following the {@link ArvoOrchestrationSubjectContent} structure
   * @returns A base64 encoded string containing the compressed orchestration subject data
   * @throws Error if validation fails or compression encounters an error
   *
   * @example
   * ```typescript
   * const subject = ArvoOrchestrationSubject.create({
   *   orchestrator: {
   *     name: "mainProcess",
   *     version: "1.0.0"
   *   },
   *   execution: {
   *     id: "550e8400-e29b-41d4-a716-446655440000",
   *     initiator: "systemA"
   *   }
   * });
   * ```
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
   * Parses a base64 encoded orchestration subject string back into its structured content form.
   * Performs decompression, JSON parsing, and validation of the subject content.
   *
   * @param subject - Base64 encoded string representing the compressed orchestration subject
   * @returns The decoded and validated {@link ArvoOrchestrationSubjectContent}
   * @throws Error if decompression, parsing, or validation fails
   *
   * @example
   * ```typescript
   * const content = ArvoOrchestrationSubject.parse(encodedSubject);
   * console.log(content.orchestrator.name);
   * console.log(content.execution.id);
   * ```
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
