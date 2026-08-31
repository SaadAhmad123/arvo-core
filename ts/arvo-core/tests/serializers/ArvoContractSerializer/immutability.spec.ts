import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../../src/ArvoContract/index.js';
import { ArvoContractSerializer } from '../../../src/serializers/ArvoContractSerializer/index.js';

const serializer = new ArvoContractSerializer();

/** A contract carrying a construct JSON Schema cannot express, so a loss. */
const lossy = new ArvoContract({
  type: 'com_a_b',
  versions: { '1.0.0': { input: z.object({ at: z.date() }), outputs: {} } },
});

const clean = new ArvoContract({
  type: 'com_a_b',
  versions: { '1.0.0': { input: z.object({ a: z.string() }), outputs: {} } },
});

describe('a serialization result', () => {
  const result = serializer.serialize(lossy);

  it('is frozen', () => {
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('has a frozen collection of losses', () => {
    expect(Object.isFrozen(result.warnings)).toBe(true);
  });

  it('holds losses that are themselves frozen', () => {
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(Object.isFrozen(result.warnings[0])).toBe(true);
  });

  it('does not take an assignment to a field', () => {
    const before = result.schema;
    try {
      (result as { schema: string }).schema = 'replaced';
    } catch {
      // Strict mode raises rather than ignoring. Either is a refusal.
    }
    expect(result.schema).toBe(before);
  });

  it('does not take a push into its losses', () => {
    const before = result.warnings.length;
    try {
      (result.warnings as unknown[]).push('extra');
    } catch {
      // As above.
    }
    expect(result.warnings).toHaveLength(before);
  });

  it('does not take an assignment inside a loss', () => {
    const loss = result.warnings[0];
    const before = loss?.message;
    try {
      (loss as unknown as { message: string }).message = 'replaced';
    } catch {
      // As above.
    }
    expect(loss?.message).toBe(before);
  });
});

describe('a deserialization result', () => {
  const result = serializer.deserialize(serializer.serialize(clean).schema);

  it('is frozen', () => {
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('has a frozen collection of losses even when empty', () => {
    expect(result.warnings).toEqual([]);
    expect(Object.isFrozen(result.warnings)).toBe(true);
  });

  it('does not take an assignment to the contract it carries', () => {
    const before = result.contract;
    try {
      (result as { contract: unknown }).contract = null;
    } catch {
      // As above.
    }
    expect(result.contract).toBe(before);
  });

  it('carries a contract that is itself frozen', () => {
    expect(Object.isFrozen(result.contract)).toBe(true);
  });
});
