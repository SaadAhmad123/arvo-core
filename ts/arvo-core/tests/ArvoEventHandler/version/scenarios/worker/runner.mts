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
const serializer = new ArvoEventSerializer({ type: 'arvoevent' });

/** What a broker asks this thread to run. */
type RunRequest = {
  readonly event: string;
  readonly entry: 'init' | 'followup';
  readonly executionId: string;
  readonly attempt: number;
  readonly contractType: string;
  readonly version: string;
  readonly state: unknown;
  readonly slowly: number;
};

parentPort?.on('message', async (request: RunRequest) => {
  const parsedEvent = await serializer.tryDeserialize(request.event);
  if (!parsedEvent.ok) {
    parentPort?.postMessage({ kind: 'refused' });
    return;
  }

  // held open deliberately, so two threads are inside their executors at
  // the same moment rather than merely close to it
  if (request.slowly > 0) {
    await new Promise((resolve) => setTimeout(resolve, request.slowly));
  }

  const version = versions[request.contractType]?.[request.version];
  if (version === undefined) {
    parentPort?.postMessage({ kind: 'refused' });
    return;
  }

  try {
    const response = await version.execute({
      entry: request.entry,
      event: parsedEvent.value,
      state: request.state,
      executionId: request.executionId,
      attempt: request.attempt,
      dependencies: null,
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

    const serializedEvents = await Promise.all(
      response.events.map(async (emittedEvent) => {
        const eventJson = await serializer.trySerialize(emittedEvent);
        return eventJson.ok ? eventJson.value : null;
      }),
    );

    parentPort?.postMessage({
      kind: 'produced',
      state: response.state,
      events: serializedEvents.filter(
        (serializedEvent): serializedEvent is string =>
          serializedEvent !== null,
      ),
    });
  } catch (error_) {
    const fault = error_ as {
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
