import { VersionedArvoContract } from './ArvoContract/VersionedArvoContract';
import { WildCardArvoSemanticVersion } from './ArvoContract/WildCardArvoSemanticVersion';
import ArvoEvent from './ArvoEvent';
import { logToSpan } from './OpenTelemetry';
import { ArvoSemanticVersionSchema } from './schema';
import { ArvoSemanticVersion } from './types';

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
 * Parse semantic version string into its numeric components
 * @param version Semantic version string (e.g. "1.2.3")
 * @returns Object containing major, minor, and patch numbers
 */
interface VersionComponents {
  major: number;
  minor: number;
  patch: number;
}

export function parseSemanticVersion(
  version: ArvoSemanticVersion,
): VersionComponents {
  const [major, minor, patch] = version.split('.').map((part) => {
    const num = parseInt(part, 10);
    if (isNaN(num)) {
      throw new Error(`Invalid version number in ${version}`);
    }
    return num;
  });
  if (major === undefined || minor === undefined || patch === undefined) {
    throw new Error(`Invalid semantic version format: ${version}`);
  }
  return { major, minor, patch };
}

/**
 * Compares two semantic versions according to semver rules
 * Returns:
 * - Positive number if version1 > version2
 * - Negative number if version1 < version2
 * - 0 if version1 === version2
 */
export function compareSemanticVersions(
  version1: ArvoSemanticVersion,
  version2: ArvoSemanticVersion,
): number {
  const v1 = parseSemanticVersion(version1);
  const v2 = parseSemanticVersion(version2);
  if (v1.major !== v2.major) {
    return v1.major - v2.major;
  }
  if (v1.minor !== v2.minor) {
    return v1.minor - v2.minor;
  }
  return v1.patch - v2.patch;
}

/**
 * Manages event dataschema strings for versioned contracts.
 * Handles creation and parsing of dataschema identifiers.
 */
export class EventDataschemaUtil {
  static build<TUri extends string, TVersion extends ArvoSemanticVersion>(
    uri: TUri,
    version: TVersion,
  ) {
    return `${uri}/${version}` as const;
  }

  /**
   * Creates a dataschema string from a versioned contract.
   * Format: `{contract.uri}/{contract.version}`
   *
   * @param contract - Versioned contract instance
   * @returns Formatted dataschema string
   *
   * @example
   * ```typescript
   * const schema = EventDataschema.create(versionedContract);
   * // Returns: "my-contract/1.0.0"
   * ```
   */
  static create<T extends VersionedArvoContract<any, any>>(contract: T) {
    return EventDataschemaUtil.build<T['uri'], T['version']>(
      contract.uri,
      contract.version,
    );
  }

  /**
   * Creates dataschema string with wildcard version.
   * @param contract Versioned contract
   * @returns `{contract.uri}/{WildCardArvoSemanticVersion}`
   */
  static createWithWildCardVersion<T extends VersionedArvoContract<any, any>>(
    contract: T,
  ) {
    return EventDataschemaUtil.build<
      T['uri'],
      typeof WildCardArvoSemanticVersion
    >(contract.uri, WildCardArvoSemanticVersion);
  }

  /**
   * Extracts URI and version from dataschema string.
   *
   * @param data - Event object or dataschema string
   * @returns Parsed URI and version, or null if invalid
   *
   * @example
   * ```typescript
   * const result = EventDataschema.parse("my-contract/1.0.0");
   * // Returns: { uri: "my-contract", version: "1.0.0" }
   *
   * const invalid = EventDataschema.parse("invalid-schema");
   * // Returns: null
   * ```
   */
  static parse(data: ArvoEvent | string): {
    uri: string;
    version: ArvoSemanticVersion;
  } | null {
    try {
      const dataschema: string =
        typeof data === 'string' ? data : (data.dataschema ?? '');
      const items: string[] = dataschema.split('/');
      const version: ArvoSemanticVersion = ArvoSemanticVersionSchema.parse(
        items.pop(),
      ) as ArvoSemanticVersion;
      const uri: string = items.join('/');
      return { uri, version };
    } catch (e) {
      logToSpan({
        level: 'ERROR',
        message: `Unable to parse the event dataschema: ${(e as Error).message}`,
      });
      return null;
    }
  }
}
