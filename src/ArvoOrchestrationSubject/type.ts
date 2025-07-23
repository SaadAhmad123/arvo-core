import type { ArvoSemanticVersion } from '../types';

/**
 * Represents the content for Arvo orchestration subject.
 * This type provides information about the orchestrator and the current execution.
 */
export type ArvoOrchestrationSubjectContent = {
  /**
   * Information about the orchestrator.
   */
  orchestrator: {
    /**
     * The name of the orchestrator.
     *
     * Should be prefixed with a reverse-DNS name.
     * **Note**: The string must not contain ';'
     *
     * @example
     * "com.example.myorchestrator"
     */
    name: string;

    /**
     * The version of the orchestrator.
     */
    version: ArvoSemanticVersion;
  };

  /**
   * Details about the current execution.
   */
  execution: {
    /**
     * A unique identifier for the execution.
     *
     * Should be a non-empty string. The recomendation
     * is to use uuid v4 to generate these ids.
     * **Note**: The string must not contain ';'
     *
     * @example
     * "abc123", "execution-2023-05-15-001"
     */
    id: string;

    /**
     * The entity or process that initiated the execution.
     *
     * Should be prefixed with a reverse-DNS name.
     * **Note**: The string must not contain ';'
     *
     * @example
     * "com.example.initiator-service"
     */
    initiator: string;

    /** The domain of the init event */
    domain: string | null;
  };

  /**
   * Additional metadata for the orchestration process. Store essential key-value pairs
   * that provide context or configuration details necessary for the orchestration.
   * Use selectively to maintain clarity and avoid storing unnecessary information.
   */
  meta: Record<string, string>;
};
