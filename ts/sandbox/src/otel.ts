/**
 * OpenTelemetry setup for this sandbox: the Node SDK's own
 * `NodeTracerProvider`, exporting every finished span to the console --
 * not a hand-built SpanContext, and not a silent no-exporter provider.
 *
 * Swap `ConsoleSpanExporter` for a real one (e.g.
 * `@opentelemetry/exporter-trace-otlp-http`) here if you want spans sent
 * somewhere real while you play.
 */

import {
	ConsoleSpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

export const provider = new NodeTracerProvider({
	spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())],
});

export const tracer = provider.getTracer("sandbox");

/** Call once, when the script is done, to flush and release the provider. */
export async function shutdownOtel(): Promise<void> {
	await provider.shutdown();
}
