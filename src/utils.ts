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
