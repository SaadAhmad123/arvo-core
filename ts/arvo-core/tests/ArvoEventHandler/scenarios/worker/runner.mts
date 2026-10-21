import { parentPort, workerData } from 'node:worker_threads';
import { ArvoEventSerializer } from '../../../../dist/serializers/ArvoEventSerializer/index.js';
import { declareThreadedHandlers } from './contracts.ts';

/**
 * One handler, in its own thread.
 *
 * It holds no store and no queue, and — unlike the version's own
 * worker — it is told nothing about the event it is given. What the
 * event is, which execution it concerns and which version owns it are
 * all worked out here, which is the whole point of running a handler
 * rather than a version.
 *
 * Reaching the store is a message to the thread that owns it, which is
 * what a state function is: an operation that takes a key and answers
 * live, however far away the answer lives.
 */

const handlers = declareThreadedHandlers(
  workerData?.charges ?? 'succeeds',
  workerData?.layered === true,
);
const serializer = new ArvoEventSerializer({ type: 'arvoevent' });

/** Every read waiting on the thread that owns the store. */
const pendingReads = new Map<number, (row: unknown) => void>();
let readCount = 0;

/** What a broker asks this thread to run. */
type RunRequest = {
  readonly kind: 'run';
  readonly event: string;
  readonly attempt: number;
  readonly slowly: number;
};

/** What the thread owning the store answered a read with. */
type ReadAnswer = {
  readonly kind: 'read';
  readonly at: number;
  readonly row: unknown;
};

/** One read of the store, which lives on another thread. */
const readStore = (executionId: string): Promise<unknown> => {
  readCount += 1;
  const readId = readCount;
  return new Promise((answer) => {
    pendingReads.set(readId, answer);
    parentPort?.postMessage({ kind: 'read', at: readId, executionId });
  });
};

parentPort?.on('message', async (message: RunRequest | ReadAnswer) => {
  if (message.kind === 'read') {
    const answer = pendingReads.get(message.at);
    pendingReads.delete(message.at);
    answer?.(message.row);
    return;
  }

  const deserialization = await serializer.tryDeserialize(message.event);
  if (!deserialization.ok) {
    parentPort?.postMessage({ kind: 'refused' });
    return;
  }

  const handler = handlers[deserialization.value.to as string];
  if (handler === undefined) {
    parentPort?.postMessage({ kind: 'refused' });
    return;
  }

  // held open deliberately, so two threads are inside one execution at
  // the same moment rather than merely close to it
  if (message.slowly > 0) {
    await new Promise((resolve) => setTimeout(resolve, message.slowly));
  }

  try {
    const outcome = await handler.execute({
      event: deserialization.value,
      state: ({ executionId }: { executionId: string }) =>
        readStore(executionId),
      attempt: message.attempt,
    });

    if (outcome.kind === 'discarded') {
      parentPort?.postMessage({ kind: 'discarded', reason: outcome.reason });
      return;
    }

    const serializedEvents = await Promise.all(
      outcome.events.map(async (outgoingEvent: unknown) => {
        const serialization = await serializer.trySerialize(
          outgoingEvent as never,
        );
        return serialization.ok ? serialization.value : null;
      }),
    );

    parentPort?.postMessage({
      kind: 'produced',
      state: outcome.state,
      events: serializedEvents.filter(
        (serializedEvent): serializedEvent is string =>
          serializedEvent !== null,
      ),
    });
  } catch (thrown) {
    const fault = thrown as {
      faultKind?: string;
      retry?: unknown;
      abandonmentEvent?: string | null;
      abandonmentState?: string | null;
      executionId?: string | null;
      message?: string;
    };
    parentPort?.postMessage({
      kind: 'faulted',
      faultKind: fault.faultKind ?? 'unknown',
      retryable: fault.retry !== null && fault.retry !== undefined,
      abandonmentEvent: fault.abandonmentEvent ?? null,
      abandonmentState: fault.abandonmentState ?? null,
      executionId: fault.executionId ?? null,
      message: fault.message ?? '',
    });
  }
});
