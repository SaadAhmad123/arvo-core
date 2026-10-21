import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { ArvoContractValidationError } from '../../src/ArvoContract/errors.js';
import { ArvoContract } from '../../src/ArvoContract/index.js';
import type { ArvoContractParam } from '../../src/ArvoContract/types.js';
import {
  createArvoContract,
  tryCreateArvoContract,
} from '../../src/factories/createArvoContract.js';

const validParam = {
  type: 'com_order_create',
  versions: {
    '1.0.0': {
      input: z.object({ items: z.array(z.string()) }),
      outputs: { com_order_created: z.object({ order_id: z.string() }) },
    },
  },
} as const;

/** Not lowercase_snake_case, and a version key with a leading zero. */
const invalidParam = {
  type: 'Com_Order_Create',
  versions: { '01.0.0': { input: z.object({}), outputs: {} } },
} as unknown as ArvoContractParam;

describe('tryCreateArvoContract', () => {
  it('builds the contract the constructor would', () => {
    const createResult = tryCreateArvoContract(validParam);
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;
    expect(createResult.value).toBeInstanceOf(ArvoContract);
    expect(createResult.value.uri).toBe('#/com/order/create');
    expect(createResult.value.versions['1.0.0'].dataschema).toBe(
      '#/com/order/create/1.0.0',
    );
  });

  it('reports an invalid declaration rather than throwing', () => {
    const createResult = tryCreateArvoContract(invalidParam);
    expect(createResult.ok).toBe(false);
    if (createResult.ok) return;
    expect(createResult.error).toBeInstanceOf(ArvoContractValidationError);
    expect(createResult.error.issues.length).toBeGreaterThan(0);
  });

  it('reports every rule the declaration broke, as the constructor does', () => {
    const createResult = tryCreateArvoContract(invalidParam);
    let thrownError: ArvoContractValidationError | null = null;
    try {
      new ArvoContract(invalidParam);
    } catch (thrown) {
      thrownError = thrown as ArvoContractValidationError;
    }
    if (createResult.ok) throw new Error('expected the declaration to fail');
    expect(createResult.error.message).toBe(thrownError?.message);
  });

  it('lets an unrelated failure through rather than reporting it', () => {
    const hostileParam = {
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

    expect(() => tryCreateArvoContract(hostileParam)).toThrow(TypeError);
  });

  it('keeps each version its own payload type', () => {
    const createResult = tryCreateArvoContract({
      type: 'com_order_create',
      versions: {
        '1.0.0': {
          input: z.object({ items: z.array(z.string()) }),
          outputs: {},
        },
        '1.1.0': { input: z.object({ tier: z.string() }), outputs: {} },
      },
    });
    if (!createResult.ok) throw createResult.error;
    expectTypeOf<
      z.infer<(typeof createResult.value.versions)['1.0.0']['input']>
    >().toEqualTypeOf<{ items: string[] }>();
    expectTypeOf<
      z.infer<(typeof createResult.value.versions)['1.1.0']['input']>
    >().toEqualTypeOf<{ tier: string }>();
  });
});

describe('createArvoContract', () => {
  it('returns the contract directly', () => {
    const contract = createArvoContract(validParam);
    expect(contract).toBeInstanceOf(ArvoContract);
    expect(contract.type).toBe('com_order_create');
  });

  it('throws what the non-throwing form reports', () => {
    const createResult = tryCreateArvoContract(invalidParam);
    if (createResult.ok) throw new Error('expected the declaration to fail');
    expect(() => createArvoContract(invalidParam)).toThrow(
      ArvoContractValidationError,
    );
    expect(() => createArvoContract(invalidParam)).toThrow(
      createResult.error.message,
    );
  });

  it('agrees with the constructor', () => {
    const factoryContract = createArvoContract(validParam);
    const constructedContract = new ArvoContract(validParam);
    expect(factoryContract.uri).toBe(constructedContract.uri);
    expect(Object.keys(factoryContract.versions)).toEqual(
      Object.keys(constructedContract.versions),
    );
  });
});
