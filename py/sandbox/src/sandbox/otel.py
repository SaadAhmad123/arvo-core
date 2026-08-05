"""OpenTelemetry setup for this sandbox: the real SDK's own `TracerProvider`,
exporting every finished span to the console -- not a hand-built
SpanContext, and not a no-exporter provider.

Swap `ConsoleSpanExporter` for a real one (e.g. `OTLPSpanExporter`) here
if you want spans sent somewhere real while you play.
"""

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import ConsoleSpanExporter, SimpleSpanProcessor

provider = TracerProvider()
provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))

tracer = provider.get_tracer("sandbox")


def shutdown_otel() -> None:
    """Call once, when the script is done, to flush and release the provider."""
    provider.shutdown()
