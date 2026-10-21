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

const version100 = contract.versions['1.0.0'];

const event = (type: string, data: Record<string, unknown>) =>
  new ArvoEvent({
    source: 'com.test.suite',
    subject: 'order-1',
    type,
    dataschema: version100.dataschema,
    data,
  });

describe('what an expectation narrows', () => {
  it('narrows the scope to one literal per shape', () => {
    const assertedInput = version100.assert(
      event('com_order_create', { items: [] }),
      'com_order_create',
    );
    const assertedOutput = version100.assert(
      event('com_order_created', { order_id: 'o' }),
      'com_order_created',
    );
    const assertedError = version100.assert(
      event(version100.error.type, {
        error_name: 'E',
        error_message: 'm',
        error_stack: null,
      }),
      'handler_com_order_create_error',
    );

    expectTypeOf(assertedInput.scope).toEqualTypeOf<'input'>();
    expectTypeOf(assertedOutput.scope).toEqualTypeOf<'output'>();
    expectTypeOf(assertedError.scope).toEqualTypeOf<'error'>();
  });

  it('gives the payload the expected shape declares', () => {
    const assertedOutput = version100.assert(
      event('com_order_created', { order_id: 'o' }),
      'com_order_created',
    );
    expectTypeOf(assertedOutput.event.data).toEqualTypeOf<{
      order_id: string;
    }>();
    expectTypeOf(
      assertedOutput.event.type,
    ).toEqualTypeOf<'com_order_created'>();
  });

  it('leaves the scope wide and the payload unparameterised without one', () => {
    const assertedInput = version100.assert(
      event('com_order_create', { items: [] }),
    );
    expectTypeOf(assertedInput.scope).toEqualTypeOf<
      'input' | 'output' | 'error'
    >();
    expectTypeOf(assertedInput.version).toEqualTypeOf<'1.0.0'>();
  });

  it('refuses a type the version does not declare', () => {
    expect(() =>
      // @ts-expect-error not a type this version declares
      version100.assert(event('com_order_create', { items: [] }), 'com_nope'),
    ).toThrow();
  });

  it('refuses a plain string where a literal is wanted', () => {
    const typeString: string = 'com_order_create';
    expect(() =>
      // @ts-expect-error a string variable is not an assertable literal
      version100.assert(event('com_order_create', { items: [] }), typeString),
    ).not.toThrow();
  });
});

describe('what a contract reports', () => {
  it('reports the union of its declared versions', () => {
    const assertedEvent = contract.assert(
      event('com_order_create', { items: [] }),
    );
    expectTypeOf(assertedEvent.version).toEqualTypeOf<'1.0.0' | '1.1.0'>();
  });

  it('narrows to one version contract once the version is a literal', () => {
    const assertedEvent = contract.assert(
      event('com_order_create', { items: [] }),
    );
    if (assertedEvent.version === '1.0.0') {
      const narrowedVersion = contract.versions[assertedEvent.version];
      expectTypeOf(narrowedVersion).toEqualTypeOf<typeof version100>();
      // Only reachable once narrowed: the expected-type overload is not
      // callable on a union of version contracts at all.
      expectTypeOf(
        narrowedVersion.assert(
          event('com_order_created', { order_id: 'o' }),
          'com_order_created',
        ).scope,
      ).toEqualTypeOf<'output'>();
    }
  });
});
