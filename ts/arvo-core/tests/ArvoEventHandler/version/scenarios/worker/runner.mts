import { parentPort, workerData } from 'node:worker_threads';
import { trace } from '@opentelemetry/api';
import { ArvoExecutionContextTelemetry } from '../../../../../dist/ArvoEventHandler/context/telemetry/index.js';
import { ArvoEventSerializer } from '../../../../../dist/serializers/ArvoEventSerializer/index.js';
import { declareThreadedVersions } from './contracts.ts';

/**
 * One handler, in its own thread.
 *
 * It holds no store and no queue. What it has is the versions it can
 * run; everything else arrives in a message and leaves in one, which is
 * what a handler is — and what makes running four of them at once a
 * test of the thing rather than of the harness.
 */

const versions = declareThreadedVersions(workerData?.charges ?? 'succeeds');
const events = new ArvoEventSerializer({ type: 'arvoevent' });

/** What a broker asks this thread to run. */
type Asked = {
  readonly event: string;
  readonly entry: 'init' | 'followup';
  readonly executionId: string;
  readonly attempt: number;
  readonly contractType: string;
  readonly version: string;
  readonly state: unknown;
  readonly slowly: number;
};

parentPort?.on('message', async (asked: Asked) => {
  const restored = await events.tryDeserialize(asked.event);
  if (!restored.ok) {
    parentPort?.postMessage({ kind: 'refused' });
    return;
  }

  // held open deliberately, so two threads are inside their executors at
  // the same moment rather than merely close to it
  if (asked.slowly > 0) {
    await new Promise((settle) => setTimeout(settle, asked.slowly));
  }

  const version = versions[asked.contractType]?.[asked.version];
  if (version === undefined) {
    parentPort?.postMessage({ kind: 'refused' });
    return;
  }

  try {
    const response = await version.execute({
      entry: asked.entry,
      event: restored.value,
      state: asked.state,
      executionId: asked.executionId,
      attempt: asked.attempt,
      dependencies: {},
      hooks: {},
      telemetry: new ArvoExecutionContextTelemetry({
        span: trace.getTracer('worker').startSpan('execution'),
        meter: null,
        logger: null,
      }),
    } as never);

    if (response.kind === 'discarded') {
      parentPort?.postMessage({
        kind: 'discarded',
        reason: response.reason,
      });
      return;
    }

    const written = await Promise.all(
      response.events.map(async (leaving) => {
        const out = await events.trySerialize(leaving);
        return out.ok ? out.value : null;
      }),
    );

    parentPort?.postMessage({
      kind: 'produced',
      state: response.state,
      events: written.filter((one): one is string => one !== null),
    });
  } catch (raised) {
    const fault = raised as {
      _tag?: string;
      faultKind?: string;
      retry?: unknown;
      abandonmentEvent?: string | null;
      abandonmentState?: unknown;
      message?: string;
    };
    parentPort?.postMessage({
      kind: 'faulted',
      faultKind: fault.faultKind ?? 'unknown',
      retryable: fault.retry !== null && fault.retry !== undefined,
      abandonmentEvent: fault.abandonmentEvent ?? null,
      abandonmentState: fault.abandonmentState ?? null,
      message: fault.message ?? '',
    });
  }
});
