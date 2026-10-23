import { ArvoDispatcherValidationError } from 'arvo-core';
import { describe, expect, it } from 'vitest';
import { manualReviewV1 } from '../../../src/distributed/handler/com_manual_review/contract.js';
import { HANDLERS } from '../../../src/distributed/handler/index.js';
import type { Mechanism } from '../../../src/distributed/shared/delivery-middleware.js';
import { dispatcherFor } from '../../../src/distributed/shared/dispatcher.js';
import { handlerFor } from '../../../src/distributed/shared/routing.js';

/**
 * What each mechanism's dispatcher holds, read off the declaration alone.
 *
 * A dispatcher is the set of handlers a mechanism runs. Routing still
 * decides where an event goes, so the two must agree on every type: a
 * type routing sends here that the dispatcher does not take would be a
 * delivery refused for no reason the event could show.
 *
 * Needs nothing running.
 */

const MECHANISMS: readonly Mechanism[] = ['temporal', 'dbos', 'replay'];

/** Every type a routing decision could be asked about, handled or not. */
const ASKED_ABOUT: readonly (string | null)[] = [
  ...Object.keys(HANDLERS),
  manualReviewV1.type,
  'com.some.client',
  '__proto__',
  'constructor',
  'toString',
  'hasOwnProperty',
  '',
  null,
];

describe.each(MECHANISMS)('the %s dispatcher', (mechanism) => {
  const dispatcher = dispatcherFor(mechanism);

  it('is the same instance every time it is asked for', () => {
    expect(dispatcherFor(mechanism)).toBe(dispatcher);
  });

  it('holds every handler routing reaches, each once, and nothing else', () => {
    expect(new Set(dispatcher.handlers)).toEqual(
      new Set(Object.values(HANDLERS)),
    );
    expect(dispatcher.handlers).toHaveLength(Object.keys(HANDLERS).length);
  });

  it.each(ASKED_ABOUT)('agrees with routing on whether %j is taken', (type) => {
    expect(dispatcher.handles(type)).toBe(handlerFor(type) !== null);
  });

  it('declares the mechanism’s own layers, outermost first', () => {
    expect(dispatcher.middlewares).toHaveLength(3);
    const [naming, ...injecting] = dispatcher.middlewares;
    expect(typeof naming === 'function' ? null : naming?.id).toBe(
      'delivered_by',
    );
    // made per execution, so each can read the delivery in scope
    for (const entry of injecting) expect(typeof entry).toBe('function');
  });

  it('knows the longest run any version of any handler may take', () => {
    const declared = dispatcher.handlers.flatMap((handler) =>
      [...handler.versions.values()].map(
        (version) => version.options.runTimeout,
      ),
    );
    const set = declared.filter((one): one is number => one !== null);
    expect(dispatcher.longestRunTimeoutMs).toBe(
      set.length === 0 ? null : Math.max(...set),
    );
  });

  describe('the name a caller may use', () => {
    it('is accepted where nothing in the set answers to it', () => {
      const validated = dispatcher.tryValidateCallerName('com_test_caller');
      expect(validated.ok).toBe(true);
    });

    it.each(Object.keys(HANDLERS))(
      'is refused where it is %s, a handler’s own type',
      (type) => {
        expect(() => dispatcher.validateCallerName(type)).toThrow(
          ArvoDispatcherValidationError,
        );
      },
    );

    it('is refused where it is a service only asked for, never implemented', () => {
      expect(dispatcher.handles(manualReviewV1.type)).toBe(false);
      const validated = dispatcher.tryValidateCallerName(manualReviewV1.type);
      expect(validated.ok).toBe(false);
    });

    it.each(['com.test.caller', 'Com_Caller', 'com__caller', '_com', ''])(
      'is refused where %j breaks the identifier grammar',
      (name) => {
        const validated = dispatcher.tryValidateCallerName(name);
        expect(validated.ok).toBe(false);
        if (validated.ok) return;
        expect(validated.error).toBeInstanceOf(ArvoDispatcherValidationError);
      },
    );
  });
});

describe('the three dispatchers together', () => {
  it('hold the very same handlers, in the same order', () => {
    const [first, ...rest] = MECHANISMS.map(
      (mechanism) => dispatcherFor(mechanism).handlers,
    );
    for (const handlers of rest) {
      expect(handlers).toHaveLength(first?.length ?? 0);
      handlers.forEach((handler, index) => {
        expect(handler).toBe(first?.[index]);
      });
    }
  });

  it('are three dispatchers, one per mechanism', () => {
    expect(new Set(MECHANISMS.map(dispatcherFor)).size).toBe(3);
  });
});
