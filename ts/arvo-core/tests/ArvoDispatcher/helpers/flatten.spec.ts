import { describe, expect, it } from 'vitest';
import { flattenMembers } from '../../../src/ArvoDispatcher/helpers/flatten.js';
import type { ArvoDispatcherSet } from '../../../src/ArvoDispatcher/types.js';
import type { IArvoEventHandlerMiddleware } from '../../../src/ArvoEventHandler/types/middleware.js';
import { auditHandler, orderHandler, paymentHandler } from '../fixtures.js';

/** Stands in for a dispatcher until the class exists: a set with both lists. */
const setOf = (
  handlers: ArvoDispatcherSet['handlers'],
  middlewares: ArvoDispatcherSet['middlewares'] = [],
): ArvoDispatcherSet => ({ handlers, middlewares });

const knownSets = new WeakSet<object>();
const markedSet = (...args: Parameters<typeof setOf>): ArvoDispatcherSet => {
  const set = setOf(...args);
  knownSets.add(set);
  return set;
};
const isSet = (candidate: unknown): candidate is ArvoDispatcherSet =>
  typeof candidate === 'object' &&
  candidate !== null &&
  knownSets.has(candidate);

const layer = (id: string): IArvoEventHandlerMiddleware => ({ id });

describe('flattening a declaration', () => {
  const order = orderHandler();
  const payment = paymentHandler();
  const audit = auditHandler();

  it('keeps handlers listed directly, in order', () => {
    const flattened = flattenMembers(
      { handlers: [order, payment], middlewares: [] },
      isSet,
    );
    expect(flattened.handlers).toEqual([order, payment]);
    expect(flattened.issues).toEqual([]);
  });

  it('takes a set’s handlers at its position', () => {
    const flattened = flattenMembers(
      { handlers: [order, markedSet([payment, audit])], middlewares: [] },
      isSet,
    );
    expect(flattened.handlers).toEqual([order, payment, audit]);
  });

  it('takes nothing but handlers from a set among the handlers', () => {
    const flattened = flattenMembers(
      {
        handlers: [markedSet([payment], [layer('ignored')])],
        middlewares: [],
      },
      isSet,
    );
    expect(flattened.middlewares).toEqual([]);
  });

  it('takes a set’s layers at its position among the layers, and nothing else', () => {
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(layer);
    const flattened = flattenMembers(
      {
        handlers: [order],
        middlewares: [a, markedSet([payment], [b, c]), d],
      },
      isSet,
    );
    expect(flattened.middlewares).toEqual([a, b, c, d]);
    expect(flattened.handlers).toEqual([order]);
  });

  it('passes a layer through unjudged, whatever it is', () => {
    const notALayer = 42 as unknown as IArvoEventHandlerMiddleware; // deliberately invalid
    const made = () => layer('made');
    expect(
      flattenMembers(
        { handlers: [order], middlewares: [notALayer, made] },
        isSet,
      ).middlewares,
    ).toEqual([notALayer, made]);
  });

  it('names a handler-list entry that is neither a handler nor a set', () => {
    const flattened = flattenMembers(
      { handlers: [order, { not: 'a handler' }], middlewares: [] },
      isSet,
    );
    expect(flattened.handlers).toEqual([order]);
    expect(flattened.issues).toHaveLength(1);
    expect(flattened.issues[0]?.path).toBe('handlers[1]');
    expect(flattened.issues[0]?.message).toContain('must be a handler');
  });

  it('refuses something shaped like a set that the test does not call one', () => {
    const lookalike = setOf([payment]);
    expect(
      flattenMembers({ handlers: [lookalike], middlewares: [] }, isSet).issues,
    ).toHaveLength(1);
  });
});
