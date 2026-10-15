/**
 * A map key rendered as the path segment that addresses it.
 *
 * Bracketed and quoted, so a key carrying a dot cannot be misread as two
 * segments: `versions["1.0.0"]` says what `versions.1.0.0` leaves open.
 *
 * @param key - The key to address.
 * @returns The segment, to be appended to the path of the map holding it.
 *
 * @example
 * ```typescript
 * `versions${pathSegmentForKey('1.0.0')}`; // 'versions["1.0.0"]'
 * ```
 */
export const pathSegmentForKey = (key: string): string =>
  `[${JSON.stringify(key)}]`;
