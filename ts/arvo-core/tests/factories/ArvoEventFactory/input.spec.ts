import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../../src/ArvoContract/index.js';
import { createArvoEventFactory } from '../../../src/factories/ArvoEventFactory/index.js';

const orderFactory = createArvoEventFactory(
  new ArvoContract({
    type: 'com_order_create',
    versions: {
      '1.0.0': {
        input: z.object({
          items: z.array(z.string()),
          currency: z.string().default('GBP'),
        }),
        outputs: {},
      },
    },
  }).versions['1.0.0'],
);

describe('the event a version accepts', () => {
  it('takes its type and dataschema from the version', () => {
    const event = orderFactory.createInput({
      source: 'com.web.checkout',
      data: { items: ['book'] },
    });
    expect(event.type).toBe('com_order_create');
    expect(event.dataschema).toBe('#/com/order/create/1.0.0');
  });

  it('addresses it to the handler that accepts it', () => {
    expect(
      orderFactory.createInput({ source: 'com.web', data: { items: [] } }).to,
    ).toBe('com_order_create');
  });

  it('keeps a recipient the caller supplied', () => {
    expect(
      orderFactory.createInput({
        source: 'com.web',
        data: { items: [] },
        to: 'com.elsewhere',
      }).to,
    ).toBe('com.elsewhere');
  });

  it('addresses it to the handler even when `to` is passed as undefined', () => {
    expect(
      orderFactory.createInput({
        source: 'com.web',
        data: { items: [] },
        to: undefined,
      }).to,
    ).toBe('com_order_create');
  });
});

describe('the payload a version declares', () => {
  it('carries a value the schema defaults', () => {
    expect(
      orderFactory.createInput({ source: 'com.web', data: { items: [] } }).data
        .currency,
    ).toBe('GBP');
  });

  it('does not replace a value the caller supplied', () => {
    expect(
      orderFactory.createInput({
        source: 'com.web',
        data: { items: [], currency: 'USD' },
      }).data.currency,
    ).toBe('USD');
  });

  it('reports a rejected payload beneath its position', () => {
    const createResult = orderFactory.tryCreateInput({
      source: 'com.web',
      data: { items: [1] } as never,
    });
    expect(createResult.ok).toBe(false);
    if (createResult.ok) return;
    expect(createResult.error.issues[0]?.path).toBe('data.items.0');
    expect(createResult.error.issues[0]?.message).toContain("contract's input");
  });

  it('reports every position that broke', () => {
    const createResult = orderFactory.tryCreateInput({
      source: 'com.web',
      data: { items: [1, 2] } as never,
    });
    if (createResult.ok) throw new Error('expected a failure');
    expect(createResult.error.issues).toHaveLength(2);
  });

  it('builds no event when the payload is rejected', () => {
    expect(() =>
      orderFactory.createInput({ source: 'com.web', data: {} as never }),
    ).toThrow(/items/);
  });
});

describe('a schema whose output is not what it was given', () => {
  const coercingFactory = createArvoEventFactory(
    new ArvoContract({
      type: 'com_order_create',
      versions: {
        '1.0.0': { input: z.object({ at: z.coerce.date() }), outputs: {} },
      },
    }).versions['1.0.0'],
  );

  it('serializes a Date the check produced, the payload walk having no other form for it', () => {
    // Declared as a `Date` by the schema's output type and not one on the
    // event: the divergence a transform introduces, pinned rather than fixed.
    const event = coercingFactory.createInput({
      source: 'com.web',
      data: { at: '2026-01-01T00:00:00.000Z' },
    });
    expect(typeof event.data.at).toBe('string');
    expect(event.data.at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('reports a value with no JSON form at its position', () => {
    const setFactory = createArvoEventFactory(
      new ArvoContract({
        type: 'com_order_create',
        versions: {
          '1.0.0': {
            input: z.object({
              tags: z.array(z.string()).transform((tags) => new Set(tags)),
            }),
            outputs: {},
          },
        },
      }).versions['1.0.0'],
    );

    const createResult = setFactory.tryCreateInput({
      source: 'com.web',
      data: { tags: ['a'] },
    });
    expect(createResult.ok).toBe(false);
    if (createResult.ok) return;
    expect(createResult.error.issues[0]?.path).toBe('data.tags');
    expect(createResult.error.issues[0]?.message).toContain(
      'no JSON representation',
    );
  });
});

describe('a position the payload does not reach', () => {
  it('reports no value rather than walking into one that is not there', () => {
    // A schema may report a position deeper than the payload goes. The value
    // is fetched by walking, and a walk that runs out has nothing to report.
    const refiningFactory = createArvoEventFactory(
      new ArvoContract({
        type: 'com_order_create',
        versions: {
          '1.0.0': {
            input: z
              .object({ items: z.array(z.string()) })
              .superRefine((_payload, refinementCtx) => {
                refinementCtx.addIssue({
                  code: 'custom',
                  path: ['absent', 'deeper'],
                  message: 'must be settled elsewhere',
                });
              }),
            outputs: {},
          },
        },
      }).versions['1.0.0'],
    );

    const createResult = refiningFactory.tryCreateInput({
      source: 'com.web',
      data: { items: [] },
    });

    expect(createResult.ok).toBe(false);
    if (createResult.ok) return;
    expect(createResult.error.issues[0]?.path).toBe('data.absent.deeper');
    expect(createResult.error.issues[0]?.received).toBeUndefined();
  });
});
