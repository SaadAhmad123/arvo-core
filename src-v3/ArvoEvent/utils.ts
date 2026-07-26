/**
 * Checks if an object is JSON serializable.
 *
 * @param obj - The object to check for JSON serializability.
 * @returns A boolean indicating whether the object is JSON serializable.
 * @throws {Error} If the object is not JSON serializable.
 */
export const isJSONSerializable = (obj: unknown): boolean => {
  try {
    const serialized = JSON.stringify(obj);
    if (serialized === '{}' && Object.keys(obj as object).length > 0) {
      return false;
    }
    const parsed = JSON.parse(serialized);
    return JSON.stringify(obj) === JSON.stringify(parsed);
  } catch {
    return false;
  }
};
