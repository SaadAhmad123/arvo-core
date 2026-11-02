import { expect } from 'vitest';
import type { IArvoOutbox } from '../../../ArvoOutbox/interface.js';
import type {
  ArvoOutboxBufferCapacity,
  ArvoOutboxCapacityStatus,
} from '../../../ArvoOutbox/types/capacity.js';
import { sortedEventIds } from '../fixtures/event-ids.js';
import { buildEventRecord } from '../fixtures/event-record.js';
import { buildStateCommit } from '../fixtures/state-commit.js';
import { freezeCases } from '../helpers/freeze-cases.js';
import type { ArvoOutboxConformanceCase } from '../types.js';

/** Every status a capacity answer may name, worst last. */
const CAPACITY_STATUSES_BY_SEVERITY: readonly ArvoOutboxCapacityStatus[] =
  Object.freeze(['available', 'tolerating', 'exhausted']);

/** What a case asks an outbox's capacity for: a new execution with events, and events alone. */
const CAPACITY_REQUESTS = Object.freeze([
  Object.freeze({ events: 2, state: Object.freeze({ casVersion: 0 }) }),
  Object.freeze({ events: 1 }),
]);

/** The buffers an answer gives, each beside its name. */
const givenBuffers = (buffers: {
  readonly events?: ArvoOutboxBufferCapacity;
  readonly states?: ArvoOutboxBufferCapacity;
}) =>
  Object.entries(buffers).filter(
    (bufferEntry): bufferEntry is [string, ArvoOutboxBufferCapacity] =>
      bufferEntry[1] !== undefined,
  );

/** The outbox's answer to every capacity request a case asks. */
const askEveryCapacityRequest = (outbox: IArvoOutbox) =>
  Promise.all(
    // an outbox may answer directly or through a promise: each is made a promise
    CAPACITY_REQUESTS.map((capacityRequest) =>
      Promise.resolve(outbox.capacity(capacityRequest)),
    ),
  );

/** Everything an outbox holds that a capacity question must leave alone. */
const readEverythingHeld = async (
  outbox: IArvoOutbox,
  executionId: string,
) => ({
  latestState: await outbox.readLatestState(executionId),
  committedEventIds: sortedEventIds(
    await outbox.readCommittedEvents({ executionId }),
  ),
  unseenEventIds: sortedEventIds(
    await outbox.listUnseenEvents({ atMost: 100, olderThanMs: 0 }),
  ),
});

/** An outbox answers how much room it has, and asking changes nothing. */
export const capacityIsAnsweredCases: readonly ArvoOutboxConformanceCase[] =
  freezeCases([
    {
      name: 'answers its capacity with a known status, overall and for each buffer it gives',
      check: async (outbox) => {
        for (const capacity of await askEveryCapacityRequest(outbox)) {
          expect(CAPACITY_STATUSES_BY_SEVERITY).toContain(capacity.status);
          for (const [bufferName, buffer] of givenBuffers(capacity.buffers)) {
            expect(CAPACITY_STATUSES_BY_SEVERITY, bufferName).toContain(
              buffer.status,
            );
            for (const bufferCount of [
              buffer.held,
              buffer.size,
              buffer.limit,
            ]) {
              if (bufferCount === undefined) continue;
              expect(Number.isInteger(bufferCount), bufferName).toBe(true);
              expect(bufferCount, bufferName).toBeGreaterThanOrEqual(0);
            }
          }
        }
      },
    },
    {
      name: 'answers its capacity overall as the worst of its buffers, or available where it gives none',
      check: async (outbox) => {
        for (const capacity of await askEveryCapacityRequest(outbox)) {
          const worstSeverity = Math.max(
            0,
            ...givenBuffers(capacity.buffers).map(([, buffer]) =>
              CAPACITY_STATUSES_BY_SEVERITY.indexOf(buffer.status),
            ),
          );
          expect(capacity.status).toBe(
            CAPACITY_STATUSES_BY_SEVERITY[worstSeverity],
          );
        }
      },
    },
    {
      name: 'changes nothing it holds when asked its capacity',
      check: async (outbox) => {
        const executionId = crypto.randomUUID();
        await outbox.commitStateAndEvents(
          buildStateCommit({
            executionId,
            casVersion: 0,
            events: [
              buildEventRecord({ executionId }),
              buildEventRecord({ executionId }),
            ],
          }),
        );
        const heldBeforeAsking = await readEverythingHeld(outbox, executionId);
        await askEveryCapacityRequest(outbox);
        expect(await readEverythingHeld(outbox, executionId)).toEqual(
          heldBeforeAsking,
        );
      },
    },
    {
      name: 'answers a commit of events alone with whether it committed',
      check: async (outbox) => {
        const outcome = await outbox.commitEvents({
          events: [buildEventRecord()],
        });
        expect([
          { committed: true },
          { committed: false, refusal: 'capacity_exhausted' },
        ]).toContainEqual(outcome);
      },
    },
  ]);
