import type { ArvoOutboxCapacityStatus } from 'arvo-core';
import { describe, expect, it } from 'vitest';
import {
  buildEvent,
  buildState,
  waitMs,
} from '../../../src/load/harness/builders.js';
import {
  inMemorySubject,
  type OpenedSubject,
} from '../../../src/load/harness/subjects.js';
import { runOrders } from '../shared/lattice-check.js';

/** Commits one event alone, answering whether the outbox took it. */
const commitOneEvent = async (opened: OpenedSubject) => {
  const executionId = crypto.randomUUID();
  return opened.driver.tryCommitEvents({
    events: [buildEvent({ executionId, dataBytes: 32 })],
    triggeringEvent: buildEvent({ executionId, dataBytes: 16 }),
  });
};

/** The events buffer's status and what it holds, asking about nothing more. */
const eventsBuffer = async (opened: OpenedSubject) => {
  const capacity = await opened.outbox.capacity({ events: 0 });
  return {
    status: capacity.buffers.events?.status ?? capacity.status,
    held: capacity.buffers.events?.held ?? 0,
  };
};

/** Marks every unseen event seen, so the sweep may delete them. */
const markEverythingSeen = async (opened: OpenedSubject, atMost: number) => {
  const entries = await opened.driver.listUnseenEvents({
    atMost,
    olderThanMs: 0,
    restoreEvents: false,
  });
  await opened.driver.markEventsSeen({
    eventIds: entries.map((entry) => entry.record.id),
  });
};

describe('inmemory: filling up and recovering', () => {
  it('is available to its size, tolerating to its limit, refuses at the limit and never holds past it', async () => {
    const opened = await inMemorySubject.open({
      inmemory: {
        buffers: { events: { size: 100, tolerance: 0.2 } },
        retentionMs: { seenEvents: 0 },
      },
    });
    try {
      const statuses: ArvoOutboxCapacityStatus[] = [];
      let refusedCount = 0;
      for (let attempt = 0; attempt < 150; attempt += 1) {
        const committed = await commitOneEvent(opened);
        if (!committed.ok) {
          expect(committed.error.kind).toBe('capacity_exhausted');
          refusedCount += 1;
        }
        const buffer = await eventsBuffer(opened);
        expect(buffer.held).toBeLessThanOrEqual(120);
        statuses.push(buffer.status);
      }
      expect(refusedCount).toBe(30);
      expect(
        statuses.slice(0, 100).every((status) => status === 'available'),
      ).toBe(true);
      expect(
        statuses.slice(100).every((status) => status === 'tolerating'),
      ).toBe(true);
    } finally {
      await opened.close();
    }
  });

  it('stays tolerating until drained well below its size, without flapping, then takes refused work', async () => {
    const opened = await inMemorySubject.open({
      inmemory: {
        buffers: { events: { size: 100, tolerance: 0.2 } },
        retentionMs: { seenEvents: 0 },
      },
    });
    try {
      for (let attempt = 0; attempt < 120; attempt += 1)
        await commitOneEvent(opened);
      expect((await commitOneEvent(opened)).ok).toBe(false);
      // drain to 90: below the size, above where it stops tolerating
      await markEverythingSeen(opened, 30);
      await waitMs(1300);
      expect(await eventsBuffer(opened)).toEqual({
        status: 'tolerating',
        held: 90,
      });
      // drain to 75: past where it stops tolerating
      await markEverythingSeen(opened, 15);
      await waitMs(1300);
      expect(await eventsBuffer(opened)).toEqual({
        status: 'available',
        held: 75,
      });
      expect((await commitOneEvent(opened)).ok).toBe(true);
    } finally {
      await opened.close();
    }
  });

  it('never tolerates with no tolerance, and doubles its size with full tolerance', async () => {
    for (const buffer of [
      { tolerance: 0, limit: 10, toleratingSeen: false },
      { tolerance: 1, limit: 20, toleratingSeen: true },
    ]) {
      const opened = await inMemorySubject.open({
        inmemory: {
          buffers: { events: { size: 10, tolerance: buffer.tolerance } },
        },
      });
      try {
        let committedCount = 0;
        let toleratingSeen = false;
        for (let attempt = 0; attempt < 30; attempt += 1) {
          if ((await commitOneEvent(opened)).ok) committedCount += 1;
          if ((await eventsBuffer(opened)).status === 'tolerating')
            toleratingSeen = true;
        }
        expect(committedCount).toBe(buffer.limit);
        expect(toleratingSeen).toBe(buffer.toleratingSeen);
      } finally {
        await opened.close();
      }
    }
  });

  it('holds one event at a size of one, and answers available far from a limit of millions', async () => {
    const small = await inMemorySubject.open({
      inmemory: { buffers: { events: { size: 1, tolerance: 0 } } },
    });
    try {
      expect((await commitOneEvent(small)).ok).toBe(true);
      expect((await commitOneEvent(small)).ok).toBe(false);
    } finally {
      await small.close();
    }
    const large = await inMemorySubject.open({
      inmemory: { buffers: { events: { size: 5_000_000, tolerance: 0.1 } } },
    });
    try {
      for (let attempt = 0; attempt < 100; attempt += 1)
        await commitOneEvent(large);
      expect(await eventsBuffer(large)).toEqual({
        status: 'available',
        held: 100,
      });
    } finally {
      await large.close();
    }
  });

  it('refuses a new execution at the states limit, and still takes a later revision of one it holds', async () => {
    const opened = await inMemorySubject.open({
      inmemory: { buffers: { states: { size: 10, tolerance: 0 } } },
    });
    try {
      const executionIds = Array.from({ length: 10 }, () =>
        crypto.randomUUID(),
      );
      for (const executionId of executionIds) {
        const committed = await opened.driver.tryCommitStateAndEvents({
          state: buildState({ executionId, casVersion: 0 }),
          events: [],
          triggeringEvent: buildEvent({ executionId, dataBytes: 16 }),
        });
        expect(committed.ok).toBe(true);
      }
      const newExecutionId = crypto.randomUUID();
      const refused = await opened.driver.tryCommitStateAndEvents({
        state: buildState({ executionId: newExecutionId, casVersion: 0 }),
        events: [],
        triggeringEvent: buildEvent({
          executionId: newExecutionId,
          dataBytes: 16,
        }),
      });
      expect(!refused.ok && refused.error.kind).toBe('capacity_exhausted');
      const [heldExecutionId = ''] = executionIds;
      const laterRevision = await opened.driver.tryCommitStateAndEvents({
        state: buildState({ executionId: heldExecutionId, casVersion: 1 }),
        events: [],
        triggeringEvent: buildEvent({
          executionId: heldExecutionId,
          dataBytes: 16,
        }),
      });
      expect(laterRevision.ok).toBe(true);
    } finally {
      await opened.close();
    }
  });

  it('runs orders to the end under pressure, pausing and refusing, losing nothing', async () => {
    const opened = await inMemorySubject.open({
      inmemory: {
        buffers: {
          events: { size: 150, tolerance: 0.2 },
          states: { size: 1000, tolerance: 0.2 },
        },
        retentionMs: { seenEvents: 0, terminalStates: 60_000 },
      },
    });
    try {
      const outcome = await runOrders({
        subject: opened,
        orderCount: 20,
        width: 10,
        depth: 2,
        workerCount: 8,
        sweeper: { intervalMs: 20, olderThanMs: 0, atMost: 200, leaseMs: 5000 },
      });
      const pressured =
        outcome.pausedForRoom +
        (outcome.refusalsByKind.capacity_exhausted ?? 0);
      expect(pressured).toBeGreaterThan(0);
    } finally {
      await opened.close();
    }
  });
});
