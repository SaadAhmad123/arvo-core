/**
 * ArvoExection class containing attribute constants for OpenTelemetry.
 */
// biome-ignore lint/complexity/noStaticOnlyClass: This needs to be a static class to group methods together
export class ArvoExecution {
  static readonly ATTR_SPAN_KIND = 'arvo.span.kind';
}

export const ArvoExecutionSpanKind = {
  EVENT_HANDLER: 'handler.simple',
  ORCHESTRATOR: 'handler.orchestrator.statemachine',
  RESUMABLE: 'handler.orchestrator.imperative',
  INTERNAL: 'internal',
};
