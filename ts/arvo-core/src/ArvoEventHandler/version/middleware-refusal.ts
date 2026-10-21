import {
  type ArvoComposedMiddlewareResolutionError,
  ArvoComposedMiddlewareValidationError,
} from './composed-middleware/errors.js';
import type { ArvoGateRefusal } from './types.js';

/**
 * Why an execution's middleware could not be built, as the refusal the
 * version turns into a fault.
 *
 * Copies and decides nothing: each error already carries the fault it
 * becomes. Kept beside the version, so the composite knows nothing of
 * refusals or faults.
 *
 * @param error - What building the middleware failed with.
 * @returns The refusal: its fault kind and message, and as violations the
 * validation error's issues, or the resolution error's position and what
 * was thrown there, which is also the cause.
 */
export const refusalFrom = (
  error:
    | ArvoComposedMiddlewareResolutionError
    | ArvoComposedMiddlewareValidationError,
): ArvoGateRefusal => {
  if (error instanceof ArvoComposedMiddlewareValidationError) {
    return {
      faultKind: error.faultKind,
      message: error.message,
      violations: error.issues.map((issue) => issue.toString()),
    };
  }
  const thrownMessage =
    error.cause instanceof Error ? error.cause.message : String(error.cause);
  return {
    faultKind: error.faultKind,
    message: error.message,
    violations: [`${error.position}: ${thrownMessage}`],
    cause: thrownMessage,
  };
};
