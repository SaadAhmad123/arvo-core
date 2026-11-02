import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IArvoOutbox } from '../../src/ArvoOutbox/interface.js';
import type { ArvoOutboxCapacity } from '../../src/ArvoOutbox/types/capacity.js';
import {
  ArvoOutboxDriverError,
  ArvoOutboxDriverValidationError,
} from '../../src/ArvoOutboxDriver/errors.js';
import { ArvoOutboxDriver } from '../../src/ArvoOutboxDriver/index.js';
import { createArvoEvent } from '../../src/factories/createArvoEvent.js';
import { ArvoMemoryOutbox } from '../../src/outbox/inmemory/index.js';
import { ArvoEventSerializer } from '../../src/serializers/ArvoEventSerializer/index.js';
import type { JSONObject } from '../../src/types.js';
import {
  recordingProvider,
  unregisterProviders,
} from '../recording-provider.js';
import {
  registerAsyncContextManager,
  unregisterAsyncContextManager,
  withActiveSpan,
} from './async-context.js';

/** One call the driver made on its outbox. */
type OutboxCall = {
  readonly operationName: string;
  readonly argument: unknown;
};

/** What an outbox that limits nothing answers its capacity with. */
const unlimitedCapacity: ArvoOutboxCapacity = Object.freeze({
  status: 'available',
  buffers: Object.freeze({}),
});

/**
 * A working in-memory outbox that writes down every call made on it, with
 * some operations replaced where a test needs the outbox to answer wrongly.
 * Its capacity answers as one that limits nothing, and a commit of events
 * alone answers committed, until the in-memory outbox does both itself.
 */
const createRecordingOutbox = (
  replaceOperations: (
    workingOutbox: ArvoMemoryOutbox,
  ) => Partial<IArvoOutbox> = () => ({}),
) => {
  const workingOutbox = new ArvoMemoryOutbox();
  const outboxCalls: OutboxCall[] = [];
  const replacedOperations = replaceOperations(workingOutbox);
  const recordCall = <Answer>(
    operationName: string,
    argument: unknown,
    answer: () => Answer,
  ) => {
    outboxCalls.push({ operationName, argument });
    return answer();
  };
  const outbox: IArvoOutbox = {
    open: () =>
      recordCall('open', undefined, () =>
        (replacedOperations.open ?? (() => workingOutbox.open()))(),
      ),
    close: () =>
      recordCall('close', undefined, () =>
        (replacedOperations.close ?? (() => workingOutbox.close()))(),
      ),
    readLatestState: (executionId) =>
      recordCall('readLatestState', executionId, () =>
        (
          replacedOperations.readLatestState ??
          ((id) => workingOutbox.readLatestState(id))
        )(executionId),
      ),
    commitStateAndEvents: (param) =>
      recordCall('commitStateAndEvents', param, () =>
        (
          replacedOperations.commitStateAndEvents ??
          ((commit) => workingOutbox.commitStateAndEvents(commit))
        )(param),
      ),
    commitEvents: (param) =>
      recordCall('commitEvents', param, () =>
        (
          replacedOperations.commitEvents ??
          ((commit) => {
            workingOutbox.commitEvents(commit);
            return { committed: true };
          })
        )(param),
      ),
    readCommittedEvents: (filter) =>
      recordCall('readCommittedEvents', filter, () =>
        (
          replacedOperations.readCommittedEvents ??
          ((given) => workingOutbox.readCommittedEvents(given))
        )(filter),
      ),
    listUnseenEvents: (param) =>
      recordCall('listUnseenEvents', param, () =>
        (
          replacedOperations.listUnseenEvents ??
          ((given) => workingOutbox.listUnseenEvents(given))
        )(param),
      ),
    markEventsSeen: (eventIds) =>
      recordCall('markEventsSeen', eventIds, () =>
        (
          replacedOperations.markEventsSeen ??
          ((given) => workingOutbox.markEventsSeen(given))
        )(eventIds),
      ),
    capacity: (request) =>
      recordCall('capacity', request, () =>
        (replacedOperations.capacity ?? (() => unlimitedCapacity))(request),
      ),
  };
  return { outbox, outboxCalls, workingOutbox };
};

/** A driver over a recording outbox, opened. */
const openDriver = async (
  replaceOperations?: (workingOutbox: ArvoMemoryOutbox) => Partial<IArvoOutbox>,
) => {
  const recordingOutbox = createRecordingOutbox(replaceOperations);
  const driver = new ArvoOutboxDriver({ outbox: recordingOutbox.outbox });
  await driver.open();
  recordingOutbox.outboxCalls.length = 0;
  return { driver, ...recordingOutbox };
};

/** A live root event of one execution, whose subject is therefore its execution. */
const buildEvent = (executionid: string) =>
  createArvoEvent({
    type: 'com_payment_charge',
    source: 'com_order_create',
    subject: executionid,
    executionid,
    dataschema: '#/com/payment/charge/1.0.0',
    data: { amount: 10 },
  });

/** A record the handler produced, at a revision. */
const buildRecord = (executionId: string, casVersion: number): JSONObject => ({
  executionId,
  casVersion,
  subject: 'subject-1',
  source: 'com_order_create',
  version: '1.0.0',
  lifecycle: 'waiting',
  data: { step: casVersion },
});

/** The delivered event the commit's events answer. */
const triggeringEvent = buildEvent('execution-0');

/** The argument of the one call the driver made on its outbox for an operation. */
const argumentOfCall = (
  outboxCalls: readonly OutboxCall[],
  operationName: string,
): unknown =>
  outboxCalls.find((outboxCall) => outboxCall.operationName === operationName)
    ?.argument;

/** What an outbox past the most it should ever hold answers. */
const exhaustedCapacity: ArvoOutboxCapacity = Object.freeze({
  status: 'exhausted',
  buffers: Object.freeze({
    events: Object.freeze({ status: 'exhausted', held: 11, limit: 10 }),
  }),
});

const serializer = new ArvoEventSerializer({ type: 'cloudevent' });

describe('ArvoOutboxDriver on the way in', () => {
  it('lifts the commit fields off the record and passes the record whole', async () => {
    const { driver, outboxCalls } = await openDriver();
    const executionId = crypto.randomUUID();
    const record = buildRecord(executionId, 0);
    await driver.commitStateAndEvents({
      state: record,
      events: [],
      triggeringEvent,
    });
    expect(outboxCalls).toEqual([
      {
        operationName: 'capacity',
        argument: { events: 0, state: { casVersion: 0 } },
      },
      {
        operationName: 'commitStateAndEvents',
        argument: {
          executionId,
          casVersion: 0,
          subject: 'subject-1',
          source: 'com_order_create',
          version: '1.0.0',
          lifecycle: 'waiting',
          state: record,
          events: [],
        },
      },
    ]);
  });

  it("builds each event record from the event, the delivery and the record's revision", async () => {
    const { driver, outboxCalls } = await openDriver();
    const executionId = crypto.randomUUID();
    const event = buildEvent(executionId);
    await driver.commitStateAndEvents({
      state: buildRecord(executionId, 0),
      events: [event],
      triggeringEvent,
    });
    expect(argumentOfCall(outboxCalls, 'commitStateAndEvents')).toMatchObject({
      events: [
        {
          id: event.id,
          executionId,
          casVersion: 0,
          triggeringEventId: triggeringEvent.id,
          payload: await serializer.serialize(event),
        },
      ],
    });
  });

  it('commits events alone with no revision', async () => {
    const { driver, outboxCalls } = await openDriver();
    await driver.commitEvents({
      events: [buildEvent('execution-1')],
      triggeringEvent,
    });
    expect(argumentOfCall(outboxCalls, 'commitEvents')).toMatchObject({
      events: [{ casVersion: null }],
    });
  });

  it('passes every event on, duplicates included, for the outbox to decide', async () => {
    const { driver, outboxCalls } = await openDriver();
    const event = buildEvent('execution-1');
    await driver.commitEvents({ events: [event, event], triggeringEvent });
    expect(argumentOfCall(outboxCalls, 'commitEvents')).toMatchObject({
      events: [{ id: event.id }, { id: event.id }],
    });
  });

  it('throws a validation error for a record missing a field, calling no outbox', async () => {
    const { driver, outboxCalls } = await openDriver();
    const { casVersion: _casVersion, ...withoutRevision } = buildRecord(
      'execution-1',
      0,
    );
    const param = { state: withoutRevision, events: [], triggeringEvent };
    await expect(driver.tryCommitStateAndEvents(param)).rejects.toThrow(
      ArvoOutboxDriverValidationError,
    );
    await expect(driver.commitStateAndEvents(param)).rejects.toThrow(
      ArvoOutboxDriverValidationError,
    );
    expect(outboxCalls).toEqual([]);
  });
});

describe('ArvoOutboxDriver on the way out', () => {
  it('reads the latest state, or none', async () => {
    const { driver } = await openDriver();
    const executionId = crypto.randomUUID();
    expect(await driver.readLatestState({ executionId })).toBeNull();
    await driver.commitStateAndEvents({
      state: buildRecord(executionId, 0),
      events: [],
      triggeringEvent,
    });
    expect(await driver.readLatestState({ executionId })).toEqual(
      buildRecord(executionId, 0),
    );
  });

  it('restores each committed event by default, beside its record', async () => {
    const { driver } = await openDriver();
    const executionId = crypto.randomUUID();
    const event = buildEvent(executionId);
    await driver.commitEvents({ events: [event], triggeringEvent });
    const [entry] = await driver.readCommittedEvents({
      filter: { executionId },
    });
    expect(entry?.record.id).toBe(event.id);
    expect(entry?.event && (await serializer.serialize(entry.event))).toBe(
      await serializer.serialize(event),
    );
  });

  it('answers records alone where restoring is turned off', async () => {
    const { driver } = await openDriver();
    const executionId = crypto.randomUUID();
    await driver.commitEvents({
      events: [buildEvent(executionId)],
      triggeringEvent,
    });
    const entries = await driver.listUnseenEvents({
      atMost: 10,
      olderThanMs: 0,
      restoreEvents: false,
    });
    expect(entries.map((entry) => entry.event)).toEqual([null]);
  });

  it('passes how many, how old and how long to lease through to the outbox', async () => {
    const { driver, outboxCalls } = await openDriver();
    await driver.listUnseenEvents({
      atMost: 5,
      olderThanMs: 100,
      leaseMs: 1000,
    });
    await driver.listUnseenEvents({ atMost: 5, olderThanMs: 100 });
    expect(outboxCalls.map((outboxCall) => outboxCall.argument)).toEqual([
      { atMost: 5, olderThanMs: 100, leaseMs: 1000 },
      { atMost: 5, olderThanMs: 100 },
    ]);
  });

  it('marks events seen', async () => {
    const { driver } = await openDriver();
    const event = buildEvent('execution-1');
    await driver.commitEvents({ events: [event], triggeringEvent });
    await driver.markEventsSeen({ eventIds: [event.id] });
    expect(
      await driver.listUnseenEvents({ atMost: 10, olderThanMs: 0 }),
    ).toEqual([]);
  });
});

describe('ArvoOutboxDriver and what it reports', () => {
  /** A driver call for each operation, each made the way a caller would. */
  const everyOperation = (driver: ArvoOutboxDriver) => ({
    open: () => driver.tryOpen(),
    close: () => driver.tryClose(),
    readLatestState: () =>
      driver.tryReadLatestState({ executionId: 'execution-1' }),
    commitStateAndEvents: () =>
      driver.tryCommitStateAndEvents({
        state: buildRecord('execution-1', 0),
        events: [],
        triggeringEvent,
      }),
    commitEvents: () => driver.tryCommitEvents({ events: [], triggeringEvent }),
    readCommittedEvents: () =>
      driver.tryReadCommittedEvents({ filter: { executionId: 'execution-1' } }),
    listUnseenEvents: () =>
      driver.tryListUnseenEvents({ atMost: 10, olderThanMs: 0 }),
    markEventsSeen: () => driver.tryMarkEventsSeen({ eventIds: [] }),
    capacity: () => driver.tryCapacity(),
  });

  const operationNames = [
    'open',
    'close',
    'readLatestState',
    'commitStateAndEvents',
    'commitEvents',
    'readCommittedEvents',
    'listUnseenEvents',
    'markEventsSeen',
    'capacity',
  ] as const;

  it.each(operationNames)(
    'reports %s as unavailable where the outbox throws',
    async (operationName) => {
      const storageFailure = new Error('the database is down');
      const failingOperation = () => {
        throw storageFailure;
      };
      const { outbox } = createRecordingOutbox(() => ({
        [operationName]: failingOperation,
      }));
      const driver = new ArvoOutboxDriver({ outbox });
      if (operationName !== 'open') await driver.open();
      const operationResult = await everyOperation(driver)[operationName]();
      expect(!operationResult.ok && operationResult.error.kind).toBe(
        'unavailable',
      );
      expect(!operationResult.ok && operationResult.error.operationName).toBe(
        operationName,
      );
      expect(!operationResult.ok && operationResult.error.cause).toBe(
        storageFailure,
      );
    },
  );

  it('reports an outbox that rejects, not only one that throws, as unavailable', async () => {
    const { driver } = await openDriver(() => ({
      readLatestState: async () => {
        throw new Error('the database is down');
      },
    }));
    const stateResult = await driver.tryReadLatestState({
      executionId: 'execution-1',
    });
    expect(!stateResult.ok && stateResult.error.kind).toBe('unavailable');
  });

  it('reports a state that is not a JSON object as malformed_state', async () => {
    const { driver } = await openDriver(() => ({
      // deliberately not an object, as an outbox written without types could answer
      readLatestState: () => JSON.parse('[]'),
    }));
    const stateResult = await driver.tryReadLatestState({
      executionId: 'execution-1',
    });
    expect(!stateResult.ok && stateResult.error.kind).toBe('malformed_state');
  });

  it.each(['state_exists', 'revision_stale', 'capacity_exhausted'] as const)(
    'reports a commit refused as %s',
    async (refusal) => {
      const { driver } = await openDriver(() => ({
        commitStateAndEvents: () => ({ committed: false, refusal }),
      }));
      const commitResult = await everyOperation(driver).commitStateAndEvents();
      expect(!commitResult.ok && commitResult.error.kind).toBe(refusal);
    },
  );

  it('reports a refusal the outbox itself made, from a lost race', async () => {
    const { driver } = await openDriver();
    const executionId = crypto.randomUUID();
    await driver.commitStateAndEvents({
      state: buildRecord(executionId, 0),
      events: [],
      triggeringEvent,
    });
    const repeatedFirstCommitResult = await driver.tryCommitStateAndEvents({
      state: buildRecord(executionId, 0),
      events: [],
      triggeringEvent,
    });
    expect(
      !repeatedFirstCommitResult.ok && repeatedFirstCommitResult.error.kind,
    ).toBe('state_exists');
  });

  it('reports a commit of events alone refused for lack of room, with no capacity answer', async () => {
    const { driver } = await openDriver(() => ({
      commitEvents: () => ({ committed: false, refusal: 'capacity_exhausted' }),
    }));
    const commitResult = await everyOperation(driver).commitEvents();
    expect(!commitResult.ok && commitResult.error.kind).toBe(
      'capacity_exhausted',
    );
    expect(!commitResult.ok && commitResult.error.capacity).toBeNull();
  });

  it('reports a commit of events alone answered with nothing as malformed_response', async () => {
    const { driver } = await openDriver(() => ({
      // deliberately no outcome, as an outbox written before it had one answers
      commitEvents: () => JSON.parse('null'),
    }));
    const commitResult = await everyOperation(driver).commitEvents();
    expect(!commitResult.ok && commitResult.error.kind).toBe(
      'malformed_response',
    );
  });

  it('reports a commit answered with no outcome as malformed_response', async () => {
    const { driver } = await openDriver(() => ({
      // deliberately not an outcome, as an outbox written without types could answer
      commitStateAndEvents: () => JSON.parse('{}'),
    }));
    const commitResult = await everyOperation(driver).commitStateAndEvents();
    expect(!commitResult.ok && commitResult.error.kind).toBe(
      'malformed_response',
    );
  });

  it.each(['readCommittedEvents', 'listUnseenEvents'] as const)(
    'reports %s answered with no list as malformed_response',
    async (operationName) => {
      const { driver } = await openDriver(() => ({
        // deliberately not a list, as an outbox written without types could answer
        [operationName]: () => JSON.parse('"records"'),
      }));
      const readResult = await everyOperation(driver)[operationName]();
      expect(!readResult.ok && readResult.error.kind).toBe(
        'malformed_response',
      );
    },
  );

  it.each(['readCommittedEvents', 'listUnseenEvents'] as const)(
    'reports %s answering a record missing a field as malformed_event',
    async (operationName) => {
      const { driver } = await openDriver(() => ({
        // deliberately missing a field, as an outbox written without types could answer
        [operationName]: () => JSON.parse('[{ "id": "event-1" }]'),
      }));
      const readResult = await everyOperation(driver)[operationName]();
      expect(!readResult.ok && readResult.error.kind).toBe('malformed_event');
    },
  );

  it('reports a payload that will not restore as malformed_event, and not where restoring is off', async () => {
    const commitUnrestorableRecord = (workingOutbox: ArvoMemoryOutbox) => {
      const executionId = crypto.randomUUID();
      workingOutbox.commitEvents({
        events: [
          {
            id: 'event-1',
            subject: 'subject-1',
            executionId,
            casVersion: null,
            parentId: null,
            initId: null,
            triggeringEventId: 'triggering-1',
            source: 'com_order_create',
            type: 'com_payment_charge',
            to: null,
            domain: null,
            time: new Date().toISOString(),
            payload: 'not json {',
          },
        ],
      });
      return executionId;
    };
    const { driver, workingOutbox } = await openDriver();
    const executionId = commitUnrestorableRecord(workingOutbox);
    const restoredResult = await driver.tryReadCommittedEvents({
      filter: { executionId },
    });
    expect(!restoredResult.ok && restoredResult.error.kind).toBe(
      'malformed_event',
    );
    expect(
      !restoredResult.ok &&
        restoredResult.error.issues.map((issue) => issue.path),
    ).toEqual(['records[0].payload']);
    const storedResult = await driver.tryReadCommittedEvents({
      filter: { executionId },
      restoreEvents: false,
    });
    expect(
      storedResult.ok &&
        storedResult.value.map((entry) => entry.record.payload),
    ).toEqual(['not json {']);
  });

  it.each(operationNames)(
    'throws from %s exactly the error its value-answering form answers',
    async (operationName) => {
      const failingOperation = () => {
        throw new Error('the database is down');
      };
      const { outbox } = createRecordingOutbox(() => ({
        [operationName]: failingOperation,
      }));
      const driver = new ArvoOutboxDriver({ outbox });
      if (operationName !== 'open') await driver.open();
      const throwingCall = {
        open: () => driver.open(),
        close: () => driver.close(),
        readLatestState: () =>
          driver.readLatestState({ executionId: 'execution-1' }),
        commitStateAndEvents: () =>
          driver.commitStateAndEvents({
            state: buildRecord('execution-1', 0),
            events: [],
            triggeringEvent,
          }),
        commitEvents: () =>
          driver.commitEvents({ events: [], triggeringEvent }),
        readCommittedEvents: () =>
          driver.readCommittedEvents({
            filter: { executionId: 'execution-1' },
          }),
        listUnseenEvents: () =>
          driver.listUnseenEvents({ atMost: 10, olderThanMs: 0 }),
        markEventsSeen: () => driver.markEventsSeen({ eventIds: [] }),
        capacity: () => driver.capacity(),
      }[operationName];
      const rejection = await throwingCall().then(
        () => undefined,
        (error_: unknown) => error_,
      );
      expect(rejection).toBeInstanceOf(ArvoOutboxDriverError);
      expect(rejection instanceof ArvoOutboxDriverError && rejection.kind).toBe(
        'unavailable',
      );
    },
  );
});

describe('ArvoOutboxDriver and the decisions it leaves alone', () => {
  it('asks its capacity once and commits once, even for a refusal', async () => {
    const { driver, outboxCalls } = await openDriver(() => ({
      commitStateAndEvents: () => ({
        committed: false,
        refusal: 'revision_stale',
      }),
    }));
    await driver.tryCommitStateAndEvents({
      state: buildRecord('execution-1', 1),
      events: [],
      triggeringEvent,
    });
    expect(outboxCalls.map((outboxCall) => outboxCall.operationName)).toEqual([
      'capacity',
      'commitStateAndEvents',
    ]);
  });

  it('forwards opening and closing to its outbox', async () => {
    const { outbox, outboxCalls, workingOutbox } = createRecordingOutbox();
    const driver = new ArvoOutboxDriver({ outbox });
    await driver.open();
    expect(workingOutbox.readLatestState('execution-1')).toBeNull();
    await driver.close();
    expect(() => workingOutbox.readLatestState('execution-1')).toThrow(
      'closed',
    );
    expect(outboxCalls.map((outboxCall) => outboxCall.operationName)).toEqual([
      'open',
      'close',
    ]);
  });
});

describe('ArvoOutboxDriver and capacity', () => {
  it('asks for a commit with a record with its event count and revision', async () => {
    const { driver, outboxCalls } = await openDriver();
    await driver.capacity({
      state: buildRecord('execution-1', 4),
      events: [buildEvent('execution-1'), buildEvent('execution-1')],
      triggeringEvent,
    });
    expect(outboxCalls).toEqual([
      {
        operationName: 'capacity',
        argument: { events: 2, state: { casVersion: 4 } },
      },
    ]);
  });

  it('asks for events alone with their count and no state', async () => {
    const { driver, outboxCalls } = await openDriver();
    await driver.capacity({
      events: [buildEvent('execution-1')],
      triggeringEvent,
    });
    expect(argumentOfCall(outboxCalls, 'capacity')).toEqual({ events: 1 });
  });

  it('asks, given nothing, for one event and a state at the first revision', async () => {
    const { driver, outboxCalls } = await openDriver();
    await driver.capacity();
    expect(argumentOfCall(outboxCalls, 'capacity')).toEqual({
      events: 1,
      state: { casVersion: 0 },
    });
  });

  it('hands back the answer as given, exhausted included, which is no error', async () => {
    const { driver } = await openDriver(() => ({
      capacity: () => exhaustedCapacity,
    }));
    expect(await driver.tryCapacity()).toEqual({
      ok: true,
      value: exhaustedCapacity,
    });
  });

  it('reports an answer of the wrong shape as malformed_response', async () => {
    const { driver } = await openDriver(() => ({
      // deliberately a status of no known kind, as an outbox written without types could answer
      capacity: () => JSON.parse('{ "status": "full", "buffers": {} }'),
    }));
    const capacityResult = await driver.tryCapacity();
    expect(!capacityResult.ok && capacityResult.error.kind).toBe(
      'malformed_response',
    );
    expect(
      !capacityResult.ok &&
        capacityResult.error.issues.map((issue) => issue.path),
    ).toEqual(['capacity.status']);
  });

  it('throws a validation error for a record missing a field, calling no outbox', async () => {
    const { driver, outboxCalls } = await openDriver();
    const { casVersion: _casVersion, ...withoutRevision } = buildRecord(
      'execution-1',
      0,
    );
    await expect(
      driver.tryCapacity({
        state: withoutRevision,
        events: [],
        triggeringEvent,
      }),
    ).rejects.toThrow(ArvoOutboxDriverValidationError);
    expect(outboxCalls).toEqual([]);
  });
});

describe('ArvoOutboxDriver asking its capacity before each commit', () => {
  /** Both commits, each of one event, made the way a caller would. */
  const everyCommit = (driver: ArvoOutboxDriver) => ({
    commitStateAndEvents: () =>
      driver.tryCommitStateAndEvents({
        state: buildRecord('execution-1', 2),
        events: [buildEvent('execution-1')],
        triggeringEvent,
      }),
    commitEvents: () =>
      driver.tryCommitEvents({
        events: [buildEvent('execution-1')],
        triggeringEvent,
      }),
  });

  it.each([
    ['commitStateAndEvents', { events: 1, state: { casVersion: 2 } }],
    ['commitEvents', { events: 1 }],
  ] as const)(
    'asks before %s for exactly what it commits',
    async (operationName, capacityRequest) => {
      const { driver, outboxCalls } = await openDriver(() => ({
        commitStateAndEvents: () => ({ committed: true }),
      }));
      await everyCommit(driver)[operationName]();
      expect(outboxCalls.map((outboxCall) => outboxCall.operationName)).toEqual(
        ['capacity', operationName],
      );
      expect(argumentOfCall(outboxCalls, 'capacity')).toEqual(capacityRequest);
    },
  );

  it.each(['commitStateAndEvents', 'commitEvents'] as const)(
    'reports %s capacity_exhausted with the answer, and does not commit, where the outbox is exhausted',
    async (operationName) => {
      const { driver, outboxCalls } = await openDriver(() => ({
        capacity: () => exhaustedCapacity,
      }));
      const commitResult = await everyCommit(driver)[operationName]();
      expect(!commitResult.ok && commitResult.error.kind).toBe(
        'capacity_exhausted',
      );
      expect(!commitResult.ok && commitResult.error.operationName).toBe(
        operationName,
      );
      expect(!commitResult.ok && commitResult.error.capacity).toEqual(
        exhaustedCapacity,
      );
      expect(outboxCalls.map((outboxCall) => outboxCall.operationName)).toEqual(
        ['capacity'],
      );
    },
  );

  it.each(['commitStateAndEvents', 'commitEvents'] as const)(
    'commits %s where the outbox is tolerating',
    async (operationName) => {
      const { driver } = await openDriver(() => ({
        capacity: () => ({ status: 'tolerating', buffers: {} }),
        commitStateAndEvents: () => ({ committed: true }),
      }));
      expect(await everyCommit(driver)[operationName]()).toEqual({
        ok: true,
        value: undefined,
      });
    },
  );

  it.each(['commitStateAndEvents', 'commitEvents'] as const)(
    'reports %s unavailable, and does not commit, where the question throws',
    async (operationName) => {
      const storageFailure = new Error('the database is down');
      const { driver, outboxCalls } = await openDriver(() => ({
        capacity: () => {
          throw storageFailure;
        },
      }));
      const commitResult = await everyCommit(driver)[operationName]();
      expect(!commitResult.ok && commitResult.error.kind).toBe('unavailable');
      expect(!commitResult.ok && commitResult.error.operationName).toBe(
        operationName,
      );
      expect(!commitResult.ok && commitResult.error.cause).toBe(storageFailure);
      expect(outboxCalls.map((outboxCall) => outboxCall.operationName)).toEqual(
        ['capacity'],
      );
    },
  );

  it.each(['commitStateAndEvents', 'commitEvents'] as const)(
    'reports %s malformed_response, and does not commit, where the answer is of the wrong shape',
    async (operationName) => {
      const { driver, outboxCalls } = await openDriver(() => ({
        // deliberately no answer, as an outbox written without types could give
        capacity: () => JSON.parse('null'),
      }));
      const commitResult = await everyCommit(driver)[operationName]();
      expect(!commitResult.ok && commitResult.error.kind).toBe(
        'malformed_response',
      );
      expect(outboxCalls.map((outboxCall) => outboxCall.operationName)).toEqual(
        ['capacity'],
      );
    },
  );
});

describe('ArvoOutboxDriver and its spans', () => {
  beforeEach(() => registerAsyncContextManager());
  afterEach(() => {
    unregisterAsyncContextManager();
    unregisterProviders();
  });

  it('makes its span a child of the span it is given, rather than the active one', async () => {
    const { tracer, finishedSpans } = recordingProvider();
    const { driver } = await openDriver();
    const activeSpan = tracer.startSpan('what happens to be active');
    const givenSpan = tracer.startSpan('the parent the caller names');
    await withActiveSpan(activeSpan, () =>
      driver.markEventsSeen({
        eventIds: [],
        telemetry: { tracer },
        span: givenSpan,
      }),
    );
    const driverSpan = finishedSpans().find(
      (span) => span.name === 'arvo.outbox_driver.markEventsSeen',
    );
    expect(driverSpan?.parentSpanContext?.spanId).toBe(
      givenSpan.spanContext().spanId,
    );
    expect(driverSpan?.spanContext().traceId).toBe(
      givenSpan.spanContext().traceId,
    );
  });

  it('opens one span per call, named for the operation, a child of the active span', async () => {
    const { tracer, finishedSpans } = recordingProvider();
    const { driver } = await openDriver();
    const parentSpan = tracer.startSpan('the caller');
    await withActiveSpan(parentSpan, () =>
      driver.readLatestState({
        executionId: 'execution-1',
        telemetry: { tracer },
      }),
    );
    parentSpan.end();
    const driverSpans = finishedSpans().filter((span) =>
      span.name.startsWith('arvo.outbox_driver.'),
    );
    expect(driverSpans.map((span) => span.name)).toEqual([
      'arvo.outbox_driver.readLatestState',
    ]);
    expect(driverSpans[0]?.parentSpanContext?.spanId).toBe(
      parentSpan.spanContext().spanId,
    );
  });

  it('ends its span marked as an error where the call fails, naming the kind', async () => {
    const { tracer, finishedSpans } = recordingProvider();
    const { driver } = await openDriver(() => ({
      readLatestState: () => {
        throw new Error('the database is down');
      },
    }));
    await driver.tryReadLatestState({
      executionId: 'execution-1',
      telemetry: { tracer },
    });
    const [driverSpan] = finishedSpans();
    expect(driverSpan?.status.code).toBe(2);
    expect(driverSpan?.status.message).toContain('(unavailable)');
  });

  it('ends its span where a validation error is thrown, recording it', async () => {
    const { tracer, finishedSpans } = recordingProvider();
    const { driver } = await openDriver();
    await expect(
      driver.tryCommitStateAndEvents({
        state: {},
        events: [],
        triggeringEvent,
        telemetry: { tracer },
      }),
    ).rejects.toThrow(ArvoOutboxDriverValidationError);
    const [driverSpan] = finishedSpans();
    expect(driverSpan?.status.code).toBe(2);
    expect(driverSpan?.events.map((spanEvent) => spanEvent.name)).toContain(
      'exception',
    );
  });

  it('ends its span marked ok where the call succeeds', async () => {
    const { tracer, finishedSpans } = recordingProvider();
    const { driver } = await openDriver();
    await driver.markEventsSeen({ eventIds: [], telemetry: { tracer } });
    expect(finishedSpans()[0]?.status.code).toBe(1);
  });

  it('opens a span of its own where capacity is asked on its own', async () => {
    const { tracer, finishedSpans } = recordingProvider();
    const { driver } = await openDriver();
    await driver.capacity({ telemetry: { tracer } });
    expect(finishedSpans().map((span) => span.name)).toEqual([
      'arvo.outbox_driver.capacity',
    ]);
  });

  it("records the question a commit asks on the commit's span, opening none of its own", async () => {
    const { tracer, finishedSpans } = recordingProvider();
    const { driver } = await openDriver();
    await driver.commitStateAndEvents({
      state: buildRecord(crypto.randomUUID(), 0),
      events: [buildEvent('execution-1')],
      triggeringEvent,
      telemetry: { tracer },
    });
    const [commitSpan, ...otherSpans] = finishedSpans();
    expect(commitSpan?.name).toBe('arvo.outbox_driver.commitStateAndEvents');
    expect(otherSpans).toEqual([]);
    expect(
      commitSpan?.events.map((spanEvent) => [
        spanEvent.name,
        spanEvent.attributes,
      ]),
    ).toEqual([
      [
        'outbox_driver.capacity',
        {
          'capacity.request.events': 1,
          'capacity.request.cas_version': 0,
          'capacity.status': 'available',
        },
      ],
    ]);
  });

  it("records a question that failed on the commit's span, naming the kind", async () => {
    const { tracer, finishedSpans } = recordingProvider();
    const { driver } = await openDriver(() => ({
      capacity: () => {
        throw new Error('the database is down');
      },
    }));
    await driver.tryCommitEvents({
      events: [],
      triggeringEvent,
      telemetry: { tracer },
    });
    expect(finishedSpans()[0]?.events[0]?.attributes).toEqual({
      'capacity.request.events': 0,
      'capacity.failure': 'unavailable',
    });
  });
});
