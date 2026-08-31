import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ArvoContractParam } from '../../src/ArvoContract/types.js';
import {
  validateArvoContract,
  validateVersionedArvoContract,
} from '../../src/ArvoContract/validator.js';
import type { VersionedArvoContractParam } from '../../src/ArvoContract/versioned/types.js';

const input = z.object({ amount: z.number() });
const emit = z.object({ order_id: z.string() });

/** A declaration that passes, so each test can break exactly one thing. */
const valid = (over: Partial<ArvoContractParam> = {}): ArvoContractParam =>
  ({
    type: 'com_order_create',
    versions: { '1.0.0': { input, outputs: { com_order_created: emit } } },
    ...over,
  }) as any;

/** `path: message` lines, which is what a reader actually acts on. */
const issuesOf = (param: Partial<ArvoContractParam>): string[] =>
  validateArvoContract(valid(param)).issues.map(
    (i) => `${i.path}: ${i.message}`,
  );

const paths = (param: Partial<ArvoContractParam>): string[] =>
  validateArvoContract(valid(param)).issues.map((i) => i.path);

describe('validateArvoContract', () => {
  describe('accepts a well-formed declaration', () => {
    it('reports nothing for the minimal case', () => {
      expect(validateArvoContract(valid()).issues).toEqual([]);
    });

    it('reports nothing when every optional field is supplied', () => {
      expect(
        issuesOf({
          uri: '#/services/orders',
          description: 'Creates orders',
          domain: 'order_priority',
          metadata: { owner: 'team_orders' },
        }),
      ).toEqual([]);
    });
  });

  describe('normalization runs before validation', () => {
    it('derives uri from type, replacing every underscore', () => {
      expect(validateArvoContract(valid()).value.uri).toBe(
        '#/com/order/create',
      );
    });

    it('derives uri for a single-segment type', () => {
      expect(validateArvoContract(valid({ type: 'payment' })).value.uri).toBe(
        '#/payment',
      );
    });

    it('keeps an explicit uri', () => {
      expect(
        validateArvoContract(valid({ uri: '#/services/orders' })).value.uri,
      ).toBe('#/services/orders');
    });

    it('materializes the optional fields at their defaults', () => {
      const { value } = validateArvoContract(valid());
      expect(value.description).toBeNull();
      expect(value.domain).toBeNull();
      expect(value.metadata).toEqual({});
    });

    it('derives a uri that always passes its own validation', () => {
      // This used to be shown the other way round -- an invalid type derived
      // a uri and both were reported. `type` is now checked first and stops
      // the run, so a derived uri is only ever built from a valid type, and
      // ADR-005's grammar guarantees the result is well formed. There is no
      // observable failing case left; what is left to pin is the invariant
      // that makes the gate safe.
      for (const type of ['payment', 'com_order_create', 'a1_b2_c3']) {
        expect(paths({ type })).not.toContain('uri');
      }
    });
  });

  describe('type', () => {
    it('rejects uppercase', () => {
      expect(issuesOf({ type: 'Com_Order_Create' })).toContainEqual(
        expect.stringContaining('type: must be lowercase'),
      );
    });

    it('rejects a dotted identifier', () => {
      expect(paths({ type: 'com.order.create' })).toContain('type');
    });

    it('rejects a leading underscore', () => {
      expect(paths({ type: '_com_order' })).toContain('type');
    });

    it('rejects a trailing underscore', () => {
      expect(paths({ type: 'com_order_' })).toContain('type');
    });

    it('rejects consecutive underscores', () => {
      expect(paths({ type: 'com__order' })).toContain('type');
    });

    it('rejects an empty string', () => {
      expect(paths({ type: '' })).toContain('type');
    });

    it('rejects a non-string', () => {
      expect(paths({ type: 42 as unknown as string })).toContain('type');
    });

    it('accepts digits within a segment', () => {
      expect(issuesOf({ type: 'v2_order_create' })).toEqual([]);
    });
  });

  describe('uri', () => {
    it('rejects an empty explicit uri', () => {
      expect(paths({ uri: '' })).toContain('uri');
    });

    it('rejects a non-canonical uri', () => {
      expect(paths({ uri: 'HTTPS://example.com/orders' })).toContain('uri');
      expect(paths({ uri: 'a/../b' })).toContain('uri');
    });

    it('rejects a non-string uri', () => {
      expect(paths({ uri: 7 as unknown as string })).toContain('uri');
    });
  });

  describe('domain', () => {
    it('accepts null', () => {
      expect(issuesOf({ domain: undefined })).toEqual([]);
    });

    it('rejects a dotted domain', () => {
      expect(paths({ domain: 'order.priority' })).toContain('domain');
    });

    it('rejects uppercase', () => {
      expect(paths({ domain: 'Order_Priority' })).toContain('domain');
    });

    it('accepts a valid identifier', () => {
      expect(issuesOf({ domain: 'order_priority' })).toEqual([]);
    });
  });

  describe('description and metadata', () => {
    it('rejects a non-string description', () => {
      expect(paths({ description: 5 as unknown as string })).toContain(
        'description',
      );
    });

    it('rejects non-object metadata', () => {
      expect(paths({ metadata: 'nope' as never })).toContain('metadata');
      expect(paths({ metadata: [] as never })).toContain('metadata');
    });
  });

  describe('versions', () => {
    it('rejects an empty versions map', () => {
      expect(issuesOf({ versions: {} })).toEqual([
        'versions: must declare at least one version',
      ]);
    });

    it('rejects a non-object versions', () => {
      expect(issuesOf({ versions: null as never })).toEqual([
        'versions: must be an object',
      ]);
    });

    it('rejects a pre-release version key', () => {
      expect(
        paths({ versions: { '1.0.0-beta': { input, outputs: {} } } as never }),
      ).toContain('versions["1.0.0-beta"]');
    });

    it('rejects build metadata in a version key', () => {
      expect(
        paths({ versions: { '1.0.0+build': { input, outputs: {} } } as never }),
      ).toContain('versions["1.0.0+build"]');
    });

    it('rejects leading zeros in a version key', () => {
      expect(
        paths({ versions: { '01.0.0': { input, outputs: {} } } as never }),
      ).toContain('versions["01.0.0"]');
    });

    it('rejects a partial version key', () => {
      expect(
        paths({ versions: { '1.0': { input, outputs: {} } } as never }),
      ).toContain('versions["1.0"]');
    });

    it('rejects a non-object version definition', () => {
      expect(issuesOf({ versions: { '1.0.0': null } as never })).toEqual([
        'versions["1.0.0"]: must be an object',
      ]);
    });
  });

  describe('input and outputs schemas', () => {
    it('rejects a missing input', () => {
      expect(
        paths({ versions: { '1.0.0': { outputs: {} } } as never }),
      ).toContain('versions["1.0.0"].input');
    });

    it('rejects a non-object input schema', () => {
      expect(
        paths({
          versions: { '1.0.0': { input: z.string(), outputs: {} } } as never,
        }),
      ).toContain('versions["1.0.0"].input');
    });

    it('rejects an array input schema', () => {
      expect(
        paths({
          versions: {
            '1.0.0': { input: z.array(z.string()), outputs: {} },
          } as never,
        }),
      ).toContain('versions["1.0.0"].input');
    });

    it('rejects a value that is not a schema at all', () => {
      expect(
        paths({
          versions: { '1.0.0': { input: { a: 1 }, outputs: {} } } as never,
        }),
      ).toContain('versions["1.0.0"].input');
    });

    it('rejects a non-object outputs schema', () => {
      expect(
        paths({
          versions: {
            '1.0.0': { input, outputs: { com_order_created: z.string() } },
          } as never,
        }),
      ).toContain('versions["1.0.0"].outputs["com_order_created"]');
    });

    it('rejects a non-object outputs map', () => {
      expect(
        paths({ versions: { '1.0.0': { input, outputs: 5 } } as never }),
      ).toContain('versions["1.0.0"].outputs');
    });

    it('permits an empty outputs', () => {
      expect(
        issuesOf({ versions: { '1.0.0': { input, outputs: {} } } }),
      ).toEqual([]);
    });
  });

  describe('emit keys', () => {
    it('rejects a dotted emit key', () => {
      expect(
        paths({
          versions: { '1.0.0': { input, outputs: { 'com.created': emit } } },
        }),
      ).toContain('versions["1.0.0"].outputs["com.created"]');
    });

    it('rejects an uppercase emit key', () => {
      expect(
        paths({
          versions: { '1.0.0': { input, outputs: { Com_Created: emit } } },
        }),
      ).toContain('versions["1.0.0"].outputs["Com_Created"]');
    });

    it('rejects an emit key equal to the contract type', () => {
      expect(
        issuesOf({
          versions: {
            '1.0.0': { input, outputs: { com_order_create: emit } },
          },
        }),
      ).toContainEqual(
        expect.stringContaining('must not reuse the contract type'),
      );
    });

    it('rejects an emit key equal to the handler error type', () => {
      expect(
        issuesOf({
          versions: {
            '1.0.0': {
              input,
              outputs: { handler_com_order_create_error: emit },
            },
          },
        }),
      ).toContainEqual(
        expect.stringContaining('must not reuse the handler error type'),
      );
    });

    it("permits an emit key matching another contract's handler error type", () => {
      expect(
        issuesOf({
          versions: {
            '1.0.0': {
              input,
              outputs: { handler_com_payment_process_error: emit },
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
      const reported = issuesOf({
        domain: 'Bad_Domain',
        versions: {
          '01.0.0': { input, outputs: { Bad_Key: emit, 'also.bad': emit } },
        } as never,
      });
      expect(reported).toContainEqual(expect.stringContaining('domain:'));
      expect(reported).toContainEqual(
        expect.stringContaining('versions["01.0.0"]:'),
      );
      expect(reported).toContainEqual(
        expect.stringContaining('outputs["Bad_Key"]'),
      );
      expect(reported).toContainEqual(
        expect.stringContaining('outputs["also.bad"]'),
      );
    });

    it('reports problems in both versions', () => {
      const reported = paths({
        versions: {
          '1.0.0': { input, outputs: { Bad_One: emit } },
          '2.0.0': { input, outputs: { Bad_Two: emit } },
        },
      });
      expect(reported).toContain('versions["1.0.0"].outputs["Bad_One"]');
      expect(reported).toContain('versions["2.0.0"].outputs["Bad_Two"]');
    });

    it('shows the offending value alongside the rule', () => {
      const issue = validateArvoContract(valid({ type: 'Bad_Type' })).issues[0];
      expect(issue?.received).toBe('Bad_Type');
    });
  });

  describe('an invalid type stops the run', () => {
    const broken = { type: 'Bad_Type', domain: 'Bad', uri: 'NOT A URI' };

    it('reports the type alone, whatever else is wrong', () => {
      expect(paths(broken)).toEqual(['type']);
    });

    it('marks the issue as the one that blocked the rest', () => {
      const [issue] = validateArvoContract(valid(broken)).issues;
      expect(issue?.isBlocking).toBe(true);
      expect(issue?.blockingReason).toContain('derived from it');
    });

    it('says so in the rendered issue', () => {
      const [issue] = validateArvoContract(valid({ type: 'Bad_Type' })).issues;
      expect(issue?.toString()).toContain('nothing after this was checked');
    });

    it('reports no uri when there was none to derive one from', () => {
      // The old behaviour reported `uri: must be a non-empty string
      // (received "")` here -- a value the caller never supplied.
      expect(paths({ type: 42 as never })).toEqual(['type']);
    });

    it("still reports a supplied uri, which is the caller's to answer for", () => {
      expect(paths({ uri: '' })).toContain('uri');
    });

    it('leaves no normalized contract to read', () => {
      const result = validateArvoContract(valid({ type: 'Bad_Type' }));
      expect(result.blocked).toBe(true);
    });

    it('does not block when the type is valid', () => {
      const result = validateArvoContract(valid({ domain: 'Bad' }));
      expect(result.blocked).toBe(false);
      expect(result.issues[0]?.isBlocking).toBe(false);
    });
  });
});

describe('validateVersionedArvoContract', () => {
  const validVersion = (
    over: Partial<VersionedArvoContractParam> = {},
  ): VersionedArvoContractParam =>
    ({
      type: 'com_order_create',
      version: '1.0.0',
      uri: '#/com/order/create',
      description: null,
      domain: null,
      metadata: {},
      input,
      outputs: { com_order_created: emit },
      ...over,
    }) as any;

  it('accepts a well-formed version', () => {
    expect(validateVersionedArvoContract(validVersion()).issues).toEqual([]);
  });

  it('applies the same emit-key rule as a contract does', () => {
    const issues = validateVersionedArvoContract(
      validVersion({ outputs: { Bad_Key: emit } }),
    ).issues;
    expect(issues.map((i) => i.path)).toContain('outputs["Bad_Key"]');
  });

  it('applies the same collision rules', () => {
    expect(
      validateVersionedArvoContract(
        validVersion({ outputs: { com_order_create: emit } }),
      ).issues.map((i) => i.message),
    ).toContainEqual(expect.stringContaining('must not reuse the contract'));
  });

  it('validates its own identity fields', () => {
    const issues = validateVersionedArvoContract(
      validVersion({ uri: '', version: '1.0' as never, domain: 'Bad' }),
    ).issues;
    const reported = issues.map((i) => i.path);
    expect(reported).toContain('uri');
    expect(reported).toContain('version');
    expect(reported).toContain('domain');
  });

  it('does not crash deriving the error type when type is not a string', () => {
    const issues = validateVersionedArvoContract(
      validVersion({ type: 42 as never, outputs: { com_order_created: emit } }),
    ).issues;
    expect(issues.map((i) => i.path)).toContain('type');
  });

  it('reports paths without a versions prefix, since there is no container', () => {
    const issues = validateVersionedArvoContract(
      validVersion({ input: z.string() as never }),
    ).issues;
    expect(issues.map((i) => i.path)).toContain('input');
  });
});
