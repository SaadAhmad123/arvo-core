import { describe, expect, it } from 'vitest';
import { ArvoDomain } from '../../../src/ArvoDomain/index.js';
import { ARVO_DEFAULT_HANDLER_OPTIONS } from '../../../src/ArvoEventHandler/helpers/defaults.js';
import { resolveOptions } from '../../../src/ArvoEventHandler/helpers/resolve-options.js';

describe('what a handler holds where its author wrote nothing', () => {
  it('holds every one of the seven', () => {
    const inForce = resolveOptions(null, ARVO_DEFAULT_HANDLER_OPTIONS);
    expect(Object.keys(inForce).sort()).toEqual(
      [
        'collect',
        'executionTimeout',
        'handlerErrorDomain',
        'maxDepth',
        'maxRetryAttempts',
        'retryDelay',
        'runTimeout',
      ].sort(),
    );
  });

  it('holds the value the protocol defines for each', () => {
    expect(resolveOptions(null, ARVO_DEFAULT_HANDLER_OPTIONS)).toEqual({
      maxDepth: 10_000,
      maxRetryAttempts: 3,
      retryDelay: 300,
      runTimeout: 30_000,
      executionTimeout: null,
      collect: 'all',
      handlerErrorDomain: null,
    });
  });
});

describe('which level a value comes from', () => {
  const handler = resolveOptions(
    { maxDepth: 250, runTimeout: 10_000 },
    ARVO_DEFAULT_HANDLER_OPTIONS,
  );

  it('keeps what the handler declared', () => {
    expect(handler.maxDepth).toBe(250);
    expect(handler.runTimeout).toBe(10_000);
  });

  it('falls to the default for what the handler left alone', () => {
    expect(handler.maxRetryAttempts).toBe(3);
    expect(handler.collect).toBe('all');
  });

  it("gives the version its own value over the handler's", () => {
    expect(resolveOptions({ maxDepth: 5 }, handler).maxDepth).toBe(5);
  });

  it("inherits the handler's where the version wrote nothing", () => {
    expect(resolveOptions({ maxDepth: 5 }, handler).runTimeout).toBe(10_000);
  });

  it('settles two versions independently of one another', () => {
    const first = resolveOptions({ collect: 'each' }, handler);
    const second = resolveOptions(null, handler);
    expect(first.collect).toBe('each');
    expect(second.collect).toBe('all');
  });
});

describe('an option unset against one written null', () => {
  const handler = resolveOptions(
    { runTimeout: 10_000, executionTimeout: 60_000 },
    ARVO_DEFAULT_HANDLER_OPTIONS,
  );

  it('inherits where the version omits the key', () => {
    expect(resolveOptions({}, handler).runTimeout).toBe(10_000);
  });

  it('is unbounded where the version writes null, null being a value', () => {
    expect(resolveOptions({ runTimeout: null }, handler).runTimeout).toBeNull();
  });

  it('reads an explicit undefined as the key never written', () => {
    expect(resolveOptions({ runTimeout: undefined }, handler).runTimeout).toBe(
      10_000,
    );
  });
});

describe('a domain is a value, including where it is none', () => {
  const handler = resolveOptions(
    { handlerErrorDomain: 'order_failures' },
    ARVO_DEFAULT_HANDLER_OPTIONS,
  );

  it('keeps a literal', () => {
    expect(handler.handlerErrorDomain).toBe('order_failures');
  });

  it('keeps a source to read one from', () => {
    expect(
      resolveOptions(
        { handlerErrorDomain: ArvoDomain.FROM_SELF_CONTRACT },
        handler,
      ).handlerErrorDomain,
    ).toBe(ArvoDomain.FROM_SELF_CONTRACT);
  });

  it('takes null as the version asking for no domain at all', () => {
    expect(
      resolveOptions({ handlerErrorDomain: null }, handler).handlerErrorDomain,
    ).toBeNull();
  });
});

describe('what resolving leaves untouched', () => {
  it('builds a new object rather than writing into either side', () => {
    const declared = { maxDepth: 7 };
    const inForce = resolveOptions(declared, ARVO_DEFAULT_HANDLER_OPTIONS);
    expect(inForce).not.toBe(declared);
    expect(inForce).not.toBe(ARVO_DEFAULT_HANDLER_OPTIONS);
    expect(ARVO_DEFAULT_HANDLER_OPTIONS.maxDepth).toBe(10_000);
  });

  it('carries a retry delay function across as the function itself', () => {
    const delay = () => 42;
    expect(
      resolveOptions({ retryDelay: delay }, ARVO_DEFAULT_HANDLER_OPTIONS)
        .retryDelay,
    ).toBe(delay);
  });
});
