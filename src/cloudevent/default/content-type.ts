export type ParsedDataContentType = {
  mediaType: string;
  params: Record<string, string>;
};

/** `datacontenttype`'s media type and parameters, lower-cased per the case-insensitive media-type grammar — parameter *values* are left as-is, since a `version` parameter's value is case-sensitive. */
export const parseDataContentType = (
  value: unknown,
): ParsedDataContentType | null => {
  if (typeof value !== 'string' || value.length === 0) return null;
  const parts = value.split(';').map((part) => part.trim());
  const mediaType = parts[0]?.toLowerCase();
  if (!mediaType) return null;
  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    params[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
  }
  return { mediaType, params };
};
