import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IArvoOutbox } from '../../src/ArvoOutbox/interface.js';
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

/**
 * A working in-memory outbox that writes down every call made on it, with
 * some operations replaced where a test needs the outbox to answer wrongly.
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
          ((commit) => workingOutbox.commitEvents(commit))
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
    const [commitCall] = outboxCalls;
    expect(commitCall?.argument).toMatchObject({
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
    expect(outboxCalls[0]?.argument).toMatchObject({
      events: [{ casVersion: null }],
    });
  });

  it('passes every event on, duplicates included, for the outbox to decide', async () => {
    const { driver, outboxCalls } = await openDriver();
    const event = buildEvent('execution-1');
    await driver.commitEvents({ events: [event, event], triggeringEvent });
    expect(outboxCalls[0]?.argument).toMatchObject({
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

  it.each(['state_exists', 'revision_stale'] as const)(
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
  it('calls the outbox once per operation, even for a refusal', async () => {
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
});
