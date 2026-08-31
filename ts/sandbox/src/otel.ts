/**
 * OpenTelemetry setup for this sandbox: the Node SDK's own
 * `NodeTracerProvider`, exporting every finished span to the console --
 * not a hand-built SpanContext, and not a silent no-exporter provider.
 *
 * Batched rather than simple, so the span dumps arrive together when
 * `shutdownOtel` flushes at the end of the run instead of interleaving with
 * the chapter that started the span.
 *
 * Swap `ConsoleSpanExporter` for a real one (e.g.
 * `@opentelemetry/exporter-trace-otlp-http`) here if you want spans sent
 * somewhere real while you play.
 */

import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

export const provider = new NodeTracerProvider({
  spanProcessors: [new BatchSpanProcessor(new ConsoleSpanExporter())],
});

export const tracer = provider.getTracer('sandbox');

/** Call once, when the script is done, to flush and release the provider. */
export async function shutdownOtel(): Promise<void> {
  await provider.shutdown();
}
