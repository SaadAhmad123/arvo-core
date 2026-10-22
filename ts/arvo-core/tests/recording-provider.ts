import { createRequire } from 'node:module';
import type { TraceAPI } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import type { ArvoLogger, ArvoLogRecord } from '../src/index.js';

/**
 * A tracer provider recording into memory, and a way to register it as an
 * SDK loaded through `require` registers itself.
 *
 * The OpenTelemetry API is published as two builds, one loaded by `import`
 * and one by `require`, and Node keeps them apart. This package reaches the
 * API through `import`; most SDKs reach it through `require`. Registering
 * through the `require` build is therefore what an application does, and it
 * is the only way a test sees what this package sees in one.
 */

const requiredApi: { trace: TraceAPI } = createRequire(import.meta.url)(
  '@opentelemetry/api',
);

/** A provider whose finished spans can be read back. */
export const recordingProvider = () => {
  const exporter = new InMemorySpanExporter();
  const provider = new TracerProvider({
    spanProcessors: [new SimpleSpanProcessor({ exporter })],
  });
  return {
    provider,
    tracer: provider.getTracer('test'),
    finished: (): ReadableSpan[] => exporter.getFinishedSpans(),
    /** Registers the provider globally, as an SDK loaded through `require` does. */
    registerAsAnApplicationWould: () => {
      requiredApi.trace.setGlobalTracerProvider(provider);
    },
  };
};

/** Undoes any global registration, so one test's provider never reaches another. */
export const unregisterProviders = () => {
  requiredApi.trace.disable();
};

/** A logger that keeps every record it is given. */
export const recordingLogger = (): ArvoLogger & {
  readonly records: ArvoLogRecord[];
} => {
  const records: ArvoLogRecord[] = [];
  return {
    records,
    emit: (record) => {
      records.push(record);
    },
  };
};
