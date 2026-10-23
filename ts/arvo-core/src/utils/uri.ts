import fastUri from 'fast-uri';

/**
 * Whether `value` is an RFC 3986 URI-reference already in canonical form.
 *
 * Stricter than the bare grammar: a valid but non-canonical value is
 * rejected rather than normalized. An uppercase scheme (`HTTPS://...`),
 * lowercase percent-encoding (`%2f`), an unresolved dot-segment (`./x`,
 * `a/../b`), or an authority with no path (`https://example.com`, which
 * canonicalizes to a trailing slash) all return `false`.
 *
 * The empty string returns `true` -- it is a valid URI-reference. Callers
 * that also require non-emptiness check for that separately.
 */
export const isUriReference = (uriReference: string): boolean => {
  const uriComponents = fastUri.parse(uriReference);
  if ('error' in uriComponents) return false;
  // a relative reference keeps leading dot-segments when serialized, so check them outright
  if (hasDotSegment(uriComponents.path)) return false;
  return fastUri.serialize(uriComponents) === uriReference;
};

/** Whether a path holds a `.` or `..` segment. */
const hasDotSegment = (path: string | undefined): boolean =>
  (path ?? '')
    .split('/')
    .some((pathSegment) => pathSegment === '.' || pathSegment === '..');
