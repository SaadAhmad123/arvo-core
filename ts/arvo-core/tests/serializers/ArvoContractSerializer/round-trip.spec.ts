import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../../src/ArvoContract/index.js';
import { ArvoContractSerializer } from '../../../src/serializers/ArvoContractSerializer/index.js';

const serializer = new ArvoContractSerializer();

/** Sends a contract out to its canonical form and reads it straight back. */
const crossOnce = (input: z.ZodType): ArvoContract => {
  const original = new ArvoContract({
    type: 'com_a_b',
    versions: { '1.0.0': { input: input as never, outputs: {} } },
  });
  return serializer.deserialize(serializer.serialize(original).schema).contract;
};

const input = (contract: ArvoContract) =>
  contract.versions['1.0.0']?.input as z.ZodType;

describe('one crossing keeps what the form can express', () => {
  // One crossing only. Repeated crossings are deliberately not covered — see
  // the note at the bottom of this file.

  it('keeps a string length bound', () => {
    const back = input(crossOnce(z.object({ a: z.string().min(3) })));
    expect(back.safeParse({ a: 'abc' }).success).toBe(true);
    expect(back.safeParse({ a: 'ab' }).success).toBe(false);
  });

  it('keeps a numeric range', () => {
    const back = input(crossOnce(z.object({ a: z.number().min(1).max(10) })));
    expect(back.safeParse({ a: 5 }).success).toBe(true);
    expect(back.safeParse({ a: 0 }).success).toBe(false);
    expect(back.safeParse({ a: 11 }).success).toBe(false);
  });

  it('keeps set membership', () => {
    const back = input(crossOnce(z.object({ a: z.enum(['x', 'y']) })));
    expect(back.safeParse({ a: 'x' }).success).toBe(true);
    expect(back.safeParse({ a: 'z' }).success).toBe(false);
  });

  it('keeps a required field required', () => {
    const back = input(crossOnce(z.object({ a: z.string() })));
    expect(back.safeParse({ a: 'x' }).success).toBe(true);
    expect(back.safeParse({}).success).toBe(false);
  });

  it('keeps an integer an integer', () => {
    const back = input(crossOnce(z.object({ a: z.int() })));
    expect(back.safeParse({ a: 1 }).success).toBe(true);
    expect(back.safeParse({ a: 1.5 }).success).toBe(false);
  });

  it('keeps a pattern', () => {
    const back = input(
      crossOnce(z.object({ a: z.string().regex(/^[a-z]+$/) })),
    );
    expect(back.safeParse({ a: 'abc' }).success).toBe(true);
    expect(back.safeParse({ a: 'ABC' }).success).toBe(false);
  });

  it('keeps an array length bound', () => {
    const back = input(crossOnce(z.object({ a: z.array(z.string()).min(2) })));
    expect(back.safeParse({ a: ['x', 'y'] }).success).toBe(true);
    expect(back.safeParse({ a: ['x'] }).success).toBe(false);
  });

  it('keeps a nested constraint', () => {
    const back = input(
      crossOnce(z.object({ a: z.object({ b: z.number().min(1) }) })),
    );
    expect(back.safeParse({ a: { b: 1 } }).success).toBe(true);
    expect(back.safeParse({ a: { b: 0 } }).success).toBe(false);
  });

  it('accepts what the original accepted', () => {
    const original = z.object({ a: z.string().min(2), b: z.number() });
    const back = input(crossOnce(original));
    const payload = { a: 'ok', b: 1 };
    expect(original.safeParse(payload).success).toBe(true);
    expect(back.safeParse(payload).success).toBe(true);
  });
});

describe('a recursive schema survives a crossing', () => {
  const Node: z.ZodType = z.object({
    name: z.string(),
    get children() {
      return z.array(Node);
    },
  });

  it('serializes and reads back', () => {
    const back = input(crossOnce(Node));
    expect(back.safeParse({ name: 'a', children: [] }).success).toBe(true);
  });

  it('still describes the recursion', () => {
    const back = input(crossOnce(Node));
    expect(
      back.safeParse({ name: 'a', children: [{ name: 'b', children: [] }] })
        .success,
    ).toBe(true);
  });
});

describe('what one crossing does not promise', () => {
  it('reports the loss when a constraint could not cross', () => {
    const original = new ArvoContract({
      type: 'com_a_b',
      versions: { '1.0.0': { input: z.object({ at: z.date() }), outputs: {} } },
    });
    const { schema, warningString } = serializer.serialize(original);
    expect(warningString).toContain('date');
    // And the contract still reads, weaker than it was declared.
    expect(serializer.deserialize(schema).contract.type).toBe('com_a_b');
  });
});

// Deliberately absent: a test that repeated crossings preserve constraints.
// They do not. `format`-backed checks decay — measured against zod 4.4.3,
// `email` and `uuid` stop being enforced after two round trips, as `format`
// is dropped on the first crossing and the `pattern` carrying the enforcement
// on the second. Nothing in ADR-005 promises idempotence and this capability
// does not either, so the absence is the specification rather than a gap in
// it. Asserting the decay instead would pin behaviour belonging to a
// dependency documented as changing.
