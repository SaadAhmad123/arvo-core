import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../../src/ArvoContract/index.js';
import { ArvoDomain } from '../../../src/ArvoDomain/index.js';
import type { ArvoDomainInput } from '../../../src/ArvoDomain/types.js';
import { ArvoEvent } from '../../../src/ArvoEvent/index.js';
import { createArvoEventFactory } from '../../../src/factories/ArvoEventFactory/index.js';

const orderVersion = (domain?: string) =>
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

const factoryWithDomain = createArvoEventFactory(orderVersion('orders'));
const factoryWithoutDomain = createArvoEventFactory(orderVersion());

const selfContract = orderVersion('services');

const triggeringEvent = new ArvoEvent({
  source: 'com.inbound',
  subject: 'order-42',
  type: 'com_order_create',
  dataschema: '#/com/order/create/1.0.0',
  data: {},
  domain: 'inbound',
});

const inputDomain = (
  ...createInputArgs: Parameters<typeof factoryWithDomain.createInput>
): string | null => factoryWithDomain.createInput(...createInputArgs).domain;

describe('a domain not supplied', () => {
  it('leaves the event with none, even where the contract declares one', () => {
    // Nothing is inherited silently: a caller asks with FROM_EVENT_CONTRACT.
    expect(inputDomain({ source: 'com.web', data: {} })).toBeNull();
  });
});

describe('a domain supplied outright', () => {
  it('is used as it stands', () => {
    expect(
      inputDomain({ source: 'com.web', data: {}, domain: 'orders_priority' }),
    ).toBe('orders_priority');
  });

  it('reaches validation when empty rather than being swallowed', () => {
    const createResult = factoryWithDomain.tryCreateInput({
      source: 'com.web',
      data: {},
      domain: '',
    });
    expect(createResult.ok).toBe(false);
    if (createResult.ok) return;
    expect(createResult.error.issues[0]?.path).toBe('domain');
  });
});

describe('a domain read from a named source', () => {
  it('reads nothing for LOCAL', () => {
    expect(
      inputDomain({ source: 'com.web', data: {}, domain: ArvoDomain.LOCAL }),
    ).toBeNull();
  });

  it("reads the event contract's own", () => {
    expect(
      inputDomain({
        source: 'com.web',
        data: {},
        domain: ArvoDomain.FROM_EVENT_CONTRACT,
      }),
    ).toBe('orders');
  });

  it("reads the building contract's, bound on the factory", () => {
    const boundFactory = createArvoEventFactory(orderVersion('orders'), {
      domainCtx: { selfContract },
    });
    expect(
      boundFactory.createInput({
        source: 'com.web',
        data: {},
        domain: ArvoDomain.FROM_SELF_CONTRACT,
      }).domain,
    ).toBe('services');
  });

  it("reads the triggering event's, bound on the factory", () => {
    const boundFactory = createArvoEventFactory(orderVersion('orders'), {
      domainCtx: { triggeringEvent },
    });
    expect(
      boundFactory.createInput({
        source: 'com.web',
        data: {},
        domain: ArvoDomain.FROM_TRIGGERING_EVENT,
      }).domain,
    ).toBe('inbound');
  });
});

describe('options bound on the factory', () => {
  // Bound once, so they have to reach every builder and not just the first.
  const boundFactory = createArvoEventFactory(orderVersion('orders'), {
    domainCtx: { triggeringEvent },
  });
  const param: { source: string; domain: ArvoDomainInput } = {
    source: 'com.web',
    domain: ArvoDomain.FROM_TRIGGERING_EVENT,
  };

  it('reaches the event the version takes in', () => {
    expect(boundFactory.createInput({ ...param, data: {} }).domain).toBe(
      'inbound',
    );
  });

  it('reaches an event the version puts out', () => {
    expect(
      boundFactory.createOutput({
        ...param,
        type: 'com_order_created',
        data: {},
      }).domain,
    ).toBe('inbound');
  });

  it("reaches the version's handler error event", () => {
    expect(
      boundFactory.createError({ ...param, error: new Error('failed') }).domain,
    ).toBe('inbound');
  });

  it('leave a symbol unresolved when the factory was given none', () => {
    const unboundFactory = createArvoEventFactory(orderVersion('orders'));
    expect(
      unboundFactory.createInput({ ...param, data: {} }).domain,
    ).toBeNull();
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
  const param: {
    source: string;
    data: Record<string, never>;
    domain: ArvoDomainInput;
  } = {
    source: 'com.web',
    data: {},
    domain: ArvoDomain.FROM_TRIGGERING_EVENT,
  };

  it('ignores a source swapped after it was bound', () => {
    const domainCtx = { triggeringEvent };
    const boundFactory = createArvoEventFactory(orderVersion('orders'), {
      domainCtx,
    });

    const domainBeforeSwap = boundFactory.createInput(param).domain;
    domainCtx.triggeringEvent = laterEvent;
    const domainAfterSwap = boundFactory.createInput(param).domain;

    expect(domainBeforeSwap).toBe('inbound');
    expect(domainAfterSwap).toBe('inbound');
  });

  it('ignores a whole context replaced after it was bound', () => {
    const options: { domainCtx?: { triggeringEvent: ArvoEvent } } = {
      domainCtx: { triggeringEvent },
    };
    const boundFactory = createArvoEventFactory(
      orderVersion('orders'),
      options,
    );

    options.domainCtx = { triggeringEvent: laterEvent };

    expect(boundFactory.createInput(param).domain).toBe('inbound');
  });

  it('holds options that name no source at all', () => {
    // Bound, but with nothing in them -- a symbol has nothing to read.
    const boundFactory = createArvoEventFactory(orderVersion('orders'), {});
    expect(boundFactory.options).toEqual({});
    expect(boundFactory.createInput(param).domain).toBeNull();
  });

  it('holds nothing where nothing was bound', () => {
    expect(
      createArvoEventFactory(orderVersion('orders')).options,
    ).toBeUndefined();
  });
});

describe('a source with nothing to give', () => {
  it('reads none from a contract declaring none', () => {
    expect(
      factoryWithoutDomain.createInput({
        source: 'com.web',
        data: {},
        domain: ArvoDomain.FROM_EVENT_CONTRACT,
      }).domain,
    ).toBeNull();
  });

  it('reads none where the source was not supplied at all', () => {
    expect(
      inputDomain({
        source: 'com.web',
        data: {},
        domain: ArvoDomain.FROM_TRIGGERING_EVENT,
      }),
    ).toBeNull();
  });
});

describe('a request never reaching the event', () => {
  it('leaves a value or nothing, never the symbol', () => {
    const everySymbol: ArvoDomainInput[] = [
      ArvoDomain.LOCAL,
      ArvoDomain.FROM_EVENT_CONTRACT,
      ArvoDomain.FROM_SELF_CONTRACT,
      ArvoDomain.FROM_TRIGGERING_EVENT,
    ];
    for (const domain of everySymbol) {
      const resolvedDomain = inputDomain({
        source: 'com.web',
        data: {},
        domain,
      });
      expect(
        resolvedDomain === null || typeof resolvedDomain === 'string',
      ).toBe(true);
    }
  });
});
