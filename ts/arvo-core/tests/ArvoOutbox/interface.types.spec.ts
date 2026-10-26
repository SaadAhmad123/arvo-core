import { describe, expect, it } from 'vitest';
import type { IArvoOutbox } from '../../src/ArvoOutbox/interface.js';
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
  async commitEvents(_param: ArvoOutboxEventsCommit): Promise<void> {}
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
}

/** Every operation, answering directly. */
class SynchronousOutbox implements IArvoOutbox {
  readLatestState(_executionId: string): JSONObject | null {
    return null;
  }
  commitStateAndEvents(_param: ArvoOutboxStateCommit): ArvoOutboxCommitOutcome {
    return { committed: false, refusal: 'state_exists' };
  }
  commitEvents(_param: ArvoOutboxEventsCommit): void {}
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
      commitEvents: () => undefined,
      readCommittedEvents: () => [],
      listUnseenEvents: () => [],
    };
    expect(outbox).toBeDefined();
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
});
