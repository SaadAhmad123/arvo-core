import { describe, expect, it, vi } from 'vitest';

// The guard this file covers should be unreachable: `readCanonicalForm` runs
// the contract's own rules and `arvo-contract` asserts that a declaration
// those rules accept always constructs. Reaching it means that invariant
// broke, so the only way to exercise it is to break the invariant on purpose.
vi.mock('../../../src/ArvoContract/index.js', () => ({
  ArvoContract: class {
    constructor() {
      throw new Error('invariant broken');
    }
  },
}));

const { ArvoContractSerializer } = await import(
  '../../../src/serializers/ArvoContractSerializer/index.js'
);

const form = JSON.stringify({
  uri: '#/com/a/b',
  type: 'com_a_b',
  versions: {
    '1.0.0': {
      input: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {},
      },
      outputs: {},
    },
  },
});

describe('when a form passes every rule but will not construct', () => {
  const result = new ArvoContractSerializer().tryDeserialize(form);

  it('reports rather than raising', () => {
    expect(result.ok).toBe(false);
  });

  it('does not blame the form', () => {
    // Nothing was wrong with what the caller supplied, and the message must
    // not suggest otherwise.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('could not be constructed');
      expect(result.error.message).not.toContain('could not be read');
    }
  });

  it('keeps the underlying failure retrievable', () => {
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.cause?.message).toBe('invariant broken');
  });
});
