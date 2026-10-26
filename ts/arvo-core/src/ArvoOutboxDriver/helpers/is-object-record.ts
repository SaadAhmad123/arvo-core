/** Whether an answer is an object whose fields can be read, not an array or none. */
export const isObjectRecord = (
  candidate: unknown,
): candidate is Readonly<Record<string, unknown>> =>
  typeof candidate === 'object' &&
  candidate !== null &&
  !Array.isArray(candidate);
