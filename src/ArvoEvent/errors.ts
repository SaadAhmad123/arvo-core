/**
 * Thrown by {@link ArvoEvent}'s constructor when its input fails validation
 */
export class ArvoEventValidationError extends Error {
  /** Discriminant for identifying this error type without an `instanceof` check. */
  readonly _tag = 'ArvoEventValidationError';

  /**
   * @param message - Human-readable description of what failed.
   * @param options - Standard `ErrorOptions`.
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = this._tag;
  }
}
