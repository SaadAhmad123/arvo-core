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
export const createTimestamp = (offsetHours = 0): string => {
  const now = new Date();
  const offsetMinutes = offsetHours * 60;
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset() + offsetMinutes);
  return now
    .toISOString()
    .replace(
      'Z',
      offsetHours >= 0
        ? `+${String(offsetHours).padStart(2, '0')}:00`
        : `-${String(Math.abs(offsetHours)).padStart(2, '0')}:00`,
    );
};

/**
 * Truncates `text` to at most `maxLength` characters, replacing anything cut
 * with a single ellipsis character.
 */
export const truncate = (text: string, maxLength: number): string =>
  text.length > maxLength
    ? `${text.slice(0, Math.max(0, maxLength - 1))}…`
    : text;

/** Longest rendering of a value in an error message before it is truncated. */
export const MAX_RECEIVED_LENGTH = 80;

/**
 * Renders a value for an error message: readable, bounded, and unambiguous
 * about type. `"3"` and `3` must not look alike in a message explaining that
 * one of them is the wrong type.
 *
 * Shared by every error type in this package that reports an offending
 * value — {@link ArvoEventValidationIssue}'s `received` and
 * `CloudEventTransformationErrorDetail`'s `cause` alike — so the same value
 * looks the same regardless of which boundary reported it.
 */
export const describeValue = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') {
    return truncate(JSON.stringify(value), MAX_RECEIVED_LENGTH);
  }
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (typeof value === 'bigint') return `${value}n (bigint)`;
  if (typeof value === 'function') return 'a function';
  if (typeof value === 'symbol') return value.toString();
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (Array.isArray(value)) return `an array of ${value.length}`;

  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return 'an object';
    return truncate(serialized, MAX_RECEIVED_LENGTH);
  } catch {
    // Cyclic or otherwise unserializable — the shape is what matters here.
    return 'an object';
  }
};
