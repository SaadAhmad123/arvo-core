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

const handlers = declareThreadedHandlers(workerData?.charges ?? 'succeeds');
const events = new ArvoEventSerializer({ type: 'arvoevent' });

/** Every read waiting on the thread that owns the store. */
const waiting = new Map<number, (row: unknown) => void>();
let asked = 0;

/** What a broker asks this thread to run. */
type Asked = {
  readonly kind: 'run';
  readonly event: string;
  readonly attempt: number;
  readonly slowly: number;
};

/** What the thread owning the store answered a read with. */
type Answered = {
  readonly kind: 'read';
  readonly at: number;
  readonly row: unknown;
};

/** One read of the store, which lives on another thread. */
const readStore = (executionId: string): Promise<unknown> => {
  asked += 1;
  const at = asked;
  return new Promise((answer) => {
    waiting.set(at, answer);
    parentPort?.postMessage({ kind: 'read', at, executionId });
  });
};

parentPort?.on('message', async (said: Asked | Answered) => {
  if (said.kind === 'read') {
    const answer = waiting.get(said.at);
    waiting.delete(said.at);
    answer?.(said.row);
    return;
  }

  const restored = await events.tryDeserialize(said.event);
  if (!restored.ok) {
    parentPort?.postMessage({ kind: 'refused' });
    return;
  }

  const handler = handlers[restored.value.to as string];
  if (handler === undefined) {
    parentPort?.postMessage({ kind: 'refused' });
    return;
  }

  // held open deliberately, so two threads are inside one execution at
  // the same moment rather than merely close to it
  if (said.slowly > 0) {
    await new Promise((settle) => setTimeout(settle, said.slowly));
  }

  try {
    const ran = await handler.execute({
      event: restored.value,
      state: ({ executionId }: { executionId: string }) =>
        readStore(executionId),
      attempt: said.attempt,
    });

    if (ran.kind === 'discarded') {
      parentPort?.postMessage({ kind: 'discarded', reason: ran.reason });
      return;
    }

    const written = await Promise.all(
      ran.events.map(async (leaving: unknown) => {
        const out = await events.trySerialize(leaving as never);
        return out.ok ? out.value : null;
      }),
    );

    parentPort?.postMessage({
      kind: 'produced',
      state: ran.state,
      events: written.filter((one): one is string => one !== null),
    });
  } catch (raised) {
    const fault = raised as {
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
