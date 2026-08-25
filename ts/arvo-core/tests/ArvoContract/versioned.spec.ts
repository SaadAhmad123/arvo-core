import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContractValidationError } from '../../src/ArvoContract/errors.js';
import { HANDLER_ERROR_SCHEMA } from '../../src/ArvoContract/handler-error.js';
import { VersionedArvoContract } from '../../src/ArvoContract/versioned/index.js';
import type { VersionedArvoContractParam } from '../../src/ArvoContract/versioned/types.js';

const accepts = z.object({ amount: z.number() });
const emit = z.object({ order_id: z.string() });

const param = (
  over: Partial<VersionedArvoContractParam> = {},
): VersionedArvoContractParam =>
  ({
    type: 'com_order_create',
    version: '1.0.0',
    uri: '#/com/order/create',
    description: null,
    domain: null,
    metadata: {},
    accepts,
    emits: { com_order_created: emit },
    ...over,
  }) as any;

describe('VersionedArvoContract', () => {
  describe('a valid version', () => {
    it('carries its contract identity and its own schemas', () => {
      const v = new VersionedArvoContract(param());
      expect(v.type).toBe('com_order_create');
      expect(v.version).toBe('1.0.0');
      expect(v.uri).toBe('#/com/order/create');
      expect(v.description).toBeNull();
      expect(v.domain).toBeNull();
      expect(v.metadata).toEqual({});
      expect(v.accepts).toBe(accepts);
      expect(Object.keys(v.emits)).toEqual(['com_order_created']);
    });

    it('keeps a supplied description, domain, and metadata', () => {
      const v = new VersionedArvoContract(
        param({
          description: 'Creates orders',
          domain: 'order_priority',
          metadata: { owner: 'team_orders' },
        }),
      );
      expect(v.description).toBe('Creates orders');
      expect(v.domain).toBe('order_priority');
      expect(v.metadata).toEqual({ owner: 'team_orders' });
    });
  });

  describe('dataschema', () => {
    it('joins uri and version', () => {
      expect(new VersionedArvoContract(param()).dataschema).toBe(
        '#/com/order/create/1.0.0',
      );
    });

    it('follows the version, not the contract', () => {
      expect(
        new VersionedArvoContract(param({ version: '2.3.4' })).dataschema,
      ).toBe('#/com/order/create/2.3.4');
    });

    it('follows an explicit uri', () => {
      expect(
        new VersionedArvoContract(param({ uri: '#/services/orders' }))
          .dataschema,
      ).toBe('#/services/orders/1.0.0');
    });
  });

  describe('handler error', () => {
    it('is derived from the contract type', () => {
      expect(new VersionedArvoContract(param()).handlerError.type).toBe(
        'handler_com_order_create_error',
      );
    });

    it('is present when emits is empty', () => {
      const v = new VersionedArvoContract(param({ emits: {} }));
      expect(Object.keys(v.emits)).toEqual([]);
      expect(v.handlerError.type).toBe('handler_com_order_create_error');
      expect(v.handlerError.schema).toBe(HANDLER_ERROR_SCHEMA);
    });

    it('is not one of the declared emits', () => {
      const v = new VersionedArvoContract(param());
      expect(Object.keys(v.emits)).not.toContain(
        'handler_com_order_create_error',
      );
    });

    it('carries the same payload shape across versions', () => {
      const a = new VersionedArvoContract(param({ version: '1.0.0' }));
      const b = new VersionedArvoContract(param({ version: '2.0.0' }));
      expect(a.handlerError.schema).toBe(b.handlerError.schema);
    });
  });

  describe('rejects on the same rules a contract applies', () => {
    const rejects = (over: Partial<VersionedArvoContractParam>): string[] => {
      try {
        new VersionedArvoContract(param(over));
      } catch (error) {
        if (!(error instanceof ArvoContractValidationError)) throw error;
        return error.issues.map((i) => i.path);
      }
      throw new Error('expected construction to fail');
    };

    it('rejects a malformed type', () => {
      expect(rejects({ type: 'Com_Order_Create' })).toContain('type');
    });

    it('rejects a non-canonical uri', () => {
      expect(rejects({ uri: 'a/../b' })).toContain('uri');
    });

    it('rejects a malformed version', () => {
      expect(rejects({ version: '1.0' as never })).toContain('version');
    });

    it('rejects a malformed domain', () => {
      expect(rejects({ domain: 'order.priority' })).toContain('domain');
    });

    it('rejects a non-object accepts', () => {
      expect(rejects({ accepts: z.string() as never })).toContain('accepts');
    });

    it('rejects a malformed emit key', () => {
      expect(rejects({ emits: { Bad_Key: emit } })).toContain(
        'emits["Bad_Key"]',
      );
    });

    it('rejects an emit key reusing the contract type', () => {
      expect(rejects({ emits: { com_order_create: emit } })).toContain(
        'emits["com_order_create"]',
      );
    });

    it('rejects an emit key reusing the handler error type', () => {
      expect(
        rejects({ emits: { handler_com_order_create_error: emit } }),
      ).toContain('emits["handler_com_order_create_error"]');
    });

    it('reports every problem at once', () => {
      expect(
        rejects({ type: 'Bad', uri: '', emits: { Bad_Key: emit } }).length,
      ).toBeGreaterThanOrEqual(3);
    });

    it('throws ArvoContractValidationError', () => {
      expect(() => new VersionedArvoContract(param({ type: 'Bad' }))).toThrow(
        ArvoContractValidationError,
      );
    });
  });

  describe('immutability', () => {
    it('freezes the instance', () => {
      const v = new VersionedArvoContract(param());
      expect(Object.isFrozen(v)).toBe(true);
      expect(() => {
        (v as { uri: string }).uri = 'changed';
      }).toThrow();
    });

    it('freezes metadata', () => {
      const v = new VersionedArvoContract(param({ metadata: { a: 1 } }));
      expect(Object.isFrozen(v.metadata)).toBe(true);
    });

    it('freezes emits', () => {
      const v = new VersionedArvoContract(param());
      expect(Object.isFrozen(v.emits)).toBe(true);
    });

    it('copies metadata, so mutating the input afterwards does not change it', () => {
      const metadata: Record<string, number> = { a: 1 };
      const v = new VersionedArvoContract(param({ metadata }));
      metadata.b = 2;
      expect(v.metadata).toEqual({ a: 1 });
    });

    it('copies emits, so mutating the input afterwards does not change it', () => {
      const emits: Record<string, typeof emit> = { com_order_created: emit };
      const v = new VersionedArvoContract(param({ emits }));
      emits.com_order_shipped = emit;
      expect(Object.keys(v.emits)).toEqual(['com_order_created']);
    });
  });
});
