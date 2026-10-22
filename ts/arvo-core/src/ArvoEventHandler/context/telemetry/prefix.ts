/**
 * What every name this package puts into telemetry begins with.
 *
 * One prefix so that two languages' traces and metrics can be read side by
 * side, and so a deployment can find Arvo's own signals among everything
 * else it collects.
 */
export const ARVO_TELEMETRY_PREFIX = 'arvo.';

/** What a span is marked failed with where nothing said why. */
export const ARVO_DEFAULT_SPAN_ERROR = 'the execution did not succeed';

/**
 * The instrumentation name this package records its telemetry under where no
 * tracer is given, so all of it can be configured, sampled or dropped as one.
 */
export const ARVO_INSTRUMENTATION_NAME = 'arvo-core';
