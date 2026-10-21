import { describe, expect, it } from 'vitest';
import { ArvoDomain } from '../../../src/ArvoDomain/index.js';
import { ARVO_DEFAULT_HANDLER_OPTIONS } from '../../../src/ArvoEventHandler/helpers/defaults.js';
import { resolveOptions } from '../../../src/ArvoEventHandler/helpers/resolve-options.js';

describe('what a handler holds where its author wrote nothing', () => {
  it('holds every one of the seven', () => {
    const resolvedOptions = resolveOptions(null, ARVO_DEFAULT_HANDLER_OPTIONS);
    expect(Object.keys(resolvedOptions).sort()).toEqual(
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
  const handlerOptions = resolveOptions(
    { maxDepth: 250, runTimeout: 10_000 },
    ARVO_DEFAULT_HANDLER_OPTIONS,
  );

  it('keeps what the handler declared', () => {
    expect(handlerOptions.maxDepth).toBe(250);
    expect(handlerOptions.runTimeout).toBe(10_000);
  });

  it('falls to the default for what the handler left alone', () => {
    expect(handlerOptions.maxRetryAttempts).toBe(3);
    expect(handlerOptions.collect).toBe('all');
  });

  it("gives the version its own value over the handler's", () => {
    expect(resolveOptions({ maxDepth: 5 }, handlerOptions).maxDepth).toBe(5);
  });

  it("inherits the handler's where the version wrote nothing", () => {
    expect(resolveOptions({ maxDepth: 5 }, handlerOptions).runTimeout).toBe(
      10_000,
    );
  });

  it('settles two versions independently of one another', () => {
    const eachVersionOptions = resolveOptions(
      { collect: 'each' },
      handlerOptions,
    );
    const unsetVersionOptions = resolveOptions(null, handlerOptions);
    expect(eachVersionOptions.collect).toBe('each');
    expect(unsetVersionOptions.collect).toBe('all');
  });
});

describe('an option unset against one written null', () => {
  const handlerOptions = resolveOptions(
    { runTimeout: 10_000, executionTimeout: 60_000 },
    ARVO_DEFAULT_HANDLER_OPTIONS,
  );

  it('inherits where the version omits the key', () => {
    expect(resolveOptions({}, handlerOptions).runTimeout).toBe(10_000);
  });

  it('is unbounded where the version writes null, null being a value', () => {
    expect(
      resolveOptions({ runTimeout: null }, handlerOptions).runTimeout,
    ).toBeNull();
  });

  it('reads an explicit undefined as the key never written', () => {
    expect(
      resolveOptions({ runTimeout: undefined }, handlerOptions).runTimeout,
    ).toBe(10_000);
  });
});

describe('a domain is a value, including where it is none', () => {
  const handlerOptions = resolveOptions(
    { handlerErrorDomain: 'order_failures' },
    ARVO_DEFAULT_HANDLER_OPTIONS,
  );

  it('keeps a literal', () => {
    expect(handlerOptions.handlerErrorDomain).toBe('order_failures');
  });

  it('keeps a source to read one from', () => {
    expect(
      resolveOptions(
        { handlerErrorDomain: ArvoDomain.FROM_SELF_CONTRACT },
        handlerOptions,
      ).handlerErrorDomain,
    ).toBe(ArvoDomain.FROM_SELF_CONTRACT);
  });

  it('takes null as the version asking for no domain at all', () => {
    expect(
      resolveOptions({ handlerErrorDomain: null }, handlerOptions)
        .handlerErrorDomain,
    ).toBeNull();
  });
});

describe('what resolving leaves untouched', () => {
  it('builds a new object rather than writing into either side', () => {
    const declaredOptions = { maxDepth: 7 };
    const resolvedOptions = resolveOptions(
      declaredOptions,
      ARVO_DEFAULT_HANDLER_OPTIONS,
    );
    expect(resolvedOptions).not.toBe(declaredOptions);
    expect(resolvedOptions).not.toBe(ARVO_DEFAULT_HANDLER_OPTIONS);
    expect(ARVO_DEFAULT_HANDLER_OPTIONS.maxDepth).toBe(10_000);
  });

  it('carries a retry delay function across as the function itself', () => {
    const delayFunction = () => 42;
    expect(
      resolveOptions(
        { retryDelay: delayFunction },
        ARVO_DEFAULT_HANDLER_OPTIONS,
      ).retryDelay,
    ).toBe(delayFunction);
  });
});
