import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createInitArvoExecutionContext } from '../../../src/ArvoEventHandler/context/factory.js';
import { ArvoHandlerFault } from '../../../src/ArvoEventHandler/fault/index.js';
import { ARVO_DEFAULT_HANDLER_OPTIONS } from '../../../src/ArvoEventHandler/helpers/defaults.js';
import { ArvoExecutionState } from '../../../src/ArvoEventHandler/state/index.js';
import { ArvoExecutionStateSerializer } from '../../../src/ArvoEventHandler/state/serializer/index.js';
import {
  initEvent,
  orderContract,
  orderVersion,
  services,
} from '../fixtures.js';

const orderData = z.object({ orderId: z.string(), attempts: z.number() });

const EXECUTION_ID = 'a'.repeat(64);

const opened = (overrides: Record<string, unknown> = {}) =>
  createInitArvoExecutionContext({
    contracts: { self: orderVersion, services },
    event: initEvent,
    executionId: EXECUTION_ID,
    parentExecutionId: initEvent.executionid,
    contractsSnapshot: {
      self: { uri: orderContract.uri, type: orderContract.type },
      services: [],
    },
    dataSchema: orderData,
    attempt: 0,
    options: ARVO_DEFAULT_HANDLER_OPTIONS,
    dependencies: {},
    hooks: {},
    ...overrides,
  } as never);

/** A context that has done everything an execution is expected to do. */
const finished = (overrides: Record<string, unknown> = {}) => {
  const ctx = opened(overrides);
  ctx.setState({ data: { orderId: 'o-1', attempts: 1 } });
  return ctx;
};

describe('exporting what an execution finished as', () => {
  describe('what it gives back', () => {
    it('is a string, ready for whatever stores it', async () => {
      expect(typeof (await finished().exportFinalState())).toBe('string');
    });

    it('reads back as the record the execution ended on', async () => {
      const ctx = finished();
      const restored = await new ArvoExecutionStateSerializer(
        orderData,
      ).deserialize(await ctx.exportFinalState());

      expect(restored.data).toEqual({ orderId: 'o-1', attempts: 1 });
      expect(restored.executionId).toBe(EXECUTION_ID);
    });

    it('carries the events the execution held', async () => {
      const ctx = finished();
      const restored = await new ArvoExecutionStateSerializer(
        orderData,
      ).deserialize(await ctx.exportFinalState());

      expect(restored.initEvent.id).toBe(initEvent.id);
      expect(restored.triggeringEvent.id).toBe(initEvent.id);
    });

    it('does not change the context it was read from', async () => {
      const ctx = finished();
      const before = ctx.state;
      await ctx.exportFinalState();
      expect(ctx.state).toBe(before);
    });
  });

  describe('the revision it writes at', () => {
    it('is one past the revision the execution held', async () => {
      const ctx = finished();
      const restored = await new ArvoExecutionStateSerializer(
        orderData,
      ).deserialize(await ctx.exportFinalState());
      expect(ctx.state.casVersion).toBe(0);
      expect(restored.casVersion).toBe(1);
    });

    it('is the same on a second call, the context not having moved', async () => {
      const ctx = finished();
      expect(await ctx.exportFinalState()).toBe(await ctx.exportFinalState());
    });
  });

  describe('an execution that remembered nothing', () => {
    /** The fault raised by writing out an execution that wrote nothing. */
    const refused = async (overrides: Record<string, unknown> = {}) => {
      try {
        await opened(overrides).exportFinalState();
      } catch (raised) {
        return raised as ArvoHandlerFault;
      }
      throw new Error('expected the export to be refused');
    };

    it('raises a fault rather than reporting', async () => {
      expect(await refused()).toBeInstanceOf(ArvoHandlerFault);
    });

    it('names the fault, so a mechanism need not read the message', async () => {
      expect((await refused()).faultKind).toBe('state_schema_rejected');
    });

    it('names the delivery it happened on', async () => {
      const fault = await refused();
      expect(fault.subject).toBe(initEvent.subject);
      expect(fault.executionId).toBe(EXECUTION_ID);
      expect(fault.eventId).toBe(initEvent.id);
    });

    it('carries what the execution would be abandoned with', async () => {
      const fault = await refused();
      expect(fault.abandonmentEvent).not.toBeNull();
      expect(fault.abandonmentState).toBeInstanceOf(ArvoExecutionState);
    });

    it('is refused whether or not the version declared a schema of its own', async () => {
      expect((await refused({ dataSchema: null })).faultKind).toBe(
        'state_schema_rejected',
      );
    });

    it('accepts a version that remembers nothing in particular saying so', async () => {
      const ctx = opened({ dataSchema: null });
      ctx.setState({ data: {} });
      expect(typeof (await ctx.exportFinalState())).toBe('string');
    });
  });

  describe('an execution holding something it cannot write out', () => {
    const unwritable = () => {
      const ctx = opened({ dataSchema: null });
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      ctx.setState({ data: { circular } as never });
      return ctx;
    };

    it('raises a fault', async () => {
      await expect(unwritable().exportFinalState()).rejects.toBeInstanceOf(
        ArvoHandlerFault,
      );
    });

    it('names it as the record not being serializable', async () => {
      try {
        await unwritable().exportFinalState();
      } catch (raised) {
        expect((raised as ArvoHandlerFault).faultKind).toBe(
          'state_not_serializable',
        );
        return;
      }
      throw new Error('expected the export to be refused');
    });

    it('keeps what went wrong underneath', async () => {
      try {
        await unwritable().exportFinalState();
      } catch (raised) {
        expect((raised as ArvoHandlerFault).cause).toContain('circular');
        return;
      }
      throw new Error('expected the export to be refused');
    });
  });
});
