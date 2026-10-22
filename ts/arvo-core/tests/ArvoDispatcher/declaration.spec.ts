import { describe, expect, it } from 'vitest';
import { ArvoDispatcherValidationError } from '../../src/ArvoDispatcher/errors.js';
import { ArvoDispatcher } from '../../src/ArvoDispatcher/index.js';
import type { IArvoEventHandlerMiddleware } from '../../src/ArvoEventHandler/types/middleware.js';
import {
  auditCallingOrderHandler,
  auditHandler,
  orderHandler,
  paymentContractElsewhere,
  paymentContractLaterOnly,
  paymentHandler,
  paymentHandlerFor,
  selfCallingAuditHandler,
} from './fixtures.js';

const refusal = (declare: () => unknown): ArvoDispatcherValidationError => {
  try {
    declare();
  } catch (thrown) {
    if (thrown instanceof ArvoDispatcherValidationError) return thrown;
    throw thrown;
  }
  throw new Error('the declaration was not refused');
};

const layer = (id: string): IArvoEventHandlerMiddleware => ({ id });

describe('declaring a dispatcher from handlers and layers', () => {
  it('holds handlers listed directly', () => {
    const dispatcher = new ArvoDispatcher({
      handlers: [orderHandler(), paymentHandler()],
    });
    expect(dispatcher.handles('com_order_create')).toBe(true);
    expect(dispatcher.handles('com_payment_charge')).toBe(true);
  });

  it('holds the handlers of a dispatcher listed among them', () => {
    const inner = new ArvoDispatcher({
      handlers: [paymentHandler(), auditHandler()],
    });
    const dispatcher = new ArvoDispatcher({
      handlers: [orderHandler(), inner],
    });
    expect(dispatcher.handlers).toHaveLength(3);
    expect(dispatcher.handles('com_audit_record')).toBe(true);
  });

  it('keeps the list exactly as declared beside the flattened one', () => {
    const inner = new ArvoDispatcher({ handlers: [paymentHandler()] });
    const order = orderHandler();
    const dispatcher = new ArvoDispatcher({ handlers: [order, inner] });
    expect(dispatcher.members).toEqual([order, inner]);
  });

  it('takes a dispatcher’s layers at its position among the layers', () => {
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(layer);
    const inner = new ArvoDispatcher({
      handlers: [auditHandler()],
      middlewares: [b, c],
    });
    const dispatcher = new ArvoDispatcher({
      handlers: [orderHandler()],
      middlewares: [a, inner, d],
    });
    expect(dispatcher.middlewares).toEqual([a, b, c, d]);
  });

  it('takes no layers from a dispatcher listed only among the handlers', () => {
    const inner = new ArvoDispatcher({
      handlers: [paymentHandler()],
      middlewares: [layer('inner')],
    });
    expect(
      new ArvoDispatcher({ handlers: [orderHandler(), inner] }).middlewares,
    ).toEqual([]);
  });

  it('holds no layers where none are given', () => {
    expect(
      new ArvoDispatcher({ handlers: [orderHandler()] }).middlewares,
    ).toEqual([]);
  });

  it('freezes what it holds', () => {
    const dispatcher = new ArvoDispatcher({
      handlers: [orderHandler()],
      middlewares: [layer('a')],
    });
    expect(Object.isFrozen(dispatcher.handlers)).toBe(true);
    expect(Object.isFrozen(dispatcher.middlewares)).toBe(true);
  });
});

describe('what a declaration refuses', () => {
  it('refuses an empty set', () => {
    const { issues } = refusal(() => new ArvoDispatcher({ handlers: [] }));
    expect(issues[0]?.message).toContain('at least one handler');
  });

  it('refuses an empty set after flattening, and checks nothing else', () => {
    // a dispatcher holding nothing cannot be built, so the nesting is of nothing at all
    const { issues } = refusal(() => new ArvoDispatcher({ handlers: [] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.isBlocking).toBe(true);
  });

  it('refuses one handler listed twice', () => {
    const order = orderHandler();
    const { issues } = refusal(
      () => new ArvoDispatcher({ handlers: [order, order] }),
    );
    expect(issues[0]?.message).toContain('com_order_create');
  });

  it('refuses one handler reached twice through nesting', () => {
    const order = orderHandler();
    const inner = new ArvoDispatcher({ handlers: [order] });
    const { issues } = refusal(
      () => new ArvoDispatcher({ handlers: [order, inner] }),
    );
    expect(issues[0]?.message).toContain('2 times');
  });

  it('refuses two handlers under one type and one uri', () => {
    const { issues } = refusal(
      () =>
        new ArvoDispatcher({ handlers: [paymentHandler(), paymentHandler()] }),
    );
    expect(issues[0]?.message).toContain('com_payment_charge');
  });

  it('refuses two handlers under one type with different uris', () => {
    const { issues } = refusal(
      () =>
        new ArvoDispatcher({
          handlers: [
            paymentHandler(),
            paymentHandlerFor(paymentContractElsewhere),
          ],
        }),
    );
    expect(
      issues.some((issue) => issue.message.includes('implemented once')),
    ).toBe(true);
  });

  it('refuses a service declared at a version its implementer lacks', () => {
    const { issues } = refusal(
      () =>
        new ArvoDispatcher({
          handlers: [
            orderHandler(),
            paymentHandlerFor(paymentContractLaterOnly),
          ],
        }),
    );
    expect(issues[0]?.message).toContain('version 1.0.0');
  });

  it('refuses a service declared under a different uri', () => {
    const { issues } = refusal(
      () =>
        new ArvoDispatcher({
          handlers: [
            orderHandler(),
            paymentHandlerFor(paymentContractElsewhere),
          ],
        }),
    );
    expect(issues[0]?.message).toContain(paymentContractElsewhere.uri);
  });

  it('reports every broken rule together', () => {
    const order = orderHandler();
    const { issues } = refusal(
      () =>
        new ArvoDispatcher({
          handlers: [order, order, paymentHandler(), paymentHandler()],
        }),
    );
    expect(issues.length).toBeGreaterThanOrEqual(2);
  });

  it('refuses a handler entry that is neither a handler nor a dispatcher', () => {
    const { issues } = refusal(
      () =>
        new ArvoDispatcher({
          // deliberately invalid: something shaped like a dispatcher that is not one
          handlers: [orderHandler(), { handlers: [], middlewares: [] }],
        }),
    );
    expect(issues[0]?.path).toBe('handlers[1]');
  });

  it('refuses a handler list that is not a list', () => {
    const { issues } = refusal(
      // deliberately invalid: a caller no compiler saw
      () => new ArvoDispatcher({ handlers: 'order' as never }),
    );
    expect(issues[0]?.path).toBe('handlers');
  });

  it('refuses a layer list that is not a list', () => {
    const { issues } = refusal(
      () =>
        new ArvoDispatcher({
          handlers: [orderHandler()],
          // deliberately invalid: a caller no compiler saw
          middlewares: 'tenant' as never,
        }),
    );
    expect(issues[0]?.path).toBe('middlewares');
  });

  it('refuses no options at all', () => {
    // deliberately invalid: a caller no compiler saw
    const { issues } = refusal(() => new ArvoDispatcher(undefined as never));
    expect(issues[0]?.path).toBe('handlers');
  });
});

describe('what a declaration does not refuse', () => {
  it('accepts a service nobody here implements', () => {
    expect(
      () => new ArvoDispatcher({ handlers: [orderHandler(), auditHandler()] }),
    ).not.toThrow();
  });

  it('accepts a service implemented here at the declared version', () => {
    expect(
      () =>
        new ArvoDispatcher({ handlers: [orderHandler(), paymentHandler()] }),
    ).not.toThrow();
  });

  it('accepts two handlers calling each other', () => {
    expect(
      () =>
        new ArvoDispatcher({
          handlers: [orderHandler(), auditCallingOrderHandler()],
        }),
    ).not.toThrow();
  });

  it('accepts a handler calling itself', () => {
    expect(
      () => new ArvoDispatcher({ handlers: [selfCallingAuditHandler()] }),
    ).not.toThrow();
  });

  it('accepts two layers sharing an identifier, leaving the conflict to the handler', () => {
    expect(
      () =>
        new ArvoDispatcher({
          handlers: [orderHandler()],
          middlewares: [layer('same'), layer('same')],
        }),
    ).not.toThrow();
  });
});
