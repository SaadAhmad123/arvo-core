import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContractValidationError } from '../../src/ArvoContract/errors.js';
import { HANDLER_ERROR_SCHEMA } from '../../src/ArvoContract/handler-error.js';
import { VersionedArvoContract } from '../../src/ArvoContract/versioned/index.js';
import type { VersionedArvoContractParam } from '../../src/ArvoContract/versioned/types.js';

const inputSchema = z.object({ amount: z.number() });
const outputSchema = z.object({ order_id: z.string() });

const validParam = (
  overrides: Partial<VersionedArvoContractParam> = {},
): VersionedArvoContractParam =>
  ({
    type: 'com_order_create',
    version: '1.0.0',
    uri: '#/com/order/create',
    description: null,
    domain: null,
    metadata: {},
    input: inputSchema,
    outputs: { com_order_created: outputSchema },
    ...overrides,
  }) as any;

describe('VersionedArvoContract', () => {
  describe('a valid version', () => {
    it('carries its contract identity and its own schemas', () => {
      const versionedContract = new VersionedArvoContract(validParam());
      expect(versionedContract.type).toBe('com_order_create');
      expect(versionedContract.version).toBe('1.0.0');
      expect(versionedContract.uri).toBe('#/com/order/create');
      expect(versionedContract.description).toBeNull();
      expect(versionedContract.domain).toBeNull();
      expect(versionedContract.metadata).toEqual({});
      expect(versionedContract.input).toBe(inputSchema);
      expect(Object.keys(versionedContract.outputs)).toEqual([
        'com_order_created',
      ]);
    });

    it('keeps a supplied description, domain, and metadata', () => {
      const versionedContract = new VersionedArvoContract(
        validParam({
          description: 'Creates orders',
          domain: 'order_priority',
          metadata: { owner: 'team_orders' },
        }),
      );
      expect(versionedContract.description).toBe('Creates orders');
      expect(versionedContract.domain).toBe('order_priority');
      expect(versionedContract.metadata).toEqual({ owner: 'team_orders' });
    });
  });

  describe('dataschema', () => {
    it('joins uri and version', () => {
      expect(new VersionedArvoContract(validParam()).dataschema).toBe(
        '#/com/order/create/1.0.0',
      );
    });

    it('follows the version, not the contract', () => {
      expect(
        new VersionedArvoContract(validParam({ version: '2.3.4' })).dataschema,
      ).toBe('#/com/order/create/2.3.4');
    });

    it('follows an explicit uri', () => {
      expect(
        new VersionedArvoContract(validParam({ uri: '#/services/orders' }))
          .dataschema,
      ).toBe('#/services/orders/1.0.0');
    });
  });

  describe('handler error', () => {
    it('is derived from the contract type', () => {
      expect(new VersionedArvoContract(validParam()).error.type).toBe(
        'handler_com_order_create_error',
      );
    });

    it('is present when outputs is empty', () => {
      const versionedContract = new VersionedArvoContract(
        validParam({ outputs: {} }),
      );
      expect(Object.keys(versionedContract.outputs)).toEqual([]);
      expect(versionedContract.error.type).toBe(
        'handler_com_order_create_error',
      );
      expect(versionedContract.error.schema).toBe(HANDLER_ERROR_SCHEMA);
    });

    it('is not one of the declared outputs', () => {
      const versionedContract = new VersionedArvoContract(validParam());
      expect(Object.keys(versionedContract.outputs)).not.toContain(
        'handler_com_order_create_error',
      );
    });

    it('carries the same payload shape across versions', () => {
      const version100 = new VersionedArvoContract(
        validParam({ version: '1.0.0' }),
      );
      const version200 = new VersionedArvoContract(
        validParam({ version: '2.0.0' }),
      );
      expect(version100.error.schema).toBe(version200.error.schema);
    });
  });

  describe('rejects on the same rules a contract applies', () => {
    const rejectionPaths = (
      overrides: Partial<VersionedArvoContractParam>,
    ): string[] => {
      try {
        new VersionedArvoContract(validParam(overrides));
      } catch (error_) {
        if (!(error_ instanceof ArvoContractValidationError)) throw error_;
        return error_.issues.map((issue) => issue.path);
      }
      throw new Error('expected construction to fail');
    };

    it('rejects a malformed type', () => {
      expect(rejectionPaths({ type: 'Com_Order_Create' })).toContain('type');
    });

    it('rejects a non-canonical uri', () => {
      expect(rejectionPaths({ uri: 'a/../b' })).toContain('uri');
    });

    it('rejects a malformed version', () => {
      expect(rejectionPaths({ version: '1.0' as never })).toContain('version');
    });

    it('rejects a malformed domain', () => {
      expect(rejectionPaths({ domain: 'order.priority' })).toContain('domain');
    });

    it('rejects a non-object input', () => {
      expect(rejectionPaths({ input: z.string() as never })).toContain('input');
    });

    it('rejects a malformed emit key', () => {
      expect(rejectionPaths({ outputs: { Bad_Key: outputSchema } })).toContain(
        'outputs["Bad_Key"]',
      );
    });

    it('rejects an emit key reusing the contract type', () => {
      expect(
        rejectionPaths({ outputs: { com_order_create: outputSchema } }),
      ).toContain('outputs["com_order_create"]');
    });

    it('rejects an emit key reusing the handler error type', () => {
      expect(
        rejectionPaths({
          outputs: { handler_com_order_create_error: outputSchema },
        }),
      ).toContain('outputs["handler_com_order_create_error"]');
    });

    it('reports every problem at once', () => {
      // Not `type` -- that blocks the run by design, so it would assert the
      // opposite of the prerequisite rule.
      expect(
        rejectionPaths({
          domain: 'Bad',
          uri: '',
          outputs: { Bad_Key: outputSchema },
        }).length,
      ).toBeGreaterThanOrEqual(3);
    });

    it('reports an invalid type alone, and says the list is partial', () => {
      expect(
        rejectionPaths({
          type: 'Bad',
          uri: '',
          outputs: { Bad_Key: outputSchema },
        }),
      ).toEqual(['type']);
    });

    it('throws ArvoContractValidationError', () => {
      expect(
        () => new VersionedArvoContract(validParam({ type: 'Bad' })),
      ).toThrow(ArvoContractValidationError);
    });
  });

  describe('immutability', () => {
    it('freezes the instance', () => {
      const versionedContract = new VersionedArvoContract(validParam());
      expect(Object.isFrozen(versionedContract)).toBe(true);
      expect(() => {
        (versionedContract as { uri: string }).uri = 'changed';
      }).toThrow();
    });

    it('freezes metadata', () => {
      const versionedContract = new VersionedArvoContract(
        validParam({ metadata: { a: 1 } }),
      );
      expect(Object.isFrozen(versionedContract.metadata)).toBe(true);
    });

    it('freezes outputs', () => {
      const versionedContract = new VersionedArvoContract(validParam());
      expect(Object.isFrozen(versionedContract.outputs)).toBe(true);
    });

    it('copies metadata, so mutating the input afterwards does not change it', () => {
      const metadata: Record<string, number> = { a: 1 };
      const versionedContract = new VersionedArvoContract(
        validParam({ metadata }),
      );
      metadata.b = 2;
      expect(versionedContract.metadata).toEqual({ a: 1 });
    });

    it('copies outputs, so mutating the input afterwards does not change it', () => {
      const outputs: Record<string, typeof outputSchema> = {
        com_order_created: outputSchema,
      };
      const versionedContract = new VersionedArvoContract(
        validParam({ outputs }),
      );
      outputs.com_order_shipped = outputSchema;
      expect(Object.keys(versionedContract.outputs)).toEqual([
        'com_order_created',
      ]);
    });
  });
});
