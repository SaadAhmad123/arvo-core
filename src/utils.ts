/**
 * Cleans a string by removing leading/trailing whitespace from each line,
 * removing empty lines, and joining the remaining lines with newline characters.
 *
 * @param s - The input string to be cleaned.
 * @returns A new string with cleaned content.
 *
 * @example
 * const input = "  Hello  \n  World  \n\n  ";
 * const cleaned = cleanString(input);
 * console.log(cleaned); // Output: "Hello\nWorld"
 */
export function cleanString(s: string): string {
  return s
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => Boolean(item))
    .join('\n');
}

/**
 * Validates if a given string is a properly encoded URI.
 *
 * This function checks if the input string remains unchanged after being
 * decoded and then re-encoded, which indicates that it's a valid URI.
 *
 * @param value - The string to be validated as a URI.
 * @returns A boolean indicating whether the input is a valid URI (true) or not (false).
 *
 * @example
 * validateURI("https://example.com"); // Returns true
 * validateURI("https://example.com/path with spaces"); // Returns false
 * validateURI("https://example.com/path%20with%20spaces"); // Returns true
 */
export const validateURI = (value: string) => {
  try {
    return value === encodeURI(decodeURI(value));
  } catch {
    return false;
  }
};

/**
 * Creates an RFC 3339 compliant timestamp string with an optional UTC offset.
 * 
 * @param offsetHours - The number of hours to offset from UTC. Positive values
 *                      represent hours ahead of UTC, negative values represent
 *                      hours behind UTC. Defaults to 0 (UTC).
 * @returns A string representing the current date and time in RFC 3339 format
 *          with the specified UTC offset.
 * 
 * @example
 * // Returns current time in UTC
 * createTimestamp();
 * 
 * @example
 * // Returns current time with +2 hours offset
 * createTimestamp(2);
 * 
 * @example
 * // Returns current time with -5 hours offset
 * createTimestamp(-5);
 */
export const createTimestamp = (offsetHours: number = 0): string => {
  const now = new Date();
  const offsetMinutes = offsetHours * 60;
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset() + offsetMinutes);
  return now.toISOString().replace('Z', offsetHours >= 0 ? `+${String(offsetHours).padStart(2, '0')}:00` : `-${String(Math.abs(offsetHours)).padStart(2, '0')}:00`);
}