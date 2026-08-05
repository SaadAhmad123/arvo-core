/**
 * The current instant as an RFC 3339 timestamp, in UTC.
 *
 * Deliberately always `Z`, never `+00:00` — this is `ArvoEvent`'s own
 * default `time` whenever a caller omits one, and CloudEvent's own
 * `toJSON()` normalizes any `time` to exactly this form
 * (`new Date(value).toISOString()`) the moment a `CloudEvent` is
 * serialized. Already producing that canonical form means the default
 * path round-trips through real wire serialization unchanged, not just
 * through an in-memory object.
 */
export const createTimestamp = (): string => new Date().toISOString();

/**
 * Truncates `text` to at most `maxLength` characters, replacing anything cut
 * with a single ellipsis character.
 */
export const truncate = (text: string, maxLength: number): string =>
  text.length > maxLength
    ? `${text.slice(0, Math.max(0, maxLength - 1))}…`
    : text;

/** Longest rendering of a value in an error message before it is truncated. */
export const MAX_DESCRIBED_VALUE_LENGTH = 80;

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
    return truncate(JSON.stringify(value), MAX_DESCRIBED_VALUE_LENGTH);
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
    return truncate(serialized, MAX_DESCRIBED_VALUE_LENGTH);
  } catch {
    // Cyclic or otherwise unserializable — the shape is what matters here.
    return 'an object';
  }
};
