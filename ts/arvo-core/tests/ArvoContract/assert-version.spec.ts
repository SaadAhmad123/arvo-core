import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../src/ArvoContract/index.js';
import { ArvoEvent } from '../../src/ArvoEvent/index.js';

const contract = new ArvoContract({
  type: 'com_order_create',
  versions: {
    '1.0.0': {
      accepts: z.object({ items: z.array(z.string()) }),
      emits: { com_order_created: z.object({ order_id: z.string() }) },
    },
    '1.1.0': { accepts: z.object({ items: z.array(z.string()) }), emits: {} },
  },
});

const v1 = contract.versions['1.0.0'];

/** An event of this contract, with whatever type and payload a case needs. */
const event = (
  type: string,
  data: Record<string, unknown>,
  dataschema = v1.dataschema,
) =>
  new ArvoEvent({
    source: 'com.test.suite',
    subject: 'order-1',
    type,
    dataschema,
    data,
  });

describe('asserting an event against a version', () => {
  it('matches the accepted request', () => {
    const asserted = v1.assert(event('com_order_create', { items: ['a'] }));
    expect(asserted.scope).toBe('accepts');
    expect(asserted.version).toBe('1.0.0');
  });

  it('matches a declared emit', () => {
    const asserted = v1.assert(
      event('com_order_created', { order_id: 'o-1' }),
    );
    expect(asserted.scope).toBe('emits');
  });

  it('matches the handler error', () => {
    const asserted = v1.assert(
      event(v1.handlerError.type, {
        error_name: 'Error',
        error_message: 'boom',
        error_stack: null,
      }),
    );
    expect(asserted.scope).toBe('handlerError');
  });

  it('matches the handler error for a version declaring no emits', () => {
    const v11 = contract.versions['1.1.0'];
    const asserted = v11.assert(
      new ArvoEvent({
        source: 'com.test.suite',
        subject: 'order-1',
        type: v11.handlerError.type,
        dataschema: v11.dataschema,
        data: { error_name: 'E', error_message: 'm', error_stack: null },
      }),
    );
    expect(asserted.scope).toBe('handlerError');
  });

  it('reports a type matching none of the three, naming what it got', () => {
    const attempt = v1.tryAssert(event('com_order_cancelled', {}));
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error.issues).toHaveLength(1);
    expect(attempt.error.issues[0]?.path).toBe('event.type');
    expect(attempt.error.issues[0]?.received).toBe('com_order_cancelled');
  });
});

describe('expecting a particular type', () => {
  it('confirms an expectation the event carries', () => {
    const asserted = v1.assert(
      event('com_order_created', { order_id: 'o-1' }),
      'com_order_created',
    );
    expect(asserted.scope).toBe('emits');
    expect(asserted.event.data.order_id).toBe('o-1');
  });

  it('reports an expectation the event contradicts, at the event type', () => {
    const attempt = v1.tryAssert(
      event('com_order_create', { items: [] }),
      'com_order_created',
    );
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error.issues[0]?.path).toBe('event.type');
    expect(attempt.error.issues[0]?.message).toContain('com_order_created');
    expect(attempt.error.issues[0]?.received).toBe('com_order_create');
  });

  it('reports an expectation the version does not declare, at the expectation', () => {
    const attempt = v1.tryAssert(
      event('com_order_create', { items: [] }),
      // @ts-expect-error not a type this version declares
      'com_order_shipped',
    );
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error.issues[0]?.path).toBe('expectedType');
    expect(attempt.error.issues[0]?.received).toBe('com_order_shipped');
  });

  it('lets any of the three match when nothing is expected', () => {
    expect(v1.assert(event('com_order_create', { items: [] })).scope).toBe(
      'accepts',
    );
    expect(
      v1.assert(event('com_order_created', { order_id: 'o' })).scope,
    ).toBe('emits');
  });
});

describe('a version checks the dataschema itself', () => {
  it('rejects an event from a sibling version', () => {
    const attempt = v1.tryAssert(
      event('com_order_create', { items: [] }, '#/com/order/create/1.1.0'),
    );
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error.issues[0]?.path).toBe('event.dataschema.version');
    expect(attempt.error.issues[0]?.received).toBe('1.1.0');
  });

  it('rejects an event from another contract', () => {
    const attempt = v1.tryAssert(
      event('com_order_create', { items: [] }, '#/com/other/thing/1.0.0'),
    );
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error.issues[0]?.path).toBe('event.dataschema.uri');
    expect(attempt.error.issues[0]?.received).toBe('#/com/other/thing');
  });
});

describe('the payload', () => {
  it('reports every broken rule together', () => {
    const attempt = v1.tryAssert(
      event('com_order_created', { order_id: 42, extra: 1 }),
      'com_order_created',
    );
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error.issues.length).toBeGreaterThanOrEqual(1);
    expect(attempt.error.issues[0]?.path).toBe('event.data.order_id');
    expect(attempt.error.issues[0]?.received).toBe(42);
  });

  it('names a position nested inside the payload', () => {
    const attempt = v1.tryAssert(event('com_order_create', { items: [1] }));
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error.issues[0]?.path).toBe('event.data.items.0');
    expect(attempt.error.issues[0]?.received).toBe(1);
  });

  it('reports no value when the broken rule is an absence', () => {
    const attempt = v1.tryAssert(event('com_order_create', {}));
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error.issues[0]?.path).toBe('event.data.items');
    expect(attempt.error.issues[0]?.received).toBeUndefined();
  });

  it('is not judged when the type does not match', () => {
    const attempt = v1.tryAssert(event('com_order_cancelled', { junk: true }));
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error.issues).toHaveLength(1);
    expect(attempt.error.issues[0]?.path).toBe('event.type');
  });

  it('is not judged when the event carries a type other than the one expected', () => {
    const attempt = v1.tryAssert(
      event('com_order_created', { order_id: 42 }),
      'com_order_create',
    );
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error.issues).toHaveLength(1);
    expect(attempt.error.issues[0]?.path).toBe('event.type');
  });
});
