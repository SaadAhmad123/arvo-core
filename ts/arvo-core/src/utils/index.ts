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
