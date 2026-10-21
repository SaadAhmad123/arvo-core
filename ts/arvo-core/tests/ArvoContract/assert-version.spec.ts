import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../src/ArvoContract/index.js';
import { ArvoEvent } from '../../src/ArvoEvent/index.js';

const contract = new ArvoContract({
  type: 'com_order_create',
  versions: {
    '1.0.0': {
      input: z.object({ items: z.array(z.string()) }),
      outputs: { com_order_created: z.object({ order_id: z.string() }) },
    },
    '1.1.0': { input: z.object({ items: z.array(z.string()) }), outputs: {} },
  },
});

const version100 = contract.versions['1.0.0'];

/** An event of this contract, with whatever type and payload a case needs. */
const event = (
  type: string,
  data: Record<string, unknown>,
  dataschema: string = version100.dataschema,
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
    const assertedEvent = version100.assert(
      event('com_order_create', { items: ['a'] }),
    );
    expect(assertedEvent.scope).toBe('input');
    expect(assertedEvent.version).toBe('1.0.0');
  });

  it('matches a declared emit', () => {
    const assertedEvent = version100.assert(
      event('com_order_created', { order_id: 'o-1' }),
    );
    expect(assertedEvent.scope).toBe('output');
  });

  it('matches the handler error', () => {
    const assertedEvent = version100.assert(
      event(version100.error.type, {
        error_name: 'Error',
        error_message: 'boom',
        error_stack: null,
      }),
    );
    expect(assertedEvent.scope).toBe('error');
  });

  it('matches the handler error for a version declaring no outputs', () => {
    const version110 = contract.versions['1.1.0'];
    const assertedEvent = version110.assert(
      new ArvoEvent({
        source: 'com.test.suite',
        subject: 'order-1',
        type: version110.error.type,
        dataschema: version110.dataschema,
        data: { error_name: 'E', error_message: 'm', error_stack: null },
      }),
    );
    expect(assertedEvent.scope).toBe('error');
  });

  it('reports a type matching none of the three, naming what it got', () => {
    const assertion = version100.tryAssert(event('com_order_cancelled', {}));
    expect(assertion.ok).toBe(false);
    if (assertion.ok) return;
    expect(assertion.error.issues).toHaveLength(1);
    expect(assertion.error.issues[0]?.path).toBe('event.type');
    expect(assertion.error.issues[0]?.received).toBe('com_order_cancelled');
  });
});

describe('expecting a particular type', () => {
  it('confirms an expectation the event carries', () => {
    const assertedEvent = version100.assert(
      event('com_order_created', { order_id: 'o-1' }),
      'com_order_created',
    );
    expect(assertedEvent.scope).toBe('output');
    expect(assertedEvent.event.data.order_id).toBe('o-1');
  });

  it('reports an expectation the event contradicts, at the event type', () => {
    const assertion = version100.tryAssert(
      event('com_order_create', { items: [] }),
      'com_order_created',
    );
    expect(assertion.ok).toBe(false);
    if (assertion.ok) return;
    expect(assertion.error.issues[0]?.path).toBe('event.type');
    expect(assertion.error.issues[0]?.message).toContain('com_order_created');
    expect(assertion.error.issues[0]?.received).toBe('com_order_create');
  });

  it('reports an expectation the version does not declare, at the expectation', () => {
    const assertion = version100.tryAssert(
      event('com_order_create', { items: [] }),
      // @ts-expect-error not a type this version declares
      'com_order_shipped',
    );
    expect(assertion.ok).toBe(false);
    if (assertion.ok) return;
    expect(assertion.error.issues[0]?.path).toBe('expectedType');
    expect(assertion.error.issues[0]?.received).toBe('com_order_shipped');
  });

  it('lets any of the three match when nothing is expected', () => {
    expect(
      version100.assert(event('com_order_create', { items: [] })).scope,
    ).toBe('input');
    expect(
      version100.assert(event('com_order_created', { order_id: 'o' })).scope,
    ).toBe('output');
  });
});

describe('a version checks the dataschema itself', () => {
  it('rejects an event from a sibling version', () => {
    const assertion = version100.tryAssert(
      event('com_order_create', { items: [] }, '#/com/order/create/1.1.0'),
    );
    expect(assertion.ok).toBe(false);
    if (assertion.ok) return;
    expect(assertion.error.issues[0]?.path).toBe('event.dataschema.version');
    expect(assertion.error.issues[0]?.received).toBe('1.1.0');
  });

  it('rejects an event from another contract', () => {
    const assertion = version100.tryAssert(
      event('com_order_create', { items: [] }, '#/com/other/thing/1.0.0'),
    );
    expect(assertion.ok).toBe(false);
    if (assertion.ok) return;
    expect(assertion.error.issues[0]?.path).toBe('event.dataschema.uri');
    expect(assertion.error.issues[0]?.received).toBe('#/com/other/thing');
  });
});

describe('the payload', () => {
  it('reports every broken rule together', () => {
    const assertion = version100.tryAssert(
      event('com_order_created', { order_id: 42, extra: 1 }),
      'com_order_created',
    );
    expect(assertion.ok).toBe(false);
    if (assertion.ok) return;
    expect(assertion.error.issues.length).toBeGreaterThanOrEqual(1);
    expect(assertion.error.issues[0]?.path).toBe('event.data.order_id');
    expect(assertion.error.issues[0]?.received).toBe(42);
  });

  it('names a position nested inside the payload', () => {
    const assertion = version100.tryAssert(
      event('com_order_create', { items: [1] }),
    );
    expect(assertion.ok).toBe(false);
    if (assertion.ok) return;
    expect(assertion.error.issues[0]?.path).toBe('event.data.items.0');
    expect(assertion.error.issues[0]?.received).toBe(1);
  });

  it('reports no value when the broken rule is an absence', () => {
    const assertion = version100.tryAssert(event('com_order_create', {}));
    expect(assertion.ok).toBe(false);
    if (assertion.ok) return;
    expect(assertion.error.issues[0]?.path).toBe('event.data.items');
    expect(assertion.error.issues[0]?.received).toBeUndefined();
  });

  it('reports no value when the position does not exist in the payload', () => {
    // A contract's own check may report a path deeper than the payload goes.
    // There is no value at that position, so none is reported.
    const refinedContract = new ArvoContract({
      type: 'com_order_create',
      versions: {
        '1.0.0': {
          input: z
            .object({ items: z.array(z.string()) })
            .check((checkContext) => {
              checkContext.issues.push({
                code: 'custom',
                message: 'items must be priced',
                path: ['items', 0, 'price'],
                input: checkContext.value,
              });
            }),
          outputs: {},
        },
      },
    });
    const assertion = refinedContract.versions['1.0.0'].tryAssert(
      new ArvoEvent({
        source: 'com.test.suite',
        subject: 'order-1',
        type: 'com_order_create',
        dataschema: refinedContract.versions['1.0.0'].dataschema,
        data: { items: ['book'] },
      }),
    );
    expect(assertion.ok).toBe(false);
    if (assertion.ok) return;
    expect(assertion.error.issues[0]?.path).toBe('event.data.items.0.price');
    expect(assertion.error.issues[0]?.received).toBeUndefined();
  });

  it('is not judged when the type does not match', () => {
    const assertion = version100.tryAssert(
      event('com_order_cancelled', { junk: true }),
    );
    expect(assertion.ok).toBe(false);
    if (assertion.ok) return;
    expect(assertion.error.issues).toHaveLength(1);
    expect(assertion.error.issues[0]?.path).toBe('event.type');
  });

  it('is not judged when the event carries a type other than the one expected', () => {
    const assertion = version100.tryAssert(
      event('com_order_created', { order_id: 42 }),
      'com_order_create',
    );
    expect(assertion.ok).toBe(false);
    if (assertion.ok) return;
    expect(assertion.error.issues).toHaveLength(1);
    expect(assertion.error.issues[0]?.path).toBe('event.type');
  });
});
