import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../../src/ArvoContract/index.js';
import type { ArvoEvent } from '../../../src/ArvoEvent/index.js';
import { ArvoExecutionStateSerializer } from '../../../src/ArvoEventHandler/state/serializer/index.js';
import {
  collectBatch,
  recordToCommit,
  refuseBatch,
  settleRecord,
} from '../../../src/ArvoEventHandler/version/returns.js';
import { createArvoEventFactory } from '../../../src/factories/ArvoEventFactory/index.js';
import { cloneArvoEvent } from '../../../src/factories/cloneArvoEvent.js';
import {
  initEvent,
  orderVersion,
  paymentVersion,
  services,
} from '../fixtures.js';
import { buildLooseState, buildState, orderData } from '../state/fixtures.js';

/** An event completing this execution back to whoever opened it. */
const completion = (overrides: Record<string, unknown> = {}) =>
  createArvoEventFactory(orderVersion).createOutput({
    type: 'com_order_created',
    source: orderVersion.type,
    subject: initEvent.subject,
    to: initEvent.source,
    initid: initEvent.id,
    data: { order_id: 'o-1' },
    ...overrides,
  });

/** An event asking the declared payment service to do something. */
const request = (overrides: Record<string, unknown> = {}) =>
  createArvoEventFactory(paymentVersion).createInput({
    source: orderVersion.type,
    subject: initEvent.subject,
    to: paymentVersion.type,
    data: { amount: 10 },
    ...overrides,
  });

const refuse = (batch: ArvoEvent[], maxDepth = 10_000) =>
  refuseBatch(orderVersion, services, maxDepth, batch);

describe('what an executor handed back', () => {
  it('is a batch of one where it returned one event', () => {
    const one = completion();
    expect(collectBatch(one)).toEqual([one]);
  });

  it('is the list where it returned a list', () => {
    const batch = [request(), completion()];
    expect(collectBatch(batch)).toEqual(batch);
  });

  it('is an empty batch where it returned a list of none', () => {
    expect(collectBatch([])).toEqual([]);
  });

  it('is an empty batch where it returned nothing at all', () => {
    expect(collectBatch(undefined)).toEqual([]);
  });

  it('is no batch at all where it returned something that is not an event', () => {
    expect(collectBatch({ type: 'com_order_created' } as never)).toBeNull();
  });

  it('is no batch at all where one member of the list is not an event', () => {
    expect(collectBatch([completion(), 'nearly' as never])).toBeNull();
  });
});

describe('what a batch must be to leave the handler', () => {
  it('admits one asking a declared service to do something', () => {
    expect(refuse([request()])).toBeNull();
  });

  it('admits one answering the caller', () => {
    expect(refuse([completion()])).toBeNull();
  });

  it('admits one doing both at once', () => {
    expect(refuse([request(), completion()])).toBeNull();
  });

  it('admits an empty one', () => {
    expect(refuse([])).toBeNull();
  });

  it('refuses a type this version may not emit', () => {
    const stray = cloneArvoEvent(completion(), {
      type: 'com_order_shipped' as never,
    });
    expect(refuse([stray])?.faultKind).toBe('emission_not_permitted');
  });

  it('refuses the handler error event, which is never an executor’s', () => {
    const handlerError = createArvoEventFactory(orderVersion).createError({
      source: orderVersion.type,
      subject: initEvent.subject,
      error: new Error('no'),
    });
    expect(refuse([handlerError])?.faultKind).toBe('emission_not_permitted');
  });

  it('refuses a second answer to the caller, who awaits exactly one', () => {
    const refusal = refuse([completion(), completion()]);
    expect(refusal?.faultKind).toBe('emission_not_permitted');
    expect(refusal?.violations[0]).toContain('awaits exactly one');
  });

  it('refuses a payload the schema its type selects will not have', () => {
    const wrong = cloneArvoEvent(completion(), {
      data: { order_id: 42 } as never,
    });
    expect(refuse([wrong])?.faultKind).toBe('emission_schema_rejected');
  });

  it('names the payload itself where no one field is at fault', () => {
    const strict = new ArvoContract({
      type: 'com_strict_charge',
      versions: {
        '1.0.0': { input: z.strictObject({ amount: z.number() }), outputs: {} },
      },
    }).versions['1.0.0'];
    const extra = cloneArvoEvent(
      createArvoEventFactory(strict).createInput({
        source: orderVersion.type,
        subject: initEvent.subject,
        to: strict.type,
        data: { amount: 10 },
      }),
      { data: { amount: 10, discount: 1 } as never },
    );
    const refusal = refuseBatch(orderVersion, { strict }, 10_000, [extra]);
    expect(refusal?.violations[0]).toContain('(root)');
  });

  it('refuses one that would sit deeper than this version allows', () => {
    const deep = cloneArvoEvent(request(), {
      depth: 10,
      parentid: initEvent.id,
    });
    expect(refuse([deep], 10)?.faultKind).toBe('max_depth_event_requested');
  });

  it('counts the events at fault against the batch, and says none were emitted', () => {
    const wrong = cloneArvoEvent(completion(), {
      data: { order_id: 42 } as never,
    });
    const refusal = refuse([wrong, request()]);
    expect(refusal?.message).toContain('one of the 2 events');
    expect(refusal?.message).toContain('com_order_create@1.0.0');
    expect(refusal?.message).toContain('none of them were');
  });

  it('counts more than one in the plural, so the sentence reads', () => {
    const wrong = cloneArvoEvent(completion(), {
      data: { order_id: 42 } as never,
    });
    const stray = cloneArvoEvent(request(), { type: 'com_nothing' as never });
    expect(refuse([wrong, stray])?.message).toContain('2 of the 2 events');
  });

  it('reports every event at fault, not merely the first', () => {
    const wrong = cloneArvoEvent(completion(), {
      data: { order_id: 42 } as never,
    });
    const stray = cloneArvoEvent(request(), { type: 'com_nothing' as never });
    expect(refuse([wrong, stray])?.violations).toHaveLength(2);
  });
});

describe('where an execution rests once its batch is in', () => {
  const settle = (batch: ArvoEvent[], state = buildState()) =>
    settleRecord(orderVersion, services, state, batch);

  it('waits, where it only asked services to do something', () => {
    expect(settle([request()]).lifecycle).toBe('waiting');
  });

  it('succeeds, where it answered the caller', () => {
    expect(settle([completion()]).lifecycle).toBe('success');
  });

  it('succeeds, where it answered the caller and asked a service too', () => {
    expect(settle([request(), completion()]).lifecycle).toBe('success');
  });

  it('stays cancelled, the executor having ended it deliberately', () => {
    const cancelled = buildState({
      lifecycle: 'cancelled',
      lifecycleDescription: 'the customer withdrew the order',
    });
    const settled = settle([completion()], cancelled);
    expect(settled.lifecycle).toBe('cancelled');
    expect(settled.lifecycleDescription).toBe(
      'the customer withdrew the order',
    );
  });

  it('waits, where it returned nothing and something is still outstanding', () => {
    expect(settle([]).lifecycle).toBe('waiting');
  });

  it('rests idle, where it returned nothing and waits for nothing', () => {
    const answered = buildState({ inFlightEventMap: new Map() });
    expect(settle([], answered).lifecycle).toBe('idle');
  });

  it('succeeds on nothing at all, for a version with nothing it could return', () => {
    const sinkVersion = new ArvoContract({
      type: 'com_audit_write',
      versions: {
        '1.0.0': { input: z.object({ line: z.string() }), outputs: {} },
      },
    }).versions['1.0.0'];
    const sink = settleRecord(
      sinkVersion,
      {},
      buildState({ inFlightEventMap: new Map() }),
      [],
    );
    expect(sink.lifecycle).toBe('success');
  });
});

describe('what the record says it is waiting for', () => {
  const settle = (batch: ArvoEvent[], state = buildState()) =>
    settleRecord(orderVersion, services, state, batch);

  it('is exactly what this batch asked for, whatever it held before', () => {
    const asked = request();
    const awaiting = settle([asked]).inFlightEventMap;
    expect([...awaiting.keys()]).toEqual([asked.id]);
    expect(awaiting.get(asked.id)).toBeNull();
  });

  it('is what it held before, where this batch asked for nothing', () => {
    expect([...settle([completion()]).inFlightEventMap.keys()]).toEqual([
      'emitted-1',
      'emitted-2',
    ]);
  });

  it('logs every event it is sending', () => {
    const asked = request();
    const answered = completion();
    const logged = settle([asked, answered]).eventIds;
    expect(logged).toContainEqual({ id: asked.id, direction: 'emitted' });
    expect(logged).toContainEqual({ id: answered.id, direction: 'emitted' });
  });

  it('leaves the record it was given exactly as it was', () => {
    const state = buildState();
    settle([completion()], state);
    expect(state.lifecycle).toBe('waiting');
    expect(state.eventIds).toHaveLength(2);
  });
});

describe('the record an execution leaves behind', () => {
  const commit = (state = buildState()) =>
    recordToCommit(true, orderData, state);

  it('is a JSON object, ready for whatever stores it', async () => {
    const written = await commit();
    expect(written.ok && typeof written.value).toBe('object');
  });

  it('reads back as the record the execution ended on', async () => {
    const written = await commit();
    const restored = await new ArvoExecutionStateSerializer(
      orderData,
    ).deserialize(JSON.stringify(written.ok && written.value));

    expect(restored.data).toEqual({ orderId: 'o-1', attempts: 2 });
    expect(restored.executionId).toBe(buildState().executionId);
    expect(restored.initEvent.id).toBe(initEvent.id);
  });

  it('is written at the revision it carries, which its caller settled', async () => {
    const written = await commit();
    expect(written.ok && written.value.casVersion).toBe(
      buildState().casVersion,
    );
  });

  it('leaves the record it was given exactly as it was', async () => {
    const state = buildState();
    await commit(state);
    expect(state.casVersion).toBe(7);
  });

  it('refuses an execution that remembered nothing at all', async () => {
    const written = await commit(buildState({ data: null }));
    expect(!written.ok && written.error.faultKind).toBe(
      'state_schema_rejected',
    );
  });

  it('names the call that was never made, and what to write instead', async () => {
    const written = await commit(buildState({ data: null }));
    expect(!written.ok && written.error.message).toContain('ctx.setState()');
    expect(!written.ok && written.error.message).toContain('Write {}');
  });

  it('says why what was written cannot be stored, and what commonly causes it', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const written = await recordToCommit(
      true,
      z.looseObject({}),
      buildLooseState({ circular }),
    );
    expect(!written.ok && written.error.message).toContain('ctx.setState()');
    expect(!written.ok && written.error.message).toContain(
      'refers back to itself',
    );
  });

  it('accepts a version that remembers nothing in particular saying so', async () => {
    const loose = z.looseObject({});
    const written = await recordToCommit(true, loose, buildLooseState({}));
    expect(written.ok).toBe(true);
  });

  it('refuses an execution holding something it cannot write out', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const written = await recordToCommit(
      true,
      z.looseObject({}),
      buildLooseState({ circular }),
    );
    expect(!written.ok && written.error.faultKind).toBe(
      'state_not_serializable',
    );
    expect(!written.ok && written.error.cause).toContain('circular');
  });
});

describe('a version whose author declared no state', () => {
  it('is not expected to write one, and rests with none', async () => {
    const written = await recordToCommit(
      false,
      z.strictObject({}),
      buildLooseState(null),
    );
    expect(written.ok && written.value.data).toBeNull();
  });

  it('is still refused where what it did write cannot be written out', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const written = await recordToCommit(
      false,
      z.looseObject({}),
      buildLooseState({ circular }),
    );
    expect(!written.ok && written.error.faultKind).toBe(
      'state_not_serializable',
    );
  });
});
