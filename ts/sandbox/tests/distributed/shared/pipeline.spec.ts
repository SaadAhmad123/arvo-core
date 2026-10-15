import { SpanStatusCode } from '@opentelemetry/api';
import { ARVO_LOG_SEVERITY } from 'arvo-core';
import { describe, expect, it } from 'vitest';
import { readConfig } from '../../../src/distributed/shared/config.js';
import { startTelemetry } from '../../../src/distributed/shared/telemetry.js';
import {
  seriesFromPrometheus,
  streamsFromLoki,
  traceFromTempo,
} from './backends.js';

/**
 * Proves the telemetry pipeline before anything is built on it.
 *
 * Sends one of each signal and then reads each back out of the backend
 * that was supposed to receive it. A pipeline that silently drops
 * signals would make every later assertion about telemetry meaningless,
 * and the failure would look like a missing feature rather than a
 * missing exporter — so this runs first and alone.
 *
 * It needs the stack up: `pnpm run distributed:up`.
 */

/** How long one signal is given to travel and be read back. */
const PIPELINE_PATIENCE = 60_000;

describe('the telemetry pipeline', () => {
  it(
    'carries traces, metrics and logs as far as the backends',
    async () => {
      const config = readConfig('arvo-pipeline-probe');
      const telemetry = startTelemetry(config);
      const marker = `probe-${Date.now()}`;

      // --------------------------------------------------------- produce
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
      // the exporters batch, so nothing is readable until they flush
      await telemetry.shutdown();

      // ------------------------------------------------------- read back
      const trace = await traceFromTempo(traceId);
      expect(trace.batches?.length ?? 0).toBeGreaterThan(0);

      const series = await seriesFromPrometheus(
        `arvo_probe_total{marker="${marker}"}`,
      );
      expect(series.length).toBeGreaterThan(0);

      const streams = await streamsFromLoki(
        `{service_name="arvo-pipeline-probe"} |= \`${marker}\``,
      );
      expect(streams.length).toBeGreaterThan(0);
    },
    PIPELINE_PATIENCE,
  );
});
