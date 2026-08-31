import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { ArvoContractValidationError } from '../../src/ArvoContract/errors.js';
import { ArvoContract } from '../../src/ArvoContract/index.js';
import type { ArvoContractParam } from '../../src/ArvoContract/types.js';
import {
  createArvoContract,
  tryCreateArvoContract,
} from '../../src/factories/createArvoContract.js';

const valid = {
  type: 'com_order_create',
  versions: {
    '1.0.0': {
      input: z.object({ items: z.array(z.string()) }),
      outputs: { com_order_created: z.object({ order_id: z.string() }) },
    },
  },
} as const;

/** Not lowercase_snake_case, and a version key with a leading zero. */
const invalid = {
  type: 'Com_Order_Create',
  versions: { '01.0.0': { input: z.object({}), outputs: {} } },
} as unknown as ArvoContractParam;

describe('tryCreateArvoContract', () => {
  it('builds the contract the constructor would', () => {
    const declared = tryCreateArvoContract(valid);
    expect(declared.ok).toBe(true);
    if (!declared.ok) return;
    expect(declared.value).toBeInstanceOf(ArvoContract);
    expect(declared.value.uri).toBe('#/com/order/create');
    expect(declared.value.versions['1.0.0'].dataschema).toBe(
      '#/com/order/create/1.0.0',
    );
  });

  it('reports an invalid declaration rather than throwing', () => {
    const declared = tryCreateArvoContract(invalid);
    expect(declared.ok).toBe(false);
    if (declared.ok) return;
    expect(declared.error).toBeInstanceOf(ArvoContractValidationError);
    expect(declared.error.issues.length).toBeGreaterThan(0);
  });

  it('reports every rule the declaration broke, as the constructor does', () => {
    const declared = tryCreateArvoContract(invalid);
    let thrown: ArvoContractValidationError | null = null;
    try {
      new ArvoContract(invalid);
    } catch (error) {
      thrown = error as ArvoContractValidationError;
    }
    if (declared.ok) throw new Error('expected the declaration to fail');
    expect(declared.error.message).toBe(thrown?.message);
  });

  it('lets an unrelated failure through rather than reporting it', () => {
    const hostile = {
      type: 'com_order_create',
      versions: new Proxy(
        {},
        {
          ownKeys() {
            throw new TypeError('boom');
          },
        },
      ),
    } as unknown as ArvoContractParam;

    expect(() => tryCreateArvoContract(hostile)).toThrow(TypeError);
  });

  it('keeps each version its own payload type', () => {
    const declared = tryCreateArvoContract({
      type: 'com_order_create',
      versions: {
        '1.0.0': {
          input: z.object({ items: z.array(z.string()) }),
          outputs: {},
        },
        '1.1.0': { input: z.object({ tier: z.string() }), outputs: {} },
      },
    });
    if (!declared.ok) throw declared.error;
    expectTypeOf<
      z.infer<(typeof declared.value.versions)['1.0.0']['input']>
    >().toEqualTypeOf<{ items: string[] }>();
    expectTypeOf<
      z.infer<(typeof declared.value.versions)['1.1.0']['input']>
    >().toEqualTypeOf<{ tier: string }>();
  });
});

describe('createArvoContract', () => {
  it('returns the contract directly', () => {
    const contract = createArvoContract(valid);
    expect(contract).toBeInstanceOf(ArvoContract);
    expect(contract.type).toBe('com_order_create');
  });

  it('throws what the non-throwing form reports', () => {
    const declared = tryCreateArvoContract(invalid);
    if (declared.ok) throw new Error('expected the declaration to fail');
    expect(() => createArvoContract(invalid)).toThrow(
      ArvoContractValidationError,
    );
    expect(() => createArvoContract(invalid)).toThrow(declared.error.message);
  });

  it('agrees with the constructor', () => {
    const built = createArvoContract(valid);
    const constructed = new ArvoContract(valid);
    expect(built.uri).toBe(constructed.uri);
    expect(Object.keys(built.versions)).toEqual(
      Object.keys(constructed.versions),
    );
  });
});
