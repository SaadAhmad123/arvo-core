/**
 * What every name this package puts into telemetry begins with.
 *
 * One prefix so that two languages' traces and metrics can be read side by
 * side, and so a deployment can find Arvo's own signals among everything
 * else it collects.
 */
export const ARVO_TELEMETRY_PREFIX = 'arvo.';

/** What a span is marked failed with where nothing said why. */
export const ARVO_DEFAULT_SPAN_ERROR = 'the delivery did not succeed';
