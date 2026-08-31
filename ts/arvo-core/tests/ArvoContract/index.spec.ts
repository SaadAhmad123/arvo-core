import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContractValidationError } from '../../src/ArvoContract/errors.js';
import { ArvoContract } from '../../src/ArvoContract/index.js';
import { validateVersionedArvoContract } from '../../src/ArvoContract/validator.js';
import { VersionedArvoContract } from '../../src/ArvoContract/versioned/index.js';

const input = z.object({ amount: z.number() });
const emit = z.object({ order_id: z.string() });

const minimal = () =>
  new ArvoContract({
    type: 'com_order_create',
    versions: { '1.0.0': { input, outputs: { com_order_created: emit } } },
  });

describe('ArvoContract', () => {
  describe('minimal declaration', () => {
    it('takes every default', () => {
      const c = minimal();
      expect(c.type).toBe('com_order_create');
      expect(c.uri).toBe('#/com/order/create');
      expect(c.description).toBeNull();
      expect(c.domain).toBeNull();
      expect(c.metadata).toEqual({});
    });

    it('exposes exactly the six fields', () => {
      expect(Object.keys(minimal()).sort()).toEqual([
        'description',
        'domain',
        'metadata',
        'type',
        'uri',
        'versions',
      ]);
    });

    it('keeps supplied optional fields', () => {
      const c = new ArvoContract({
        type: 'com_user_register',
        description: 'Handles registration',
        domain: 'identity_priority',
        metadata: { owner: 'team_identity' },
        versions: { '1.0.0': { input, outputs: {} } },
      });
      expect(c.description).toBe('Handles registration');
      expect(c.domain).toBe('identity_priority');
      expect(c.metadata).toEqual({ owner: 'team_identity' });
    });
  });

  describe('uri derivation', () => {
    it('replaces every underscore, not only the first', () => {
      expect(minimal().uri).toBe('#/com/order/create');
    });

    it('handles a single-segment type', () => {
      const c = new ArvoContract({
        type: 'payment',
        versions: { '1.0.0': { input, outputs: {} } },
      });
      expect(c.uri).toBe('#/payment');
    });

    it('lets an explicit uri win', () => {
      const c = new ArvoContract({
        type: 'com_user_register',
        uri: '#/services/identity/user/registration',
        versions: { '1.0.0': { input, outputs: {} } },
      });
      expect(c.uri).toBe('#/services/identity/user/registration');
    });
  });

  describe('version materialization', () => {
    it('materializes each version as a VersionedArvoContract', () => {
      const v = minimal().versions['1.0.0'];
      expect(v).toBeInstanceOf(VersionedArvoContract);
    });

    it('passes the contract identity down to every version', () => {
      const c = new ArvoContract({
        type: 'com_order_create',
        description: 'Creates orders',
        domain: 'order_priority',
        metadata: { owner: 'team_orders' },
        versions: {
          '1.0.0': { input, outputs: {} },
          '1.1.0': { input, outputs: {} },
        },
      });
      for (const version of ['1.0.0', '1.1.0'] as const) {
        const v = c.versions[version];
        expect(v.type).toBe('com_order_create');
        expect(v.uri).toBe('#/com/order/create');
        expect(v.description).toBe('Creates orders');
        expect(v.domain).toBe('order_priority');
        expect(v.metadata).toEqual({ owner: 'team_orders' });
      }
    });

    it('gives each version its own version and dataschema', () => {
      const c = new ArvoContract({
        type: 'com_order_create',
        versions: {
          '1.0.0': { input, outputs: {} },
          '1.1.0': { input, outputs: {} },
        },
      });
      expect(c.versions['1.0.0'].version).toBe('1.0.0');
      expect(c.versions['1.0.0'].dataschema).toBe('#/com/order/create/1.0.0');
      expect(c.versions['1.1.0'].dataschema).toBe('#/com/order/create/1.1.0');
    });

    it('exposes only the declared versions', () => {
      const c = new ArvoContract({
        type: 'com_order_create',
        versions: {
          '1.0.0': { input, outputs: {} },
          '2.0.0': { input, outputs: {} },
        },
      });
      expect(Object.keys(c.versions).sort()).toEqual(['1.0.0', '2.0.0']);
    });

    it('gives every version a handler error', () => {
      expect(minimal().versions['1.0.0'].error.type).toBe(
        'handler_com_order_create_error',
      );
    });
  });

  describe('version isolation', () => {
    it('lets a later version require a field an earlier one lacks', () => {
      const c = new ArvoContract({
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
      expect(c.versions['1.0.0'].input.safeParse({ items: [] }).success).toBe(
        true,
      );
      expect(c.versions['1.1.0'].input.safeParse({ items: [] }).success).toBe(
        false,
      );
    });

    it('lets two versions declare the same emit with different payloads', () => {
      const c = new ArvoContract({
        type: 'com_order_create',
        versions: {
          '1.0.0': {
            input,
            outputs: { com_order_created: z.object({ order_id: z.string() }) },
          },
          '1.1.0': {
            input,
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
        c.versions['1.0.0'].outputs.com_order_created.safeParse(payload)
          .success,
      ).toBe(true);
      expect(
        c.versions['1.1.0'].outputs.com_order_created.safeParse(payload)
          .success,
      ).toBe(false);
    });
  });

  describe('rejection', () => {
    const rejects = (build: () => unknown): string[] => {
      try {
        build();
      } catch (error) {
        if (!(error instanceof ArvoContractValidationError)) throw error;
        return error.issues.map((i) => i.path);
      }
      throw new Error('expected construction to fail');
    };

    it('rejects a malformed type', () => {
      expect(
        rejects(
          () =>
            new ArvoContract({
              type: 'Com_Order_Create',
              versions: { '1.0.0': { input, outputs: {} } },
            }),
        ),
      ).toContain('type');
    });

    it('rejects an empty versions map', () => {
      expect(
        rejects(
          () => new ArvoContract({ type: 'com_order_create', versions: {} }),
        ),
      ).toContain('versions');
    });

    it('rejects a malformed version key', () => {
      expect(
        rejects(
          () =>
            new ArvoContract({
              type: 'com_order_create',
              versions: { '1.0': { input, outputs: {} } } as never,
            }),
        ),
      ).toContain('versions["1.0"]');
    });

    it('reports problems in both versions, not just the first', () => {
      const reported = rejects(
        () =>
          new ArvoContract({
            type: 'com_order_create',
            versions: {
              '1.0.0': { input, outputs: { Bad_One: emit } },
              '2.0.0': { input, outputs: { Bad_Two: emit } },
            },
          }),
      );
      expect(reported).toContain('versions["1.0.0"].outputs["Bad_One"]');
      expect(reported).toContain('versions["2.0.0"].outputs["Bad_Two"]');
    });

    it('does not partially construct on failure', () => {
      expect(
        () =>
          new ArvoContract({
            type: 'Bad_Type',
            versions: { '1.0.0': { input, outputs: {} } },
          }),
      ).toThrow(ArvoContractValidationError);
    });
  });

  describe('a successful declaration never yields an invalid version', () => {
    it('holds across a range of valid declarations', () => {
      const contracts = [
        minimal(),
        new ArvoContract({
          type: 'payment',
          versions: { '0.0.0': { input, outputs: {} } },
        }),
        new ArvoContract({
          type: 'v2_order_create',
          uri: '#/services/orders',
          description: 'x',
          domain: 'order_priority',
          metadata: { a: 1 },
          versions: {
            '1.0.0': { input, outputs: { com_order_created: emit } },
            '10.20.30': { input, outputs: {} },
          },
        }),
      ];

      for (const contract of contracts) {
        for (const version of Object.values(contract.versions)) {
          const { issues } = validateVersionedArvoContract(version);
          expect(issues).toEqual([]);
        }
      }
    });
  });

  describe('immutability', () => {
    it('freezes the instance', () => {
      const c = minimal();
      expect(Object.isFrozen(c)).toBe(true);
      expect(() => {
        (c as { uri: string }).uri = 'changed';
      }).toThrow();
    });

    it('freezes the versions map', () => {
      expect(Object.isFrozen(minimal().versions)).toBe(true);
    });

    it('freezes metadata', () => {
      const c = new ArvoContract({
        type: 'com_order_create',
        metadata: { a: 1 },
        versions: { '1.0.0': { input, outputs: {} } },
      });
      expect(Object.isFrozen(c.metadata)).toBe(true);
    });

    it('copies metadata, so mutating the input afterwards does not change it', () => {
      const metadata: Record<string, number> = { a: 1 };
      const c = new ArvoContract({
        type: 'com_order_create',
        metadata,
        versions: { '1.0.0': { input, outputs: {} } },
      });
      metadata.b = 2;
      expect(c.metadata).toEqual({ a: 1 });
    });
  });
});
