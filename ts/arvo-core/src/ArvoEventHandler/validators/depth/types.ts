/** What a depth validator is built from. */
export type ArvoEventDepthValidatorParam = {
  /**
   * How deep an execution of this version may sit, or reach. An event's
   * `depth` must be below it, not equal to it.
   */
  maxDepth: number;
};
