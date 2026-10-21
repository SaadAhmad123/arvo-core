import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ArvoContractParam } from '../../src/ArvoContract/types.js';
import {
  validateArvoContract,
  validateVersionedArvoContract,
} from '../../src/ArvoContract/validator.js';
import type { VersionedArvoContractParam } from '../../src/ArvoContract/versioned/types.js';

const inputSchema = z.object({ amount: z.number() });
const outputSchema = z.object({ order_id: z.string() });

/** A declaration that passes, so each test can break exactly one thing. */
const validDeclaration = (
  overrides: Partial<ArvoContractParam> = {},
): ArvoContractParam =>
  ({
    type: 'com_order_create',
    versions: {
      '1.0.0': {
        input: inputSchema,
        outputs: { com_order_created: outputSchema },
      },
    },
    ...overrides,
  }) as any;

/** `path: message` lines, which is what a reader actually acts on. */
const issueLines = (param: Partial<ArvoContractParam>): string[] =>
  validateArvoContract(validDeclaration(param)).issues.map(
    (issue) => `${issue.path}: ${issue.message}`,
  );

const issuePaths = (param: Partial<ArvoContractParam>): string[] =>
  validateArvoContract(validDeclaration(param)).issues.map(
    (issue) => issue.path,
  );

describe('validateArvoContract', () => {
  describe('accepts a well-formed declaration', () => {
    it('reports nothing for the minimal case', () => {
      expect(validateArvoContract(validDeclaration()).issues).toEqual([]);
    });

    it('reports nothing when every optional field is supplied', () => {
      expect(
        issueLines({
          uri: '#/services/orders',
          description: 'Creates orders',
          domain: 'order_priority',
          metadata: { owner: 'team_orders' },
        }),
      ).toEqual([]);
    });
  });

  describe('normalization runs before validation', () => {
    /** What a declaration normalizes to, for one that is not blocked. */
    const normalizedContract = (
      ...validatorArgs: Parameters<typeof validateArvoContract>
    ) => {
      const validation = validateArvoContract(...validatorArgs);
      if (validation.blocked) throw new Error('expected a normalized contract');
      return validation.value;
    };

    it('derives uri from type, replacing every underscore', () => {
      expect(normalizedContract(validDeclaration()).uri).toBe(
        '#/com/order/create',
      );
    });

    it('derives uri for a single-segment type', () => {
      expect(
        normalizedContract(validDeclaration({ type: 'payment' })).uri,
      ).toBe('#/payment');
    });

    it('keeps an explicit uri', () => {
      expect(
        normalizedContract(validDeclaration({ uri: '#/services/orders' })).uri,
      ).toBe('#/services/orders');
    });

    it('materializes the optional fields at their defaults', () => {
      const contract = normalizedContract(validDeclaration());
      expect(contract.description).toBeNull();
      expect(contract.domain).toBeNull();
      expect(contract.metadata).toEqual({});
    });

    it('derives a uri that always passes its own validation', () => {
      // This used to be shown the other way round -- an invalid type derived
      // a uri and both were reported. `type` is now checked first and stops
      // the run, so a derived uri is only ever built from a valid type, and
      // ADR-005's grammar guarantees the result is well formed. There is no
      // observable failing case left; what is left to pin is the invariant
      // that makes the gate safe.
      for (const type of ['payment', 'com_order_create', 'a1_b2_c3']) {
        expect(issuePaths({ type })).not.toContain('uri');
      }
    });
  });

  describe('type', () => {
    it('rejects uppercase', () => {
      expect(issueLines({ type: 'Com_Order_Create' })).toContainEqual(
        expect.stringContaining('type: must be lowercase'),
      );
    });

    it('rejects a dotted identifier', () => {
      expect(issuePaths({ type: 'com.order.create' })).toContain('type');
    });

    it('rejects a leading underscore', () => {
      expect(issuePaths({ type: '_com_order' })).toContain('type');
    });

    it('rejects a trailing underscore', () => {
      expect(issuePaths({ type: 'com_order_' })).toContain('type');
    });

    it('rejects consecutive underscores', () => {
      expect(issuePaths({ type: 'com__order' })).toContain('type');
    });

    it('rejects an empty string', () => {
      expect(issuePaths({ type: '' })).toContain('type');
    });

    it('rejects a non-string', () => {
      expect(issuePaths({ type: 42 as unknown as string })).toContain('type');
    });

    it('accepts digits within a segment', () => {
      expect(issueLines({ type: 'v2_order_create' })).toEqual([]);
    });
  });

  describe('uri', () => {
    it('rejects an empty explicit uri', () => {
      expect(issuePaths({ uri: '' })).toContain('uri');
    });

    it('rejects a non-canonical uri', () => {
      expect(issuePaths({ uri: 'HTTPS://example.com/orders' })).toContain(
        'uri',
      );
      expect(issuePaths({ uri: 'a/../b' })).toContain('uri');
    });

    it('rejects a non-string uri', () => {
      expect(issuePaths({ uri: 7 as unknown as string })).toContain('uri');
    });
  });

  describe('domain', () => {
    it('accepts null', () => {
      expect(issueLines({ domain: undefined })).toEqual([]);
    });

    it('rejects a dotted domain', () => {
      expect(issuePaths({ domain: 'order.priority' })).toContain('domain');
    });

    it('rejects uppercase', () => {
      expect(issuePaths({ domain: 'Order_Priority' })).toContain('domain');
    });

    it('accepts a valid identifier', () => {
      expect(issueLines({ domain: 'order_priority' })).toEqual([]);
    });
  });

  describe('description and metadata', () => {
    it('rejects a non-string description', () => {
      expect(issuePaths({ description: 5 as unknown as string })).toContain(
        'description',
      );
    });

    it('rejects non-object metadata', () => {
      expect(issuePaths({ metadata: 'nope' as never })).toContain('metadata');
      expect(issuePaths({ metadata: [] as never })).toContain('metadata');
    });
  });

  describe('versions', () => {
    it('rejects an empty versions map', () => {
      expect(issueLines({ versions: {} })).toEqual([
        'versions: must declare at least one version',
      ]);
    });

    it('rejects a non-object versions', () => {
      expect(issueLines({ versions: null as never })).toEqual([
        'versions: must be an object',
      ]);
    });

    it('rejects a pre-release version key', () => {
      expect(
        issuePaths({
          versions: {
            '1.0.0-beta': { input: inputSchema, outputs: {} },
          } as never,
        }),
      ).toContain('versions["1.0.0-beta"]');
    });

    it('rejects build metadata in a version key', () => {
      expect(
        issuePaths({
          versions: {
            '1.0.0+build': { input: inputSchema, outputs: {} },
          } as never,
        }),
      ).toContain('versions["1.0.0+build"]');
    });

    it('rejects leading zeros in a version key', () => {
      expect(
        issuePaths({
          versions: { '01.0.0': { input: inputSchema, outputs: {} } } as never,
        }),
      ).toContain('versions["01.0.0"]');
    });

    it('rejects a partial version key', () => {
      expect(
        issuePaths({
          versions: { '1.0': { input: inputSchema, outputs: {} } } as never,
        }),
      ).toContain('versions["1.0"]');
    });

    it('rejects a non-object version definition', () => {
      expect(issueLines({ versions: { '1.0.0': null } as never })).toEqual([
        'versions["1.0.0"]: must be an object',
      ]);
    });
  });

  describe('input and outputs schemas', () => {
    it('rejects a missing input', () => {
      expect(
        issuePaths({ versions: { '1.0.0': { outputs: {} } } as never }),
      ).toContain('versions["1.0.0"].input');
    });

    it('rejects a non-object input schema', () => {
      expect(
        issuePaths({
          versions: { '1.0.0': { input: z.string(), outputs: {} } } as never,
        }),
      ).toContain('versions["1.0.0"].input');
    });

    it('rejects an array input schema', () => {
      expect(
        issuePaths({
          versions: {
            '1.0.0': { input: z.array(z.string()), outputs: {} },
          } as never,
        }),
      ).toContain('versions["1.0.0"].input');
    });

    it('rejects a value that is not a schema at all', () => {
      expect(
        issuePaths({
          versions: { '1.0.0': { input: { a: 1 }, outputs: {} } } as never,
        }),
      ).toContain('versions["1.0.0"].input');
    });

    it('rejects a non-object outputs schema', () => {
      expect(
        issuePaths({
          versions: {
            '1.0.0': {
              input: inputSchema,
              outputs: { com_order_created: z.string() },
            },
          } as never,
        }),
      ).toContain('versions["1.0.0"].outputs["com_order_created"]');
    });

    it('rejects a non-object outputs map', () => {
      expect(
        issuePaths({
          versions: { '1.0.0': { input: inputSchema, outputs: 5 } } as never,
        }),
      ).toContain('versions["1.0.0"].outputs');
    });

    it('permits an empty outputs', () => {
      expect(
        issueLines({
          versions: { '1.0.0': { input: inputSchema, outputs: {} } },
        }),
      ).toEqual([]);
    });
  });

  describe('emit keys', () => {
    it('rejects a dotted emit key', () => {
      expect(
        issuePaths({
          versions: {
            '1.0.0': {
              input: inputSchema,
              outputs: { 'com.created': outputSchema },
            },
          },
        }),
      ).toContain('versions["1.0.0"].outputs["com.created"]');
    });

    it('rejects an uppercase emit key', () => {
      expect(
        issuePaths({
          versions: {
            '1.0.0': {
              input: inputSchema,
              outputs: { Com_Created: outputSchema },
            },
          },
        }),
      ).toContain('versions["1.0.0"].outputs["Com_Created"]');
    });

    it('rejects an emit key equal to the contract type', () => {
      expect(
        issueLines({
          versions: {
            '1.0.0': {
              input: inputSchema,
              outputs: { com_order_create: outputSchema },
            },
          },
        }),
      ).toContainEqual(
        expect.stringContaining('must not reuse the contract type'),
      );
    });

    it('rejects an emit key equal to the handler error type', () => {
      expect(
        issueLines({
          versions: {
            '1.0.0': {
              input: inputSchema,
              outputs: { handler_com_order_create_error: outputSchema },
            },
          },
        }),
      ).toContainEqual(
        expect.stringContaining('must not reuse the handler error type'),
      );
    });

    it("permits an emit key matching another contract's handler error type", () => {
      expect(
        issueLines({
          versions: {
            '1.0.0': {
              input: inputSchema,
              outputs: { handler_com_payment_process_error: outputSchema },
            },
          },
        }),
      ).toEqual([]);
    });
  });

  describe('reports every failure, not the first', () => {
    it('reports four independent problems at once', () => {
      // `domain` rather than `type` as the non-version fault: `type` blocks
      // the run by design, so using it here would assert the opposite of
      // what the prerequisite rule promises.
      const reportedIssues = issueLines({
        domain: 'Bad_Domain',
        versions: {
          '01.0.0': {
            input: inputSchema,
            outputs: { Bad_Key: outputSchema, 'also.bad': outputSchema },
          },
        } as never,
      });
      expect(reportedIssues).toContainEqual(expect.stringContaining('domain:'));
      expect(reportedIssues).toContainEqual(
        expect.stringContaining('versions["01.0.0"]:'),
      );
      expect(reportedIssues).toContainEqual(
        expect.stringContaining('outputs["Bad_Key"]'),
      );
      expect(reportedIssues).toContainEqual(
        expect.stringContaining('outputs["also.bad"]'),
      );
    });

    it('reports problems in both versions', () => {
      const reportedIssues = issuePaths({
        versions: {
          '1.0.0': { input: inputSchema, outputs: { Bad_One: outputSchema } },
          '2.0.0': { input: inputSchema, outputs: { Bad_Two: outputSchema } },
        },
      });
      expect(reportedIssues).toContain('versions["1.0.0"].outputs["Bad_One"]');
      expect(reportedIssues).toContain('versions["2.0.0"].outputs["Bad_Two"]');
    });

    it('shows the offending value alongside the rule', () => {
      const issue = validateArvoContract(validDeclaration({ type: 'Bad_Type' }))
        .issues[0];
      expect(issue?.received).toBe('Bad_Type');
    });
  });

  describe('an invalid type stops the run', () => {
    const invalidFields = { type: 'Bad_Type', domain: 'Bad', uri: 'NOT A URI' };

    it('reports the type alone, whatever else is wrong', () => {
      expect(issuePaths(invalidFields)).toEqual(['type']);
    });

    it('marks the issue as the one that blocked the rest', () => {
      const [issue] = validateArvoContract(
        validDeclaration(invalidFields),
      ).issues;
      expect(issue?.isBlocking).toBe(true);
      expect(issue?.blockingReason).toContain('derived from it');
    });

    it('says so in the rendered issue', () => {
      const [issue] = validateArvoContract(
        validDeclaration({ type: 'Bad_Type' }),
      ).issues;
      expect(issue?.toString()).toContain('nothing after this was checked');
    });

    it('reports no uri when there was none to derive one from', () => {
      // The old behaviour reported `uri: must be a non-empty string
      // (received "")` here -- a value the caller never supplied.
      expect(issuePaths({ type: 42 as never })).toEqual(['type']);
    });

    it("still reports a supplied uri, which is the caller's to answer for", () => {
      expect(issuePaths({ uri: '' })).toContain('uri');
    });

    it('leaves no normalized contract to read', () => {
      const validation = validateArvoContract(
        validDeclaration({ type: 'Bad_Type' }),
      );
      expect(validation.blocked).toBe(true);
    });

    it('does not block when the type is valid', () => {
      const validation = validateArvoContract(
        validDeclaration({ domain: 'Bad' }),
      );
      expect(validation.blocked).toBe(false);
      expect(validation.issues[0]?.isBlocking).toBe(false);
    });
  });
});

describe('validateVersionedArvoContract', () => {
  const validVersion = (
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

  it('accepts a well-formed version', () => {
    expect(validateVersionedArvoContract(validVersion()).issues).toEqual([]);
  });

  it('applies the same emit-key rule as a contract does', () => {
    const issues = validateVersionedArvoContract(
      validVersion({ outputs: { Bad_Key: outputSchema } }),
    ).issues;
    expect(issues.map((issue) => issue.path)).toContain('outputs["Bad_Key"]');
  });

  it('applies the same collision rules', () => {
    expect(
      validateVersionedArvoContract(
        validVersion({ outputs: { com_order_create: outputSchema } }),
      ).issues.map((issue) => issue.message),
    ).toContainEqual(expect.stringContaining('must not reuse the contract'));
  });

  it('validates its own identity fields', () => {
    const issues = validateVersionedArvoContract(
      validVersion({ uri: '', version: '1.0' as never, domain: 'Bad' }),
    ).issues;
    const reportedIssues = issues.map((issue) => issue.path);
    expect(reportedIssues).toContain('uri');
    expect(reportedIssues).toContain('version');
    expect(reportedIssues).toContain('domain');
  });

  it('does not crash deriving the error type when type is not a string', () => {
    const issues = validateVersionedArvoContract(
      validVersion({
        type: 42 as never,
        outputs: { com_order_created: outputSchema },
      }),
    ).issues;
    expect(issues.map((issue) => issue.path)).toContain('type');
  });

  it('reports paths without a versions prefix, since there is no container', () => {
    const issues = validateVersionedArvoContract(
      validVersion({ input: z.string() as never }),
    ).issues;
    expect(issues.map((issue) => issue.path)).toContain('input');
  });
});
