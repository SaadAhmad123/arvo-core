import { describe, expect, it, vi } from 'vitest';
import { OutboxLifecycle } from '../../../src/outbox/helpers/outbox-lifecycle.js';

/** What an outbox under test holds while open. */
type HeldResource = { readonly name: string };

describe('the lifecycle of an outbox', () => {
  it('throws before it is opened, saying to open it first', () => {
    const lifecycle = new OutboxLifecycle<HeldResource>('AnOutbox');
    expect(() => lifecycle.held('readLatestState')).toThrow(
      'AnOutbox is not open; call open() before readLatestState.',
    );
  });

  it('holds what was acquired while open', () => {
    const lifecycle = new OutboxLifecycle<HeldResource>('AnOutbox');
    const resource = { name: 'connection' };
    lifecycle.open(() => resource);
    expect(lifecycle.held('readLatestState')).toBe(resource);
  });

  it('acquires once, however often it is opened', () => {
    const lifecycle = new OutboxLifecycle<HeldResource>('AnOutbox');
    const acquire = vi.fn(() => ({ name: 'connection' }));
    lifecycle.open(acquire);
    lifecycle.open(acquire);
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it('stays unopened where acquiring throws, so opening may be tried again', () => {
    const lifecycle = new OutboxLifecycle<HeldResource>('AnOutbox');
    expect(() =>
      lifecycle.open(() => {
        throw new Error('the file is held');
      }),
    ).toThrow('the file is held');
    expect(() => lifecycle.held('commitEvents')).toThrow(
      'AnOutbox is not open',
    );
    lifecycle.open(() => ({ name: 'connection' }));
    expect(lifecycle.held('commitEvents')).toEqual({ name: 'connection' });
  });

  it('releases what it holds once, however often it is closed', () => {
    const lifecycle = new OutboxLifecycle<HeldResource>('AnOutbox');
    const resource = { name: 'connection' };
    const release = vi.fn();
    lifecycle.open(() => resource);
    lifecycle.close(release);
    lifecycle.close(release);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(resource);
  });

  it('is closed even where releasing throws', () => {
    const lifecycle = new OutboxLifecycle<HeldResource>('AnOutbox');
    lifecycle.open(() => ({ name: 'connection' }));
    expect(() =>
      lifecycle.close(() => {
        throw new Error('the file would not close');
      }),
    ).toThrow('the file would not close');
    expect(() => lifecycle.held('commitEvents')).toThrow('AnOutbox is closed');
  });

  it('releases nothing where it was never opened, and is closed after', () => {
    const lifecycle = new OutboxLifecycle<HeldResource>('AnOutbox');
    const release = vi.fn();
    lifecycle.close(release);
    expect(release).not.toHaveBeenCalled();
    expect(() => lifecycle.open(() => ({ name: 'connection' }))).toThrow(
      'AnOutbox is closed',
    );
  });

  it('throws once closed, on use and on opening, saying to build a new one', () => {
    const lifecycle = new OutboxLifecycle<HeldResource>('AnOutbox');
    lifecycle.open(() => ({ name: 'connection' }));
    lifecycle.close(() => undefined);
    const closedMessage =
      'AnOutbox is closed; build a new one to use it again.';
    expect(() => lifecycle.held('markEventsSeen')).toThrow(closedMessage);
    expect(() => lifecycle.open(() => ({ name: 'connection' }))).toThrow(
      closedMessage,
    );
  });
});
