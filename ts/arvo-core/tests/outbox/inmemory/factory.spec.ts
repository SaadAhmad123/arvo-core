import { describe, expect, it } from 'vitest';
import {
  ArvoMemoryOutbox,
  ArvoMemoryOutboxValidationError,
  createArvoMemoryOutbox,
  tryCreateArvoMemoryOutbox,
} from '../../../src/outbox/inmemory/index.js';

/** Options that break a rule. */
const invalidOptions = { buffers: { events: { size: 0, tolerance: 0.2 } } };

describe('building an in-memory outbox through its factories', () => {
  it('answers the outbox where the options are valid', () => {
    const outboxResult = tryCreateArvoMemoryOutbox();
    expect(outboxResult.ok && outboxResult.value).toBeInstanceOf(
      ArvoMemoryOutbox,
    );
    expect(createArvoMemoryOutbox()).toBeInstanceOf(ArvoMemoryOutbox);
  });

  it('answers the validation error as a value, or throws it', () => {
    const outboxResult = tryCreateArvoMemoryOutbox(invalidOptions);
    expect(!outboxResult.ok && outboxResult.error).toBeInstanceOf(
      ArvoMemoryOutboxValidationError,
    );
    expect(() => createArvoMemoryOutbox(invalidOptions)).toThrow(
      ArvoMemoryOutboxValidationError,
    );
  });
});
