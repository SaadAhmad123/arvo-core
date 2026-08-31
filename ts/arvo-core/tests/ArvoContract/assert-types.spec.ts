import { describe, expect, expectTypeOf, it } from 'vitest';
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
    '1.1.0': {
      input: z.object({ items: z.array(z.string()) }),
      outputs: { com_order_shipped: z.object({ eta: z.string() }) },
    },
  },
});

const v1 = contract.versions['1.0.0'];

const event = (type: string, data: Record<string, unknown>) =>
  new ArvoEvent({
    source: 'com.test.suite',
    subject: 'order-1',
    type,
    dataschema: v1.dataschema,
    data,
  });

describe('what an expectation narrows', () => {
  it('narrows the scope to one literal per shape', () => {
    const input = v1.assert(
      event('com_order_create', { items: [] }),
      'com_order_create',
    );
    const outputs = v1.assert(
      event('com_order_created', { order_id: 'o' }),
      'com_order_created',
    );
    const failed = v1.assert(
      event(v1.error.type, {
        error_name: 'E',
        error_message: 'm',
        error_stack: null,
      }),
      'handler_com_order_create_error',
    );

    expectTypeOf(input.scope).toEqualTypeOf<'input'>();
    expectTypeOf(outputs.scope).toEqualTypeOf<'output'>();
    expectTypeOf(failed.scope).toEqualTypeOf<'error'>();
  });

  it('gives the payload the expected shape declares', () => {
    const emitted = v1.assert(
      event('com_order_created', { order_id: 'o' }),
      'com_order_created',
    );
    expectTypeOf(emitted.event.data).toEqualTypeOf<{ order_id: string }>();
    expectTypeOf(emitted.event.type).toEqualTypeOf<'com_order_created'>();
  });

  it('leaves the scope wide and the payload unparameterised without one', () => {
    const asked = v1.assert(event('com_order_create', { items: [] }));
    expectTypeOf(asked.scope).toEqualTypeOf<'input' | 'output' | 'error'>();
    expectTypeOf(asked.version).toEqualTypeOf<'1.0.0'>();
  });

  it('refuses a type the version does not declare', () => {
    // @ts-expect-error not a type this version declares
    expect(() =>
      v1.assert(event('com_order_create', { items: [] }), 'com_nope'),
    ).toThrow();
  });

  it('refuses a plain string where a literal is wanted', () => {
    const loose: string = 'com_order_create';
    // @ts-expect-error a string variable is not an assertable literal
    expect(() =>
      v1.assert(event('com_order_create', { items: [] }), loose),
    ).not.toThrow();
  });
});

describe('what a contract reports', () => {
  it('reports the union of its declared versions', () => {
    const asserted = contract.assert(event('com_order_create', { items: [] }));
    expectTypeOf(asserted.version).toEqualTypeOf<'1.0.0' | '1.1.0'>();
  });

  it('narrows to one version contract once the version is a literal', () => {
    const asserted = contract.assert(event('com_order_create', { items: [] }));
    if (asserted.version === '1.0.0') {
      const narrowed = contract.versions[asserted.version];
      expectTypeOf(narrowed).toEqualTypeOf<typeof v1>();
      // Only reachable once narrowed: the expected-type overload is not
      // callable on a union of version contracts at all.
      expectTypeOf(
        narrowed.assert(
          event('com_order_created', { order_id: 'o' }),
          'com_order_created',
        ).scope,
      ).toEqualTypeOf<'output'>();
    }
  });
});
