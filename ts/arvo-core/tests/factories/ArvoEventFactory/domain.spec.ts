import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../../src/ArvoContract/index.js';
import { ArvoDomain } from '../../../src/ArvoDomain/index.js';
import { ArvoEvent } from '../../../src/ArvoEvent/index.js';
import { createArvoEventFactory } from '../../../src/factories/ArvoEventFactory/index.js';

const version = (domain?: string) =>
  new ArvoContract({
    type: 'com_order_create',
    ...(domain === undefined ? {} : { domain }),
    versions: {
      '1.0.0': {
        input: z.object({}),
        outputs: { com_order_created: z.object({}) },
      },
    },
  }).versions['1.0.0'];

const withDomain = createArvoEventFactory(version('orders'));
const withoutDomain = createArvoEventFactory(version());

const selfContract = version('services');

const triggeringEvent = new ArvoEvent({
  source: 'com.inbound',
  subject: 'order-42',
  type: 'com_order_create',
  dataschema: '#/com/order/create/1.0.0',
  data: {},
  domain: 'inbound',
});

const built = (
  ...args: Parameters<typeof withDomain.createInput>
): string | null => withDomain.createInput(...args).domain;

describe('a domain not supplied', () => {
  it('leaves the event with none, even where the contract declares one', () => {
    // Nothing is inherited silently: a caller asks with FROM_EVENT_CONTRACT.
    expect(built({ source: 'com.web', data: {} })).toBeNull();
  });
});

describe('a domain supplied outright', () => {
  it('is used as it stands', () => {
    expect(
      built({ source: 'com.web', data: {}, domain: 'orders_priority' }),
    ).toBe('orders_priority');
  });

  it('reaches validation when empty rather than being swallowed', () => {
    const attempt = withDomain.tryCreateInput({
      source: 'com.web',
      data: {},
      domain: '',
    });
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error.issues[0]?.path).toBe('domain');
  });
});

describe('a domain read from a named source', () => {
  it('reads nothing for LOCAL', () => {
    expect(
      built({ source: 'com.web', data: {}, domain: ArvoDomain.LOCAL }),
    ).toBeNull();
  });

  it("reads the event contract's own", () => {
    expect(
      built({
        source: 'com.web',
        data: {},
        domain: ArvoDomain.FROM_EVENT_CONTRACT,
      }),
    ).toBe('orders');
  });

  it("reads the building contract's, bound on the factory", () => {
    const bound = createArvoEventFactory(version('orders'), {
      domainCtx: { selfContract },
    });
    expect(
      bound.createInput({
        source: 'com.web',
        data: {},
        domain: ArvoDomain.FROM_SELF_CONTRACT,
      }).domain,
    ).toBe('services');
  });

  it("reads the triggering event's, bound on the factory", () => {
    const bound = createArvoEventFactory(version('orders'), {
      domainCtx: { triggeringEvent },
    });
    expect(
      bound.createInput({
        source: 'com.web',
        data: {},
        domain: ArvoDomain.FROM_TRIGGERING_EVENT,
      }).domain,
    ).toBe('inbound');
  });
});

describe('options bound on the factory', () => {
  // Bound once, so they have to reach every builder and not just the first.
  const bound = createArvoEventFactory(version('orders'), {
    domainCtx: { triggeringEvent },
  });
  const param = { source: 'com.web', domain: ArvoDomain.FROM_TRIGGERING_EVENT };

  it('reaches the event the version takes in', () => {
    expect(bound.createInput({ ...param, data: {} }).domain).toBe('inbound');
  });

  it('reaches an event the version puts out', () => {
    expect(
      bound.createOutput({ ...param, type: 'com_order_created', data: {} })
        .domain,
    ).toBe('inbound');
  });

  it("reaches the version's handler error event", () => {
    expect(
      bound.createError({ ...param, error: new Error('failed') }).domain,
    ).toBe('inbound');
  });

  it('leave a symbol unresolved when the factory was given none', () => {
    const unbound = createArvoEventFactory(version('orders'));
    expect(unbound.createInput({ ...param, data: {} }).domain).toBeNull();
  });
});

describe("options bound on the factory are the factory's own", () => {
  // The spec says two events of one binding cannot resolve the same request
  // differently, so the binding cannot be a window onto a caller's object.
  const laterEvent = new ArvoEvent({
    source: 'com.elsewhere',
    subject: 'order-99',
    type: 'com_order_create',
    dataschema: '#/com/order/create/1.0.0',
    data: {},
    domain: 'elsewhere',
  });
  const param = {
    source: 'com.web',
    data: {},
    domain: ArvoDomain.FROM_TRIGGERING_EVENT,
  };

  it('ignores a source swapped after it was bound', () => {
    const ctx = { triggeringEvent };
    const bound = createArvoEventFactory(version('orders'), {
      domainCtx: ctx,
    });

    const before = bound.createInput(param).domain;
    ctx.triggeringEvent = laterEvent;
    const after = bound.createInput(param).domain;

    expect(before).toBe('inbound');
    expect(after).toBe('inbound');
  });

  it('ignores a whole context replaced after it was bound', () => {
    const options: { domainCtx?: { triggeringEvent: ArvoEvent } } = {
      domainCtx: { triggeringEvent },
    };
    const bound = createArvoEventFactory(version('orders'), options);

    options.domainCtx = { triggeringEvent: laterEvent };

    expect(bound.createInput(param).domain).toBe('inbound');
  });

  it('holds options that name no source at all', () => {
    // Bound, but with nothing in them -- a symbol has nothing to read.
    const bound = createArvoEventFactory(version('orders'), {});
    expect(bound.options).toEqual({});
    expect(bound.createInput(param).domain).toBeNull();
  });

  it('holds nothing where nothing was bound', () => {
    expect(createArvoEventFactory(version('orders')).options).toBeUndefined();
  });
});

describe('a source with nothing to give', () => {
  it('reads none from a contract declaring none', () => {
    expect(
      withoutDomain.createInput({
        source: 'com.web',
        data: {},
        domain: ArvoDomain.FROM_EVENT_CONTRACT,
      }).domain,
    ).toBeNull();
  });

  it('reads none where the source was not supplied at all', () => {
    expect(
      built({
        source: 'com.web',
        data: {},
        domain: ArvoDomain.FROM_TRIGGERING_EVENT,
      }),
    ).toBeNull();
  });
});

describe('a request never reaching the event', () => {
  it('leaves a value or nothing, never the symbol', () => {
    for (const domain of [
      ArvoDomain.LOCAL,
      ArvoDomain.FROM_EVENT_CONTRACT,
      ArvoDomain.FROM_SELF_CONTRACT,
      ArvoDomain.FROM_TRIGGERING_EVENT,
    ]) {
      const value = built({ source: 'com.web', data: {}, domain });
      expect(value === null || typeof value === 'string').toBe(true);
    }
  });
});
