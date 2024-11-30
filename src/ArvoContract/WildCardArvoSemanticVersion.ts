import { isValidArvoSemanticVersion } from '../schema';
import { ArvoSemanticVersion } from '../types';

export const WildCardArvoSemanticVersion: ArvoSemanticVersion & '0.0.0' =
  '0.0.0';
export const isWildCardArvoSematicVersion = (version: ArvoSemanticVersion) =>
  isValidArvoSemanticVersion(version) &&
  version === WildCardArvoSemanticVersion;
