/**
 * A map key rendered for an issue path.
 *
 * Bracketed and quoted because a version key contains dots and a service
 * name may too: `versions["1.0.0"]` cannot be misread the way
 * `versions.1.0.0` can. Matches how a contract reports its own positions.
 */
export const at = (key: string): string => `[${JSON.stringify(key)}]`;
