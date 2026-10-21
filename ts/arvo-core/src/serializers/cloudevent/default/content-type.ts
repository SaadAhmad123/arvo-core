export type ParsedDataContentType = {
  mediaType: string;
  params: Record<string, string>;
};

/** `datacontenttype`'s media type and parameters, lower-cased per the case-insensitive media-type grammar — parameter *values* are left as-is, since a `version` parameter's value is case-sensitive. */
export const parseDataContentType = (
  contentType: unknown,
): ParsedDataContentType | null => {
  if (typeof contentType !== 'string' || contentType.length === 0) return null;
  const segments = contentType.split(';').map((segment) => segment.trim());
  const mediaType = segments[0]?.toLowerCase();
  if (!mediaType) return null;
  const params: Record<string, string> = {};
  for (const segment of segments.slice(1)) {
    const separatorIndex = segment.indexOf('=');
    if (separatorIndex === -1) continue;
    params[segment.slice(0, separatorIndex).trim().toLowerCase()] = segment
      .slice(separatorIndex + 1)
      .trim();
  }
  return { mediaType, params };
};
