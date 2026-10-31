import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  ArvoOutboxBufferCapacity,
  ArvoOutboxCapacity,
  ArvoOutboxCapacityRequest,
  ArvoOutboxCapacityStatus,
} from '../../src/ArvoOutbox/types/capacity.js';
import type {
  ArvoOutboxCommitOutcome,
  ArvoOutboxEventsCommit,
  ArvoOutboxRefusal,
  ArvoOutboxStateCommit,
} from '../../src/ArvoOutbox/types/commit.js';
import type {
  ArvoOutboxCommittedEventRecord,
  ArvoOutboxEventRecord,
} from '../../src/ArvoOutbox/types/event-record.js';
import type {
  ArvoOutboxEventsFilter,
  ArvoOutboxUnseenEventsParam,
} from '../../src/ArvoOutbox/types/read.js';

/**
 * The type level, run so it compiles where the suite does.
 *
 * Each `@ts-expect-error` is an assertion: if the line stopped being an
 * error, `pnpm typecheck` would fail on the directive itself.
 */

const eventRecord: ArvoOutboxEventRecord = {
  id: 'event-1',
  subject: 'subject-1',
  executionId: 'execution-1',
  casVersion: 0,
  parentId: null,
  initId: null,
  triggeringEventId: 'event-0',
  source: 'com_order_create',
  type: 'com_payment_charge',
  to: 'com_payment_charge',
  domain: null,
  time: '2026-01-01T00:00:00.000Z',
  payload: '{}',
};

describe('the filter for reading committed events', () => {
  it('takes one execution, one delivery, or both', () => {
    const byExecution: ArvoOutboxEventsFilter = { executionId: 'e' };
    const byDelivery: ArvoOutboxEventsFilter = { triggeringEventId: 't' };
    const byBoth: ArvoOutboxEventsFilter = {
      executionId: 'e',
      triggeringEventId: 't',
    };
    expect([byExecution, byDelivery, byBoth]).toHaveLength(3);
  });

  it('refuses an empty filter, so everything cannot be asked for by accident', () => {
    // @ts-expect-error a filter names at least one execution or delivery
    const everything: ArvoOutboxEventsFilter = {};
    expect(everything).toEqual({});
  });
});

describe('an event record', () => {
  it('carries no revision where it was committed with no state', () => {
    expectTypeOf<ArvoOutboxEventRecord['casVersion']>().toEqualTypeOf<
      number | null
    >();
  });

  it('is handed back with the two fields the outbox owns', () => {
    expectTypeOf<ArvoOutboxCommittedEventRecord>().toEqualTypeOf<
      ArvoOutboxEventRecord & {
        readonly committedAt: string;
        readonly seen: boolean;
      }
    >();
  });

  it('cannot be changed once built', () => {
    // @ts-expect-error every field of an event record is read-only
    eventRecord.payload = 'changed';
    expect(eventRecord.id).toBe('event-1');
  });
});

describe('a commit', () => {
  it('names a refusal of exactly three kinds', () => {
    expectTypeOf<ArvoOutboxRefusal>().toEqualTypeOf<
      'state_exists' | 'revision_stale' | 'capacity_exhausted'
    >();
  });

  it('narrows its outcome on whether it committed', () => {
    const outcome = { committed: false, refusal: 'revision_stale' } as const;
    const answered: ArvoOutboxCommitOutcome = outcome;
    if (!answered.committed) {
      expectTypeOf(answered.refusal).toEqualTypeOf<ArvoOutboxRefusal>();
    }
    expect(answered.committed).toBe(false);
  });

  it('carries no refusal where it committed', () => {
    const committed: ArvoOutboxCommitOutcome = {
      committed: true,
      // @ts-expect-error a committed outcome names no refusal
      refusal: 'state_exists',
    };
    expect(committed.committed).toBe(true);
  });

  it('carries every field it writes, flat beside the state', () => {
    const commit: ArvoOutboxStateCommit = {
      executionId: 'execution-1',
      casVersion: 0,
      subject: 'subject-1',
      source: 'com_order_create',
      version: '1.0.0',
      lifecycle: 'waiting',
      state: { anything: ['the outbox never opens'] },
      events: [eventRecord],
    };
    // @ts-expect-error every field of a commit is read-only
    commit.casVersion = 1;
    expect(commit.events).toHaveLength(1);
  });

  it('of events alone carries events and nothing else', () => {
    expectTypeOf<keyof ArvoOutboxEventsCommit>().toEqualTypeOf<'events'>();
  });
});

describe('asking how much room an outbox has', () => {
  it('asks with a number of events, and a state where one comes with them', () => {
    const withState: ArvoOutboxCapacityRequest = {
      events: 2,
      state: { casVersion: 3 },
    };
    const eventsAlone: ArvoOutboxCapacityRequest = { events: 1 };
    // @ts-expect-error no state is left out, never null
    const nullState: ArvoOutboxCapacityRequest = { events: 1, state: null };
    expect([withState, eventsAlone, nullState]).toHaveLength(3);
  });

  it('is answered as one of three statuses', () => {
    expectTypeOf<ArvoOutboxCapacityStatus>().toEqualTypeOf<
      'available' | 'tolerating' | 'exhausted'
    >();
  });

  it('is answered overall, with no buffers where the outbox limits nothing', () => {
    const unlimited: ArvoOutboxCapacity = {
      status: 'available',
      buffers: {},
    };
    expect(unlimited.buffers).toEqual({});
  });

  it('is answered per buffer, each number optional', () => {
    const bare: ArvoOutboxBufferCapacity = { status: 'tolerating' };
    const full: ArvoOutboxBufferCapacity = {
      status: 'exhausted',
      held: 12,
      size: 8,
      limit: 10,
    };
    const answer: ArvoOutboxCapacity = {
      status: 'exhausted',
      buffers: { events: full, states: bare },
    };
    // @ts-expect-error an outbox holds events and states, and nothing else
    const unknownBuffer: ArvoOutboxCapacity['buffers'] = { leases: bare };
    expect([answer, unknownBuffer]).toHaveLength(2);
  });

  it('cannot be changed once answered', () => {
    const answer: ArvoOutboxCapacity = { status: 'available', buffers: {} };
    // @ts-expect-error every field of an answer is read-only
    answer.status = 'exhausted';
    expect(answer.buffers).toEqual({});
  });
});

describe('listing unseen events', () => {
  it('takes how many to list, how recent is too recent, and how long to claim them', () => {
    expectTypeOf<ArvoOutboxUnseenEventsParam>().toEqualTypeOf<{
      readonly atMost: number;
      readonly olderThanMs: number;
      readonly leaseMs?: number;
    }>();
  });

  it('claims nothing where no lease is given', () => {
    const param: ArvoOutboxUnseenEventsParam = { atMost: 10, olderThanMs: 0 };
    // @ts-expect-error no lease is left out, never null
    const nullLease: ArvoOutboxUnseenEventsParam = { ...param, leaseMs: null };
    expect(nullLease.atMost).toBe(param.atMost);
  });
});
