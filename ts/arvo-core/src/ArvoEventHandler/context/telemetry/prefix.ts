/**
 * What every name this package puts into telemetry begins with.
 *
 * One prefix so that two languages' traces and metrics can be read side by
 * side, and so a deployment can find Arvo's own signals among everything
 * else it collects.
 */
export const ARVO_TELEMETRY_PREFIX = 'arvo.';
