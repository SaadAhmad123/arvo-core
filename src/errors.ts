import z from 'zod';

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
 * - Execution error like rate limit exceeded on external API calls
 * - Contract violations (invalid input/output)
 * - Configuration errors
 * - Permission/authorization failures
 */
export class ViolationError<T extends string = string> extends Error {
  /** The specific type/category of the violation */
  readonly type: T;

  /** Additional structured data about the violation */
  readonly metadata: Record<string, any> | null;

  /** An additional flag to determine if it is an Arvo specific violation error */
  readonly isArvoViolationError = true;

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

/**
 * Type guard to determine if an unknown value is a ViolationError, an instance
 * of a class that inherits from ViolationError.
 *
 * @param e - The value to check, typically an unknown error or exception
 * @returns `true` if the value is a ViolationError, inherits from it, or has the isArvoViolationError flag, `false` otherwise
 *
 * ```typescript
 * const error = new ViolationError({
 *   type: 'RATE_LIMIT',
 *   message: 'API rate limit exceeded'
 * });
 *
 * console.log(isViolationError(error)); // true
 * console.log(isViolationError(new Error())); // false
 * console.log(isViolationError(null)); // false
 * ```
 */
export const isViolationError = (e: unknown): boolean => {
  const ViolationErrorSchema = z.object({
    isArvoViolationError: z.literal(true),
    type: z.string().min(1),
    name: z.string().min(1),
    message: z.string().min(1),
  });
  return e instanceof Error && ViolationErrorSchema.safeParse(e).success;
};
