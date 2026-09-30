import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoEvent } from '../../../src/ArvoEvent/index.js';
import {
  createFollowupArvoExecutionContext,
  createInitArvoExecutionContext,
} from '../../../src/ArvoEventHandler/context/factory.js';
import type {
  ArvoFollowupContextParam,
  ArvoInitContextParam,
} from '../../../src/ArvoEventHandler/context/types.js';
import { ARVO_DEFAULT_HANDLER_OPTIONS } from '../../../src/ArvoEventHandler/helpers/defaults.js';
import { ArvoExecutionStateValidationError } from '../../../src/ArvoEventHandler/state/errors.js';
import { ArvoExecutionStateSerializerError } from '../../../src/ArvoEventHandler/state/serializer/errors.js';
import { ArvoExecutionStateSerializer } from '../../../src/ArvoEventHandler/state/serializer/index.js';
import type {
  ArvoDependencies,
  ArvoMechanismHooks,
} from '../../../src/ArvoEventHandler/types/supplied.js';
import {
  chargedEvent,
  initEvent,
  orderContract,
  orderVersion,
  paymentFailedEvent,
  services,
} from '../fixtures.js';

const orderData = z.object({ orderId: z.string(), attempts: z.number() });

const EXECUTION_ID = 'a'.repeat(64);

const contractsSnapshot = {
  self: { uri: orderContract.uri, type: orderContract.type },
  services: [{ uri: 'https://example.com/pay', type: 'com_pay' }],
};

const common = {
  contracts: { self: orderVersion, services },
  dataSchema: orderData,
  attempt: 0,
  options: ARVO_DEFAULT_HANDLER_OPTIONS,
  dependencies: {} as ArvoDependencies,
  hooks: {} as ArvoMechanismHooks,
};

/** What a fixture may vary about opening an execution. */
type InitOverrides<TData extends z.core.$ZodObject = typeof orderData> =
  Partial<
    ArvoInitContextParam<
      typeof orderVersion,
      typeof services,
      TData,
      ArvoDependencies,
      ArvoMechanismHooks
    >
  >;

/** Opening an execution, as the factory reports it. */
const open = <TData extends z.core.$ZodObject = typeof orderData>(
  overrides: InitOverrides<TData> = {},
) =>
  createInitArvoExecutionContext({
    ...common,
    event: initEvent,
    executionId: EXECUTION_ID,
    parentExecutionId: initEvent.executionid,
    contractsSnapshot,
    ...overrides,
  });

/** The same, for a fixture that expects it to have worked. */
const opened = <TData extends z.core.$ZodObject = typeof orderData>(
  overrides: InitOverrides<TData> = {},
) => {
  const result = open<TData>(overrides);
  if (!result.ok) throw result.error;
  return result.value;
};

/** A stored row for an execution that has emitted a charge and is waiting. */
const storedRow = async (overrides: Record<string, unknown> = {}) => {
  const ctx = opened();
  await ctx.setState({ data: { orderId: 'o-1', attempts: 1 } });
  const serializer = new ArvoExecutionStateSerializer(orderData);
  const asStored = JSON.parse(await serializer.serialize(ctx.state));
  return JSON.stringify({
    ...asStored,
    lifecycle: 'waiting',
    casVersion: 2,
    eventIds: [
      { id: initEvent.id, direction: 'received' },
      { id: 'charge-request', direction: 'emitted' },
    ],
    inFlightEventMap: [['charge-request', null]],
    ...overrides,
  });
};

/** What a fixture may vary about resuming one. */
type FollowupOverrides = Partial<
  ArvoFollowupContextParam<
    typeof orderVersion,
    typeof services,
    typeof orderData,
    ArvoDependencies,
    ArvoMechanismHooks
  >
>;

/** Resuming an execution, for a fixture that expects it to have worked. */
const resumed = async (overrides: FollowupOverrides = {}) => {
  const result = await createFollowupArvoExecutionContext({
    ...common,
    event: chargedEvent,
    state: await storedRow(),
    executionId: EXECUTION_ID,
    ...overrides,
  });
  if (!result.ok) throw result.error;
  return result.value;
};

describe('opening an execution', async () => {
  describe('the record it builds', () => {
    it('remembers nothing yet', () => {
      expect(opened().state.data).toBeNull();
    });

    it('rests where an execution rests before anything has run', () => {
      expect(opened().state.lifecycle).toBe('idle');
      expect(opened().state.lifecycleDescription).toBeNull();
    });

    it('has never been written', () => {
      expect(opened().state.casVersion).toBe(0);
    });

    it('says which shape of record it is', () => {
      expect(opened().state.recordFormatVersion).toBe('1.0.0');
    });

    it('takes the identity it was given rather than deriving one', () => {
      const ctx = opened();
      expect(ctx.state.executionId).toBe(EXECUTION_ID);
      expect(ctx.state.parentExecutionId).toBe(initEvent.executionid);
    });

    it('reads the workflow and the depth off the event', () => {
      const ctx = opened();
      expect(ctx.state.subject).toBe(initEvent.subject);
      expect(ctx.state.depth).toBe(initEvent.depth);
    });

    it('reads what it implements off the contract', () => {
      const ctx = opened();
      expect(ctx.state.source).toBe(orderVersion.type);
      expect(ctx.state.version).toBe(orderVersion.version);
    });

    it('holds the opening event as both events it has', () => {
      const ctx = opened();
      expect(ctx.state.initEvent).toBe(initEvent);
      expect(ctx.state.triggeringEvent).toBe(initEvent);
    });

    it('logs the opening event as received', () => {
      expect(opened().state.eventIds).toEqual([
        { id: initEvent.id, direction: 'received' },
      ]);
    });

    it('is waiting on nothing', () => {
      expect(opened().state.inFlightEventMap.size).toBe(0);
    });

    it('stores the contracts it was given', () => {
      expect(opened().state.contracts).toEqual(contractsSnapshot);
    });
  });

  describe('the context it builds', async () => {
    it('says the delivery opened the execution', () => {
      expect(opened().entry).toBe('init');
    });

    it('carries the live contracts, not the stored snapshot', () => {
      expect(opened().contracts.self).toBe(orderVersion);
    });

    it('carries which attempt this is', () => {
      expect(opened({ attempt: 3 }).attempt).toBe(3);
    });

    it('carries what the mechanism supplied', () => {
      const db = {};
      const ctx = opened({ dependencies: { db } });
      expect(ctx.dependencies.db).toBe(db);
    });

    it('accepts a write straight away', async () => {
      const ctx = opened();
      await ctx.setState({ data: { orderId: 'o-1', attempts: 1 } });
      expect(ctx.state.data).toEqual({ orderId: 'o-1', attempts: 1 });
    });
  });

  describe('the schema it carries', async () => {
    it('is the one the version declared', () => {
      expect(opened().dataSchema).toBe(orderData);
    });

    it('keeps every key a loose schema was written with', async () => {
      const anything = z.looseObject({});
      const ctx = opened({ dataSchema: anything });
      await ctx.setState({ data: { seen: 1, nested: { deep: true } } });
      expect(ctx.state.data).toEqual({ seen: 1, nested: { deep: true } });
    });
  });

  describe('when it will not open', () => {
    it('reports rather than throwing', () => {
      const result = createInitArvoExecutionContext({
        ...common,
        event: initEvent,
        executionId: '',
        parentExecutionId: initEvent.executionid,
        contractsSnapshot,
      });
      expect(result.ok).toBe(false);
    });

    it('names the field at fault', () => {
      const result = createInitArvoExecutionContext({
        ...common,
        event: initEvent,
        executionId: '',
        parentExecutionId: initEvent.executionid,
        contractsSnapshot,
      });
      expect(
        !result.ok && result.error.issues.map((issue) => issue.path),
      ).toEqual(['executionId']);
    });

    it('lets anything that is not a rejected record through unconverted', () => {
      const unreadable = Object.create(ArvoEvent.prototype) as ArvoEvent;
      Object.assign(unreadable, { ...initEvent });
      Object.defineProperty(unreadable, 'depth', {
        get() {
          throw new RangeError('this field cannot be read');
        },
      });

      expect(() =>
        createInitArvoExecutionContext({
          ...common,
          event: unreadable as never,
          executionId: EXECUTION_ID,
          parentExecutionId: initEvent.executionid,
          contractsSnapshot,
        }),
      ).toThrow(RangeError);
    });

    it('gives back a context through the reporting form when it is sound', () => {
      const result = createInitArvoExecutionContext({
        ...common,
        event: initEvent,
        executionId: EXECUTION_ID,
        parentExecutionId: initEvent.executionid,
        contractsSnapshot,
      });
      expect(result.ok && result.value.state.executionId).toBe(EXECUTION_ID);
    });
  });
});

describe('resuming an execution', async () => {
  describe('what it takes off the record', async () => {
    it('takes what was remembered', async () => {
      expect((await resumed()).state.data).toEqual({
        orderId: 'o-1',
        attempts: 1,
      });
    });

    it('takes where the execution rests', async () => {
      expect((await resumed()).state.lifecycle).toBe('waiting');
    });

    it('takes the revision it was stored at', async () => {
      expect((await resumed()).state.casVersion).toBe(2);
    });

    it('takes the identity, rather than the one it was passed', async () => {
      expect((await resumed()).state.executionId).toBe(EXECUTION_ID);
    });

    it('takes the event that opened the execution, restored as an event', async () => {
      const ctx = await resumed();
      expect(ctx.state.initEvent).toBeInstanceOf(ArvoEvent);
      expect(ctx.state.initEvent.id).toBe(initEvent.id);
    });

    it('leaves the event log exactly as it was stored', async () => {
      expect((await resumed()).state.eventIds).toEqual([
        { id: initEvent.id, direction: 'received' },
        { id: 'charge-request', direction: 'emitted' },
      ]);
    });

    it('leaves what is awaited exactly as it was stored', async () => {
      const ctx = await resumed();
      expect(ctx.state.inFlightEventMap.get('charge-request')).toBeNull();
    });
  });

  describe('the event that caused this delivery', async () => {
    it('is this delivery, not the one the record was stored with', async () => {
      expect((await resumed()).state.triggeringEvent).toBe(chargedEvent);
    });

    it('is a service handler error like any other answer', async () => {
      const ctx = await resumed({ event: paymentFailedEvent });
      expect(ctx.state.triggeringEvent).toBe(paymentFailedEvent);
    });
  });

  describe('the context it builds', async () => {
    it('says the delivery answers something awaited', async () => {
      expect((await resumed()).entry).toBe('followup');
    });

    it('carries the live contracts', async () => {
      expect((await resumed()).contracts.self).toBe(orderVersion);
    });

    it('accepts a write that builds on what was stored', async () => {
      const ctx = await resumed();
      await ctx.setState({
        data: (current) => ({
          orderId: '',
          ...current,
          attempts: (current?.attempts ?? 0) + 1,
        }),
      });
      expect(ctx.state.data).toEqual({ orderId: 'o-1', attempts: 2 });
    });
  });

  describe('when it will not resume', async () => {
    it('refuses a row that is not a stored record', async () => {
      const result = await createFollowupArvoExecutionContext({
        ...common,
        event: chargedEvent,
        state: 'not a row at all',
        executionId: EXECUTION_ID,
      });
      expect(!result.ok && result.error).toBeInstanceOf(
        ArvoExecutionStateSerializerError,
      );
    });

    it('refuses a row that reads but is wrong', async () => {
      const result = await createFollowupArvoExecutionContext({
        ...common,
        event: chargedEvent,
        state: await storedRow({ depth: -1 }),
        executionId: EXECUTION_ID,
      });
      expect(!result.ok && result.error).toBeInstanceOf(
        ArvoExecutionStateValidationError,
      );
    });

    it('refuses a record for a different execution', async () => {
      const result = await createFollowupArvoExecutionContext({
        ...common,
        event: chargedEvent,
        state: await storedRow(),
        executionId: 'b'.repeat(64),
      });
      expect(!result.ok && result.error).toBeInstanceOf(
        ArvoExecutionStateValidationError,
      );
    });

    it('says which execution it was asked for and which it found', async () => {
      const result = await createFollowupArvoExecutionContext({
        ...common,
        event: chargedEvent,
        state: await storedRow(),
        executionId: 'b'.repeat(64),
      });
      // @ts-expect-error
      expect(!result.ok && result.error.issues?.[0]?.path).toBe('executionId');
    });

    it('reports a row that is not one, rather than throwing', async () => {
      const result = await createFollowupArvoExecutionContext({
        ...common,
        event: chargedEvent,
        state: 'not a row',
        executionId: EXECUTION_ID,
      });
      expect(!result.ok && result.error).toBeInstanceOf(
        ArvoExecutionStateSerializerError,
      );
    });
  });
});
