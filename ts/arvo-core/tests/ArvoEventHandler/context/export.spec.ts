import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createInitArvoExecutionContext } from '../../../src/ArvoEventHandler/context/factory.js';
import type { ArvoInitContextParam } from '../../../src/ArvoEventHandler/context/types.js';
import { ArvoHandlerFault } from '../../../src/ArvoEventHandler/fault/index.js';
import { ARVO_DEFAULT_HANDLER_OPTIONS } from '../../../src/ArvoEventHandler/helpers/defaults.js';
import { ArvoExecutionStateSerializer } from '../../../src/ArvoEventHandler/state/serializer/index.js';
import type {
  ArvoDependencies,
  ArvoMechanismHooks,
} from '../../../src/ArvoEventHandler/types/supplied.js';
import { initEvent, orderVersion, services, telemetry } from '../fixtures.js';

/** What a delivery records against; these tests only carry it. */
const { telemetry: tracing } = telemetry();

const orderData = z.object({ orderId: z.string(), attempts: z.number() });

const EXECUTION_ID = 'a'.repeat(64);

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

const opened = <TData extends z.core.$ZodObject = typeof orderData>(
  overrides: InitOverrides<TData> = {},
) => {
  const result = createInitArvoExecutionContext({
    contracts: { self: orderVersion, services },
    event: initEvent,
    executionId: EXECUTION_ID,
    parentExecutionId: initEvent.executionid,
    dataSchema: orderData as unknown as TData,
    attempt: 0,
    telemetry: tracing,
    options: ARVO_DEFAULT_HANDLER_OPTIONS,
    dependencies: {},
    hooks: {},
    ...overrides,
  });
  if (!result.ok) throw result.error;
  return result.value;
};

/** A context that has done everything an execution is expected to do. */
const finished = async (overrides: InitOverrides = {}) => {
  const ctx = opened(overrides);
  await ctx.setState({ data: { orderId: 'o-1', attempts: 1 } });
  return ctx;
};

describe('exporting what an execution finished as', () => {
  describe('what it gives back', () => {
    it('is a string, ready for whatever stores it', async () => {
      expect(typeof (await (await finished()).exportFinalState())).toBe(
        'string',
      );
    });

    it('reads back as the record the execution ended on', async () => {
      const ctx = await finished();
      const restored = await new ArvoExecutionStateSerializer(
        orderData,
      ).deserialize(await ctx.exportFinalState());

      expect(restored.data).toEqual({ orderId: 'o-1', attempts: 1 });
      expect(restored.executionId).toBe(EXECUTION_ID);
    });

    it('carries the events the execution held', async () => {
      const ctx = await finished();
      const restored = await new ArvoExecutionStateSerializer(
        orderData,
      ).deserialize(await ctx.exportFinalState());

      expect(restored.initEvent.id).toBe(initEvent.id);
      expect(restored.triggeringEvent.id).toBe(initEvent.id);
    });

    it('does not change the context it was read from', async () => {
      const ctx = await finished();
      const before = ctx.state;
      await ctx.exportFinalState();
      expect(ctx.state).toBe(before);
    });
  });

  describe('the revision it writes at', async () => {
    it('is one past the revision the execution held', async () => {
      const ctx = await finished();
      const restored = await new ArvoExecutionStateSerializer(
        orderData,
      ).deserialize(await ctx.exportFinalState());
      expect(ctx.state.casVersion).toBe(0);
      expect(restored.casVersion).toBe(1);
    });

    it('is the same on a second call, the context not having moved', async () => {
      const ctx = await finished();
      expect(await ctx.exportFinalState()).toBe(await ctx.exportFinalState());
    });
  });

  describe('an execution that remembered nothing', async () => {
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

    it('carries what the execution would be abandoned with, written out', async () => {
      const fault = await refused();
      expect(typeof fault.abandonmentEvent).toBe('string');
      expect(typeof fault.abandonmentState).toBe('string');
    });

    it('is refused whatever schema the version declared', async () => {
      expect((await refused({ dataSchema: z.looseObject({}) })).faultKind).toBe(
        'state_schema_rejected',
      );
    });

    it('accepts a version that remembers nothing in particular saying so', async () => {
      const ctx = opened({ dataSchema: z.looseObject({}) });
      await ctx.setState({ data: {} });
      expect(typeof (await ctx.exportFinalState())).toBe('string');
    });
  });

  describe('an execution holding something it cannot write out', () => {
    const unwritable = async () => {
      const ctx = opened({ dataSchema: z.looseObject({}) });
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      await ctx.setState({ data: { circular } as never });
      return ctx;
    };

    it('raises a fault', async () => {
      await expect(
        (await unwritable()).exportFinalState(),
      ).rejects.toBeInstanceOf(ArvoHandlerFault);
    });

    it('names it as the record not being serializable', async () => {
      try {
        await (await unwritable()).exportFinalState();
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
        await (await unwritable()).exportFinalState();
      } catch (raised) {
        expect((raised as ArvoHandlerFault).cause).toContain('circular');
        return;
      }
      throw new Error('expected the export to be refused');
    });
  });
});
