import { describe, expect, it } from 'vitest';
import { ArvoOutboxLifecycleError } from '../../src/ArvoOutbox/errors.js';

describe('an outbox lifecycle error', () => {
  it('names an outbox not yet open, and the operation that was too early', () => {
    const error = new ArvoOutboxLifecycleError({
      kind: 'not_open',
      outboxName: 'AnOutbox',
      operationName: 'readLatestState',
    });
    expect(error.message).toBe(
      'AnOutbox is not open; call open() before readLatestState.',
    );
    expect(error.kind).toBe('not_open');
    expect(error.outboxName).toBe('AnOutbox');
    expect(error.operationName).toBe('readLatestState');
  });

  it('names an outbox still opening, and says to await its opening', () => {
    const error = new ArvoOutboxLifecycleError({
      kind: 'still_opening',
      outboxName: 'AnOutbox',
      operationName: 'commitEvents',
    });
    expect(error.message).toBe(
      'AnOutbox is still opening; await open() before commitEvents.',
    );
  });

  it('names a closed outbox, and says to build a new one', () => {
    const error = new ArvoOutboxLifecycleError({
      kind: 'closed',
      outboxName: 'AnOutbox',
      operationName: 'open',
    });
    expect(error.message).toBe(
      'AnOutbox is closed; build a new one to use it again.',
    );
  });

  it('is an Error, told apart by its tag and its name', () => {
    const error = new ArvoOutboxLifecycleError({
      kind: 'closed',
      outboxName: 'AnOutbox',
      operationName: 'open',
    });
    expect(error).toBeInstanceOf(Error);
    expect(error._tag).toBe('ArvoOutboxLifecycleError');
    expect(error.name).toBe('ArvoOutboxLifecycleError');
  });
});
