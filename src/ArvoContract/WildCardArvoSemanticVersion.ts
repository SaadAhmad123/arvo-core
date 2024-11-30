import { isValidArvoSemanticVersion } from '../schema';
import { ArvoSemanticVersion } from '../types';

/**
 * Special semantic version used as a wildcard matcher.
 * Represents version '0.0.0' which is reserved for system use.
 */
export const WildCardArvoSemanticVersion: ArvoSemanticVersion & '0.0.0' =
  '0.0.0';

/**
 * Checks if a version is the special wildcard version.
 * Validates that the input is both a valid semantic version and matches the wildcard value.
 *
 * @param version - Semantic version to check
 * @returns True if version is the wildcard version, false otherwise
 */
export const isWildCardArvoSematicVersion = (version: ArvoSemanticVersion) =>
  isValidArvoSemanticVersion(version) &&
  version === WildCardArvoSemanticVersion;
