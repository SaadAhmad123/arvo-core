import { describe, expect, it } from 'vitest';
import type { IArvoOutbox } from '../../src/ArvoOutbox/interface.js';
import type {
  ArvoOutboxCapacity,
  ArvoOutboxCapacityRequest,
} from '../../src/ArvoOutbox/types/capacity.js';
import type {
  ArvoOutboxCommitOutcome,
  ArvoOutboxEventsCommit,
  ArvoOutboxStateCommit,
} from '../../src/ArvoOutbox/types/commit.js';
import type { ArvoOutboxCommittedEventRecord } from '../../src/ArvoOutbox/types/event-record.js';
import type {
  ArvoOutboxEventsFilter,
  ArvoOutboxUnseenEventsParam,
} from '../../src/ArvoOutbox/types/read.js';
import type { JSONObject } from '../../src/types.js';

/**
 * The interface a developer implements, at the type level.
 *
 * Each `@ts-expect-error` is an assertion: if the line stopped being an
 * error, `pnpm typecheck` would fail on the directive itself.
 */

/** Every operation, answering through a promise. */
class AsynchronousOutbox implements IArvoOutbox {
  async readLatestState(_executionId: string): Promise<JSONObject | null> {
    return null;
  }
  async commitStateAndEvents(
    _param: ArvoOutboxStateCommit,
  ): Promise<ArvoOutboxCommitOutcome> {
    return { committed: true };
  }
  async commitEvents(
    _param: ArvoOutboxEventsCommit,
  ): Promise<ArvoOutboxCommitOutcome> {
    return { committed: true };
  }
  async readCommittedEvents(
    _filter: ArvoOutboxEventsFilter,
  ): Promise<readonly ArvoOutboxCommittedEventRecord[]> {
    return [];
  }
  async listUnseenEvents(
    _param: ArvoOutboxUnseenEventsParam,
  ): Promise<readonly ArvoOutboxCommittedEventRecord[]> {
    return [];
  }
  async markEventsSeen(_eventIds: readonly string[]): Promise<void> {}
  async capacity(
    _request: ArvoOutboxCapacityRequest,
  ): Promise<ArvoOutboxCapacity> {
    return { status: 'available', buffers: {} };
  }
  async open(): Promise<void> {}
  async close(): Promise<void> {}
}

/** Every operation, answering directly. */
class SynchronousOutbox implements IArvoOutbox {
  readLatestState(_executionId: string): JSONObject | null {
    return null;
  }
  commitStateAndEvents(_param: ArvoOutboxStateCommit): ArvoOutboxCommitOutcome {
    return { committed: false, refusal: 'state_exists' };
  }
  commitEvents(_param: ArvoOutboxEventsCommit): ArvoOutboxCommitOutcome {
    return { committed: false, refusal: 'capacity_exhausted' };
  }
  readCommittedEvents(
    _filter: ArvoOutboxEventsFilter,
  ): readonly ArvoOutboxCommittedEventRecord[] {
    return [];
  }
  listUnseenEvents(
    _param: ArvoOutboxUnseenEventsParam,
  ): readonly ArvoOutboxCommittedEventRecord[] {
    return [];
  }
  markEventsSeen(_eventIds: readonly string[]): void {}
  capacity(_request: ArvoOutboxCapacityRequest): ArvoOutboxCapacity {
    return {
      status: 'exhausted',
      buffers: { events: { status: 'exhausted' } },
    };
  }
  open(): void {}
  close(): void {}
}

describe('what satisfies the outbox interface', () => {
  it('is every operation, answering through a promise', () => {
    const outbox: IArvoOutbox = new AsynchronousOutbox();
    expect(outbox).toBeInstanceOf(AsynchronousOutbox);
  });

  it('is every operation, answering directly', () => {
    const outbox: IArvoOutbox = new SynchronousOutbox();
    expect(outbox).toBeInstanceOf(SynchronousOutbox);
  });

  it('is not an outbox missing an operation', () => {
    const { markEventsSeen: _dropped, ...withoutMarking } =
      new SynchronousOutbox();
    // @ts-expect-error an outbox offers every operation
    const outbox: IArvoOutbox = {
      ...withoutMarking,
      readLatestState: () => null,
      commitStateAndEvents: () => ({ committed: true as const }),
      commitEvents: () => ({ committed: true as const }),
      capacity: () => ({ status: 'available' as const, buffers: {} }),
      readCommittedEvents: () => [],
      listUnseenEvents: () => [],
      open: () => undefined,
      close: () => undefined,
    };
    expect(outbox).toBeDefined();
  });

  it('is not an outbox that cannot say how much room it has', () => {
    const { capacity: _dropped, ...withoutCapacity } = new SynchronousOutbox();
    // @ts-expect-error an outbox answers how much room it has
    const outbox: IArvoOutbox = withoutCapacity;
    expect(outbox).toBeDefined();
  });

  it('is not an outbox that cannot be opened or closed', () => {
    const { open: _droppedOpen, ...withoutOpening } = new SynchronousOutbox();
    // @ts-expect-error an outbox can be opened
    const unopenable: IArvoOutbox = withoutOpening;
    const { close: _droppedClose, ...withoutClosing } = new SynchronousOutbox();
    // @ts-expect-error an outbox can be closed
    const unclosable: IArvoOutbox = withoutClosing;
    expect([unopenable, unclosable]).toHaveLength(2);
  });

  it('is not an operation answering with the wrong thing', () => {
    class WrongOutbox extends SynchronousOutbox {
      // @ts-expect-error a commit answers with its outcome, not a boolean
      override commitStateAndEvents(_param: ArvoOutboxStateCommit): boolean {
        return true;
      }
    }
    expect(new WrongOutbox()).toBeDefined();
  });

  it('is not a commit of events alone answering nothing', () => {
    class SilentOutbox extends SynchronousOutbox {
      // @ts-expect-error a commit of events alone answers its outcome
      override commitEvents(_param: ArvoOutboxEventsCommit): void {}
    }
    expect(new SilentOutbox()).toBeDefined();
  });
});
