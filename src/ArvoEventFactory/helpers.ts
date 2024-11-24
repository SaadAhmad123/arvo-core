import ArvoEventFactory from '.';
import ArvoContract from '../ArvoContract';
import { ArvoSemanticVersion } from '../types';
import ArvoEvent from '../ArvoEvent';
import { exceptionToSpan } from '../OpenTelemetry';
import { ArvoSemanticVersionSchema } from '../schema';
import { VersionedArvoContract } from '../ArvoContract/VersionedArvoContract';

/**
 * Creates an ArvoEventFactory for a specific version of a contract.
 *
 * @template TContract - The versioned contract type
 *
 * @param contract - The versioned contract to create a factory for
 * @returns An ArvoEventFactory instance for the specified contract version
 *
 * @example
 * ```typescript
 * const contract = createArvoContract({...});
 * const v1Contract = contract.version('1.0.0');
 * const factory = createArvoEventFactory(v1Contract);
 * ```
 */
export const createArvoEventFactory = <
  TContract extends VersionedArvoContract<ArvoContract, ArvoSemanticVersion>,
>(
  contract: TContract,
) => new ArvoEventFactory(contract);

/**
 * Parses an event data schema string or ArvoEvent object to extract the URI and version.
 * The schema is expected to be in the format "uri/version" where version follows semantic versioning.
 *
 * @param data - The input to parse, either a string containing the schema or an ArvoEvent object
 *               If an ArvoEvent is provided, its dataschema property will be used
 *
 * @returns An object containing the parsed URI and semantic version, or null if parsing fails
 *          The URI is everything before the last "/" and the version is everything after
 *
 * @example
 * // String input
 * parseEventDataSchema("com.example/schema/1.0.0")
 * // Returns: { uri: "com.example/schema", version: "1.0.0" }
 *
 * // ArvoEvent input
 * parseEventDataSchema({ dataschema: "com.example/schema/1.0.0" })
 * // Returns: { uri: "com.example/schema", version: "1.0.0" }
 *
 * @throws Will not throw errors directly, but converts any parsing errors to spans
 */
export const parseEventDataSchema = (
  data: string | ArvoEvent,
): {
  uri: string;
  version: ArvoSemanticVersion;
} | null => {
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
    exceptionToSpan(e as Error);
    return null;
  }
};
