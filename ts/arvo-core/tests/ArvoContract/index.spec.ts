import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContractValidationError } from '../../src/ArvoContract/errors.js';
import { ArvoContract } from '../../src/ArvoContract/index.js';
import { validateVersionedArvoContract } from '../../src/ArvoContract/validator.js';
import { VersionedArvoContract } from '../../src/ArvoContract/versioned/index.js';

const inputSchema = z.object({ amount: z.number() });
const outputSchema = z.object({ order_id: z.string() });

const minimalContract = () =>
  new ArvoContract({
    type: 'com_order_create',
    versions: {
      '1.0.0': {
        input: inputSchema,
        outputs: { com_order_created: outputSchema },
      },
    },
  });

describe('ArvoContract', () => {
  describe('minimal declaration', () => {
    it('takes every default', () => {
      const contract = minimalContract();
      expect(contract.type).toBe('com_order_create');
      expect(contract.uri).toBe('#/com/order/create');
      expect(contract.description).toBeNull();
      expect(contract.domain).toBeNull();
      expect(contract.metadata).toEqual({});
    });

    it('exposes exactly the six fields', () => {
      expect(Object.keys(minimalContract()).sort()).toEqual([
        'description',
        'domain',
        'metadata',
        'type',
        'uri',
        'versions',
      ]);
    });

    it('keeps supplied optional fields', () => {
      const contract = new ArvoContract({
        type: 'com_user_register',
        description: 'Handles registration',
        domain: 'identity_priority',
        metadata: { owner: 'team_identity' },
        versions: { '1.0.0': { input: inputSchema, outputs: {} } },
      });
      expect(contract.description).toBe('Handles registration');
      expect(contract.domain).toBe('identity_priority');
      expect(contract.metadata).toEqual({ owner: 'team_identity' });
    });
  });

  describe('uri derivation', () => {
    it('replaces every underscore, not only the first', () => {
      expect(minimalContract().uri).toBe('#/com/order/create');
    });

    it('handles a single-segment type', () => {
      const contract = new ArvoContract({
        type: 'payment',
        versions: { '1.0.0': { input: inputSchema, outputs: {} } },
      });
      expect(contract.uri).toBe('#/payment');
    });

    it('lets an explicit uri win', () => {
      const contract = new ArvoContract({
        type: 'com_user_register',
        uri: '#/services/identity/user/registration',
        versions: { '1.0.0': { input: inputSchema, outputs: {} } },
      });
      expect(contract.uri).toBe('#/services/identity/user/registration');
    });
  });

  describe('version materialization', () => {
    it('materializes each version as a VersionedArvoContract', () => {
      const versionedContract = minimalContract().versions['1.0.0'];
      expect(versionedContract).toBeInstanceOf(VersionedArvoContract);
    });

    it('passes the contract identity down to every version', () => {
      const contract = new ArvoContract({
        type: 'com_order_create',
        description: 'Creates orders',
        domain: 'order_priority',
        metadata: { owner: 'team_orders' },
        versions: {
          '1.0.0': { input: inputSchema, outputs: {} },
          '1.1.0': { input: inputSchema, outputs: {} },
        },
      });
      for (const version of ['1.0.0', '1.1.0'] as const) {
        const versionedContract = contract.versions[version];
        expect(versionedContract.type).toBe('com_order_create');
        expect(versionedContract.uri).toBe('#/com/order/create');
        expect(versionedContract.description).toBe('Creates orders');
        expect(versionedContract.domain).toBe('order_priority');
        expect(versionedContract.metadata).toEqual({ owner: 'team_orders' });
      }
    });

    it('gives each version its own version and dataschema', () => {
      const contract = new ArvoContract({
        type: 'com_order_create',
        versions: {
          '1.0.0': { input: inputSchema, outputs: {} },
          '1.1.0': { input: inputSchema, outputs: {} },
        },
      });
      expect(contract.versions['1.0.0'].version).toBe('1.0.0');
      expect(contract.versions['1.0.0'].dataschema).toBe(
        '#/com/order/create/1.0.0',
      );
      expect(contract.versions['1.1.0'].dataschema).toBe(
        '#/com/order/create/1.1.0',
      );
    });

    it('exposes only the declared versions', () => {
      const contract = new ArvoContract({
        type: 'com_order_create',
        versions: {
          '1.0.0': { input: inputSchema, outputs: {} },
          '2.0.0': { input: inputSchema, outputs: {} },
        },
      });
      expect(Object.keys(contract.versions).sort()).toEqual(['1.0.0', '2.0.0']);
    });

    it('gives every version a handler error', () => {
      expect(minimalContract().versions['1.0.0'].error.type).toBe(
        'handler_com_order_create_error',
      );
    });
  });

  describe('version isolation', () => {
    it('lets a later version require a field an earlier one lacks', () => {
      const contract = new ArvoContract({
        type: 'com_order_create',
        versions: {
          '1.0.0': {
            input: z.object({ items: z.array(z.string()) }),
            outputs: {},
          },
          '1.1.0': {
            input: z.object({
              items: z.array(z.string()),
              shipping_tier: z.string(),
            }),
            outputs: {},
          },
        },
      });
      expect(
        contract.versions['1.0.0'].input.safeParse({ items: [] }).success,
      ).toBe(true);
      expect(
        contract.versions['1.1.0'].input.safeParse({ items: [] }).success,
      ).toBe(false);
    });

    it('lets two versions declare the same emit with different payloads', () => {
      const contract = new ArvoContract({
        type: 'com_order_create',
        versions: {
          '1.0.0': {
            input: inputSchema,
            outputs: { com_order_created: z.object({ order_id: z.string() }) },
          },
          '1.1.0': {
            input: inputSchema,
            outputs: {
              com_order_created: z.object({
                order_id: z.string(),
                eta: z.string(),
              }),
            },
          },
        },
      });
      const payload = { order_id: 'o-1' };
      expect(
        contract.versions['1.0.0'].outputs.com_order_created.safeParse(payload)
          .success,
      ).toBe(true);
      expect(
        contract.versions['1.1.0'].outputs.com_order_created.safeParse(payload)
          .success,
      ).toBe(false);
    });
  });

  describe('rejection', () => {
    const rejectionPaths = (construct: () => unknown): string[] => {
      try {
        construct();
      } catch (thrown) {
        if (!(thrown instanceof ArvoContractValidationError)) throw thrown;
        return thrown.issues.map((issue) => issue.path);
      }
      throw new Error('expected construction to fail');
    };

    it('rejects a malformed type', () => {
      expect(
        rejectionPaths(
          () =>
            new ArvoContract({
              type: 'Com_Order_Create',
              versions: { '1.0.0': { input: inputSchema, outputs: {} } },
            }),
        ),
      ).toContain('type');
    });

    it('rejects an empty versions map', () => {
      expect(
        rejectionPaths(
          () => new ArvoContract({ type: 'com_order_create', versions: {} }),
        ),
      ).toContain('versions');
    });

    it('rejects a malformed version key', () => {
      expect(
        rejectionPaths(
          () =>
            new ArvoContract({
              type: 'com_order_create',
              versions: { '1.0': { input: inputSchema, outputs: {} } } as never,
            }),
        ),
      ).toContain('versions["1.0"]');
    });

    it('reports problems in both versions, not just the first', () => {
      const reportedPaths = rejectionPaths(
        () =>
          new ArvoContract({
            type: 'com_order_create',
            versions: {
              '1.0.0': {
                input: inputSchema,
                outputs: { Bad_One: outputSchema },
              },
              '2.0.0': {
                input: inputSchema,
                outputs: { Bad_Two: outputSchema },
              },
            },
          }),
      );
      expect(reportedPaths).toContain('versions["1.0.0"].outputs["Bad_One"]');
      expect(reportedPaths).toContain('versions["2.0.0"].outputs["Bad_Two"]');
    });

    it('does not partially construct on failure', () => {
      expect(
        () =>
          new ArvoContract({
            type: 'Bad_Type',
            versions: { '1.0.0': { input: inputSchema, outputs: {} } },
          }),
      ).toThrow(ArvoContractValidationError);
    });
  });

  describe('a successful declaration never yields an invalid version', () => {
    it('holds across a range of valid declarations', () => {
      const contracts = [
        minimalContract(),
        new ArvoContract({
          type: 'payment',
          versions: { '0.0.0': { input: inputSchema, outputs: {} } },
        }),
        new ArvoContract({
          type: 'v2_order_create',
          uri: '#/services/orders',
          description: 'x',
          domain: 'order_priority',
          metadata: { a: 1 },
          versions: {
            '1.0.0': {
              input: inputSchema,
              outputs: { com_order_created: outputSchema },
            },
            '10.20.30': { input: inputSchema, outputs: {} },
          },
        }),
      ];

      for (const contract of contracts) {
        for (const versionedContract of Object.values(contract.versions)) {
          const { issues } = validateVersionedArvoContract(versionedContract);
          expect(issues).toEqual([]);
        }
      }
    });
  });

  describe('immutability', () => {
    it('freezes the instance', () => {
      const contract = minimalContract();
      expect(Object.isFrozen(contract)).toBe(true);
      expect(() => {
        (contract as { uri: string }).uri = 'changed';
      }).toThrow();
    });

    it('freezes the versions map', () => {
      expect(Object.isFrozen(minimalContract().versions)).toBe(true);
    });

    it('freezes metadata', () => {
      const contract = new ArvoContract({
        type: 'com_order_create',
        metadata: { a: 1 },
        versions: { '1.0.0': { input: inputSchema, outputs: {} } },
      });
      expect(Object.isFrozen(contract.metadata)).toBe(true);
    });

    it('copies metadata, so mutating the input afterwards does not change it', () => {
      const metadata: Record<string, number> = { a: 1 };
      const contract = new ArvoContract({
        type: 'com_order_create',
        metadata,
        versions: { '1.0.0': { input: inputSchema, outputs: {} } },
      });
      metadata.b = 2;
      expect(contract.metadata).toEqual({ a: 1 });
    });
  });
});
