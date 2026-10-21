import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../../src/ArvoContract/index.js';
import { ArvoContractSerializer } from '../../../src/serializers/ArvoContractSerializer/index.js';

const serializer = new ArvoContractSerializer();

/** A contract carrying a construct JSON Schema cannot express, so a loss. */
const lossyContract = new ArvoContract({
  type: 'com_a_b',
  versions: { '1.0.0': { input: z.object({ at: z.date() }), outputs: {} } },
});

const cleanContract = new ArvoContract({
  type: 'com_a_b',
  versions: { '1.0.0': { input: z.object({ a: z.string() }), outputs: {} } },
});

describe('a serialization result', () => {
  const serialization = serializer.serialize(lossyContract);

  it('is frozen', () => {
    expect(Object.isFrozen(serialization)).toBe(true);
  });

  it('has a frozen collection of losses', () => {
    expect(Object.isFrozen(serialization.warnings)).toBe(true);
  });

  it('holds losses that are themselves frozen', () => {
    expect(serialization.warnings.length).toBeGreaterThan(0);
    expect(Object.isFrozen(serialization.warnings[0])).toBe(true);
  });

  it('does not take an assignment to a field', () => {
    const schemaBefore = serialization.schema;
    try {
      (serialization as { schema: string }).schema = 'replaced';
    } catch {
      // Strict mode raises rather than ignoring. Either is a refusal.
    }
    expect(serialization.schema).toBe(schemaBefore);
  });

  it('does not take a push into its losses', () => {
    const lossCountBefore = serialization.warnings.length;
    try {
      (serialization.warnings as unknown[]).push('extra');
    } catch {
      // As above.
    }
    expect(serialization.warnings).toHaveLength(lossCountBefore);
  });

  it('does not take an assignment inside a loss', () => {
    const loss = serialization.warnings[0];
    const messageBefore = loss?.message;
    try {
      (loss as unknown as { message: string }).message = 'replaced';
    } catch {
      // As above.
    }
    expect(loss?.message).toBe(messageBefore);
  });
});

describe('a deserialization result', () => {
  const deserialization = serializer.deserialize(
    serializer.serialize(cleanContract).schema,
  );

  it('is frozen', () => {
    expect(Object.isFrozen(deserialization)).toBe(true);
  });

  it('has a frozen collection of losses even when empty', () => {
    expect(deserialization.warnings).toEqual([]);
    expect(Object.isFrozen(deserialization.warnings)).toBe(true);
  });

  it('does not take an assignment to the contract it carries', () => {
    const contractBefore = deserialization.contract;
    try {
      (deserialization as { contract: unknown }).contract = null;
    } catch {
      // As above.
    }
    expect(deserialization.contract).toBe(contractBefore);
  });

  it('carries a contract that is itself frozen', () => {
    expect(Object.isFrozen(deserialization.contract)).toBe(true);
  });
});
