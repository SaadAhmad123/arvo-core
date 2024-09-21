/**
 * Represents the version of the Arvo Orchestrator.
 *
 * @remark
 * The version follows the Semantic Versioning format: MAJOR.MINOR.PATCH
 * **Note**: The string must not contain ';'
 *
 * @example
 * "1.0.0", "2.3.1", "0.5.2"
 */
export type ArvoOchestratorVersion = `${number}.${number}.${number}`;

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
     * @remark
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
    version: ArvoOchestratorVersion;
  };

  /**
   * Details about the current execution.
   */
  execution: {
    /**
     * A unique identifier for the execution.
     *
     * @remark
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
     * @remark
     * Should be prefixed with a reverse-DNS name.
     * **Note**: The string must not contain ';'
     *
     * @example
     * "com.example.initiator-service"
     */
    initiator: string;
  };
};
