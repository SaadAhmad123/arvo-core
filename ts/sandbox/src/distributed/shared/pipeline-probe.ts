import { SpanStatusCode } from '@opentelemetry/api';
import { ARVO_LOG_SEVERITY } from 'arvo-core';
import { readConfig } from './config.js';
import { startTelemetry } from './telemetry.js';

/**
 * Proves the telemetry pipeline before anything is built on it.
 *
 * Sends one of each signal and then reads each back out of the backend
 * that was supposed to receive it. A pipeline that silently drops
 * signals would make every assertion after this one meaningless, and
 * the failure would look like a missing feature rather than a missing
 * exporter.
 *
 * Run directly: `pnpm run distributed:probe`.
 */

const TEMPO = process.env.TEMPO_URL ?? 'http://localhost:3200';
const PROMETHEUS = process.env.PROMETHEUS_URL ?? 'http://localhost:9090';
const LOKI = process.env.LOKI_URL ?? 'http://localhost:3100';

/** Waits for something to become true, or gives up saying what it wanted. */
const until = async <TFound>(
  what: string,
  look: () => Promise<TFound | null>,
  within = 30_000,
): Promise<TFound> => {
  const giveUpAt = Date.now() + within;
  let last: unknown = null;

  while (Date.now() < giveUpAt) {
    try {
      const found = await look();
      if (found !== null) return found;
    } catch (raised) {
      last = raised;
    }
    await new Promise((settle) => setTimeout(settle, 500));
  }

  throw new Error(
    `${what} never arrived within ${within}ms${last === null ? '' : `: ${String(last)}`}`,
  );
};

/** The trace Tempo holds under this id, once it holds one. */
const traceFromTempo = async (traceId: string): Promise<unknown> =>
  until(`the trace ${traceId} in Tempo`, async () => {
    const answered = await fetch(`${TEMPO}/api/traces/${traceId}`);
    if (!answered.ok) return null;
    const held = (await answered.json()) as { batches?: unknown[] };
    return (held.batches?.length ?? 0) > 0 ? held : null;
  });

/** What Prometheus answers for one query, once it answers anything. */
const seriesFromPrometheus = async (query: string): Promise<unknown[]> =>
  until(`the series ${query} in Prometheus`, async () => {
    const answered = await fetch(
      `${PROMETHEUS}/api/v1/query?query=${encodeURIComponent(query)}`,
    );
    if (!answered.ok) return null;
    const held = (await answered.json()) as {
      data?: { result?: unknown[] };
    };
    const found = held.data?.result ?? [];
    return found.length > 0 ? found : null;
  });

/** The log lines Loki holds for one query, once it holds any. */
const linesFromLoki = async (query: string): Promise<unknown[]> =>
  until(`the lines ${query} in Loki`, async () => {
    const since = Date.now() - 10 * 60 * 1000;
    const answered = await fetch(
      `${LOKI}/loki/api/v1/query_range?query=${encodeURIComponent(query)}&start=${since}000000`,
    );
    if (!answered.ok) return null;
    const held = (await answered.json()) as {
      data?: { result?: unknown[] };
    };
    const found = held.data?.result ?? [];
    return found.length > 0 ? found : null;
  });

const probe = async (): Promise<void> => {
  const config = readConfig('arvo-pipeline-probe');
  const telemetry = startTelemetry(config);
  const marker = `probe-${Date.now()}`;

  // ------------------------------------------------------------- produce
  const span = telemetry.tracer.startSpan('pipeline.probe');
  span.setAttributes({ marker, 'probe.kind': 'all three signals' });
  const traceId = span.spanContext().traceId;

  // a child, so the trace that comes back has parentage to walk
  const child = telemetry.tracer.startSpan('pipeline.probe.child');
  child.setAttribute('marker', marker);
  child.setStatus({ code: SpanStatusCode.OK });
  child.end();

  telemetry.meter
    .createCounter('arvo_probe_total', {
      description: 'One per probe run, so the pipeline can be read back.',
    })
    .add(1, { marker });

  telemetry.logger.emit({
    severityNumber: ARVO_LOG_SEVERITY.info,
    body: `pipeline probe ${marker}`,
    attributes: { marker },
  });

  span.end();
  await telemetry.shutdown();

  // -------------------------------------------------------------- read back
  const found: string[] = [];

  await traceFromTempo(traceId);
  found.push(`traces  → Tempo holds ${traceId}`);

  const series = await seriesFromPrometheus(
    `arvo_probe_total{marker="${marker}"}`,
  );
  found.push(`metrics → Prometheus holds ${series.length} series`);

  const lines = await linesFromLoki(
    `{service_name="arvo-pipeline-probe"} |= \`${marker}\``,
  );
  found.push(`logs    → Loki holds ${lines.length} stream(s)`);

  for (const one of found) console.log(`  ${one}`);
  console.log('\n  the pipeline carries all three signals.');
};

probe().catch((raised: unknown) => {
  console.error(`\n  the pipeline is not carrying signals: ${String(raised)}`);
  process.exitCode = 1;
});
