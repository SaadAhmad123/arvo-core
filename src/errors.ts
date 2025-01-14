/**
 * Parameters for constructing a ViolationError
 */
export type ViolationErrorParam<T extends string = string> = {
  /** The specific type/category of the violation */
  type: T;
  /** A human-readable description of what went wrong */
  message: string;
  /** Optional structured data providing additional context about the error */
  metadata?: Record<string, any>;
};

/**
 * ViolationError represents errors that require explicit handling in the system.
 * These are distinct from recoverable errors that can be automatically handled
 * by workflow logic. The explicit handling may be required for severe 
 * violation of service contracts or explict retry handling
 * 
 * Common violation scenarios include:
 * - Rate limit exceeded on external API calls
 * - Contract violations (invalid input/output)
 * - Configuration errors
 * - Permission/authorization failures
 * 
 * @example
 * ```typescript
 * // Creating a rate limit violation
 * throw new ViolationError({
 *   type: 'RATE_LIMIT_EXCEEDED',
 *   message: 'API rate limit reached, retry after 60 seconds',
 *   metadata: { retryAfter: 60 }
 * });
 * 
 * // Handling violations
 * try {
 *   await apiCall();
 * } catch (error) {
 *   if (error instanceof ViolationError && error.type === 'RATE_LIMIT_EXCEEDED') {
 *     const retryAfter = error.metadata?.retryAfter;
 *     // Handle rate limiting...
 *   }
 * }
 * ```
 */
export class ViolationError<T extends string = string> extends Error {
  /** The specific type/category of the violation */
  readonly type: T;

  /** Additional structured data about the violation */
  readonly metadata: Record<string, any> | null;

  /** 
   * The error name, formatted as ViolationError<TYPE> 
   * This helps with error identification in logs and stack traces
   */
  readonly name: `ViolationError<${T}>`;

  constructor({ type, message, metadata }: ViolationErrorParam<T>) {
    super(`ViolationError<${type}> ${message}`);
    this.type = type;
    this.name = `ViolationError<${this.type}>`;
    this.metadata = metadata ?? null;
  }
}