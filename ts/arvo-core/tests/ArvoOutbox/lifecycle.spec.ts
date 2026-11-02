import { describe, expect, it, vi } from 'vitest';
import { ArvoOutboxLifecycleError } from '../../src/ArvoOutbox/errors.js';
import { ArvoOutboxLifecycle } from '../../src/ArvoOutbox/lifecycle.js';

/** The resources an outbox under test holds while open. */
type OutboxResources = { readonly name: string };

/** A promise and the means of settling it, so a test decides when acquiring ends. */
const settleLater = <Answer>() => {
  let resolveAnswer: (answer: Answer) => void = () => undefined;
  let rejectAnswer: (reason: Error) => void = () => undefined;
  const answer = new Promise<Answer>((resolve, reject) => {
    resolveAnswer = resolve;
    rejectAnswer = reject;
  });
  return { answer, resolveAnswer, rejectAnswer };
};

describe('opening an outbox', () => {
  it('throws on use before it is opened, saying to open it first', () => {
    const lifecycle = new ArvoOutboxLifecycle<OutboxResources>('AnOutbox');
    expect(() => lifecycle.resourcesFor('readLatestState')).toThrow(
      'AnOutbox is not open; call open() before readLatestState.',
    );
  });

  it('holds the resources acquired, directly or through a promise', async () => {
    const directly = new ArvoOutboxLifecycle<OutboxResources>('AnOutbox');
    const throughAPromise = new ArvoOutboxLifecycle<OutboxResources>(
      'AnOutbox',
    );
    const resources = { name: 'connection' };
    await directly.open(() => resources);
    await throughAPromise.open(async () => resources);
    expect(directly.resourcesFor('readLatestState')).toBe(resources);
    expect(throughAPromise.resourcesFor('readLatestState')).toBe(resources);
  });

  it('answers through a promise even where acquiring answers directly', () => {
    const lifecycle = new ArvoOutboxLifecycle<OutboxResources>('AnOutbox');
    expect(lifecycle.open(() => ({ name: 'connection' }))).toBeInstanceOf(
      Promise,
    );
  });

  it('throws while still opening, saying to await opening', async () => {
    const lifecycle = new ArvoOutboxLifecycle<OutboxResources>('AnOutbox');
    const acquiring = settleLater<OutboxResources>();
    const opening = lifecycle.open(() => acquiring.answer);
    expect(() => lifecycle.resourcesFor('commitEvents')).toThrow(
      'AnOutbox is still opening; await open() before commitEvents.',
    );
    acquiring.resolveAnswer({ name: 'pool' });
    await opening;
    expect(lifecycle.resourcesFor('commitEvents')).toEqual({ name: 'pool' });
  });

  it('acquires once, however often it is opened, while opening or once open', async () => {
    const lifecycle = new ArvoOutboxLifecycle<OutboxResources>('AnOutbox');
    const acquiring = settleLater<OutboxResources>();
    const acquire = vi.fn(() => acquiring.answer);
    const firstOpening = lifecycle.open(acquire);
    const secondOpening = lifecycle.open(acquire);
    acquiring.resolveAnswer({ name: 'pool' });
    await Promise.all([firstOpening, secondOpening]);
    await lifecycle.open(acquire);
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'directly',
      () => {
        throw new Error('the connection was refused');
      },
    ],
    [
      'through a promise',
      async () => {
        throw new Error('the connection was refused');
      },
    ],
  ])(
    'stays unopened where acquiring throws %s, so opening may be tried again',
    async (_how, failingAcquire) => {
      const lifecycle = new ArvoOutboxLifecycle<OutboxResources>('AnOutbox');
      await expect(lifecycle.open(failingAcquire)).rejects.toThrow(
        'the connection was refused',
      );
      expect(() => lifecycle.resourcesFor('commitEvents')).toThrow(
        'AnOutbox is not open',
      );
      await lifecycle.open(() => ({ name: 'connection' }));
      expect(lifecycle.resourcesFor('commitEvents')).toEqual({
        name: 'connection',
      });
    },
  );
});

describe('closing an outbox', () => {
  it('releases its resources once, however often it is closed', async () => {
    const lifecycle = new ArvoOutboxLifecycle<OutboxResources>('AnOutbox');
    const resources = { name: 'connection' };
    const release = vi.fn();
    await lifecycle.open(() => resources);
    await lifecycle.close(release);
    await lifecycle.close(release);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(resources);
  });

  it('waits for releasing that answers through a promise', async () => {
    const lifecycle = new ArvoOutboxLifecycle<OutboxResources>('AnOutbox');
    await lifecycle.open(() => ({ name: 'pool' }));
    const releasing = settleLater<void>();
    const releaseSteps: string[] = [];
    const closing = lifecycle.close(async () => {
      await releasing.answer;
      releaseSteps.push('released');
    });
    expect(releaseSteps).toEqual([]);
    releasing.resolveAnswer();
    await closing;
    expect(releaseSteps).toEqual(['released']);
  });

  it('is closed even where releasing throws', async () => {
    const lifecycle = new ArvoOutboxLifecycle<OutboxResources>('AnOutbox');
    await lifecycle.open(() => ({ name: 'connection' }));
    await expect(
      lifecycle.close(() => {
        throw new Error('the file would not close');
      }),
    ).rejects.toThrow('the file would not close');
    expect(() => lifecycle.resourcesFor('commitEvents')).toThrow(
      'AnOutbox is closed',
    );
  });

  it('releases nothing where it was never opened, and is closed after', async () => {
    const lifecycle = new ArvoOutboxLifecycle<OutboxResources>('AnOutbox');
    const release = vi.fn();
    await lifecycle.close(release);
    expect(release).not.toHaveBeenCalled();
    await expect(
      lifecycle.open(() => ({ name: 'connection' })),
    ).rejects.toThrow('AnOutbox is closed');
  });

  it('waits for an opening still under way, then releases what it acquired', async () => {
    const lifecycle = new ArvoOutboxLifecycle<OutboxResources>('AnOutbox');
    const acquiring = settleLater<OutboxResources>();
    const release = vi.fn();
    const opening = lifecycle.open(() => acquiring.answer);
    const closing = lifecycle.close(release);
    expect(release).not.toHaveBeenCalled();
    acquiring.resolveAnswer({ name: 'pool' });
    await opening;
    await closing;
    expect(release).toHaveBeenCalledWith({ name: 'pool' });
    expect(() => lifecycle.resourcesFor('commitEvents')).toThrow(
      'AnOutbox is closed',
    );
  });

  it('refuses a new opening once closing has begun, even before an opening under way ends', async () => {
    const lifecycle = new ArvoOutboxLifecycle<OutboxResources>('AnOutbox');
    const acquiring = settleLater<OutboxResources>();
    const opening = lifecycle.open(() => acquiring.answer);
    const closing = lifecycle.close(() => undefined);
    await expect(
      lifecycle.open(() => ({ name: 'another pool' })),
    ).rejects.toThrow('AnOutbox is closed; build a new one to use it again.');
    acquiring.resolveAnswer({ name: 'pool' });
    await opening;
    await closing;
    expect(() => lifecycle.resourcesFor('commitEvents')).toThrow(
      'AnOutbox is closed',
    );
  });

  it('closes without releasing where an opening under way fails', async () => {
    const lifecycle = new ArvoOutboxLifecycle<OutboxResources>('AnOutbox');
    const acquiring = settleLater<OutboxResources>();
    const release = vi.fn();
    const opening = lifecycle.open(() => acquiring.answer);
    const closing = lifecycle.close(release);
    acquiring.rejectAnswer(new Error('the connection was refused'));
    await expect(opening).rejects.toThrow('the connection was refused');
    await expect(closing).resolves.toBeUndefined();
    expect(release).not.toHaveBeenCalled();
    expect(() => lifecycle.resourcesFor('commitEvents')).toThrow(
      'AnOutbox is closed',
    );
  });

  it('throws once closed, on use and on opening, saying to build a new one', async () => {
    const lifecycle = new ArvoOutboxLifecycle<OutboxResources>('AnOutbox');
    await lifecycle.open(() => ({ name: 'connection' }));
    await lifecycle.close(() => undefined);
    const closedMessage =
      'AnOutbox is closed; build a new one to use it again.';
    expect(() => lifecycle.resourcesFor('markEventsSeen')).toThrow(
      closedMessage,
    );
    await expect(
      lifecycle.open(() => ({ name: 'connection' })),
    ).rejects.toThrow(closedMessage);
  });
});

describe('the lifecycle, answering as a value', () => {
  it('answers the resources as a value while open', async () => {
    const lifecycle = new ArvoOutboxLifecycle<OutboxResources>('AnOutbox');
    const resources = { name: 'connection' };
    await lifecycle.open(() => resources);
    const resourcesResult = lifecycle.tryResourcesFor('readLatestState');
    expect(resourcesResult.ok && resourcesResult.value).toBe(resources);
  });

  it('answers each phase outside the open life as an error of its kind', async () => {
    const lifecycle = new ArvoOutboxLifecycle<OutboxResources>('AnOutbox');
    const kindNow = () => {
      const resourcesResult = lifecycle.tryResourcesFor('commitEvents');
      return resourcesResult.ok ? 'open' : resourcesResult.error.kind;
    };
    expect(kindNow()).toBe('not_open');
    const acquiring = settleLater<OutboxResources>();
    const opening = lifecycle.open(() => acquiring.answer);
    expect(kindNow()).toBe('still_opening');
    acquiring.resolveAnswer({ name: 'pool' });
    await opening;
    expect(kindNow()).toBe('open');
    await lifecycle.close(() => undefined);
    expect(kindNow()).toBe('closed');
  });

  it('throws from resourcesFor exactly the error tryResourcesFor answers', () => {
    const lifecycle = new ArvoOutboxLifecycle<OutboxResources>('AnOutbox');
    const resourcesResult = lifecycle.tryResourcesFor('commitEvents');
    expect(resourcesResult.ok).toBe(false);
    expect(() => lifecycle.resourcesFor('commitEvents')).toThrow(
      ArvoOutboxLifecycleError,
    );
  });

  it('answers opening as a value, an error where closed', async () => {
    const lifecycle = new ArvoOutboxLifecycle<OutboxResources>('AnOutbox');
    expect(await lifecycle.tryOpen(() => ({ name: 'connection' }))).toEqual({
      ok: true,
      value: undefined,
    });
    await lifecycle.close(() => undefined);
    const openResult = await lifecycle.tryOpen(() => ({ name: 'connection' }));
    expect(openResult.ok).toBe(false);
    expect(!openResult.ok && openResult.error.kind).toBe('closed');
    await expect(
      lifecycle.open(() => ({ name: 'connection' })),
    ).rejects.toThrow(ArvoOutboxLifecycleError);
  });

  it('passes on what acquiring throws, rather than answering it as a value', async () => {
    const lifecycle = new ArvoOutboxLifecycle<OutboxResources>('AnOutbox');
    await expect(
      lifecycle.tryOpen(() => {
        throw new Error('the connection was refused');
      }),
    ).rejects.toThrow('the connection was refused');
  });
});

describe('closing, answering as a value', () => {
  it('answers closing as a value, however often and from whatever phase', async () => {
    const lifecycle = new ArvoOutboxLifecycle<OutboxResources>('AnOutbox');
    const release = vi.fn();
    await lifecycle.open(() => ({ name: 'connection' }));
    expect(await lifecycle.tryClose(release)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await lifecycle.tryClose(release)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('passes on what releasing throws, rather than answering it as a value', async () => {
    const lifecycle = new ArvoOutboxLifecycle<OutboxResources>('AnOutbox');
    await lifecycle.open(() => ({ name: 'connection' }));
    await expect(
      lifecycle.tryClose(() => {
        throw new Error('the file would not close');
      }),
    ).rejects.toThrow('the file would not close');
  });
});

describe('each thrower of the lifecycle', () => {
  it('throws from close whatever error tryClose answers', async () => {
    const lifecycle = new ArvoOutboxLifecycle<OutboxResources>('AnOutbox');
    const lifecycleError = new ArvoOutboxLifecycleError({
      kind: 'closed',
      outboxName: 'AnOutbox',
      operationName: 'close',
    });
    vi.spyOn(lifecycle, 'tryClose').mockResolvedValue({
      ok: false,
      error: lifecycleError,
    });
    await expect(lifecycle.close(() => undefined)).rejects.toBe(lifecycleError);
  });
});
