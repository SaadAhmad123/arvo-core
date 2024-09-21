/**
 * Configuration object for ArvoEventHttp operations.
 */
export type ArvoEventHttpConfig = {
  /** HTTP headers */
  headers: Record<string, string | number | boolean | null>;
  /** Event data */
  data: Record<string, any>;
};
