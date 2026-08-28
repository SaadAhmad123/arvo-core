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
    versions: { '1.0.0': { accepts: z.object({}), emits: {} } },
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
  ...args: Parameters<typeof withDomain.createAccepted>
): string | null => withDomain.createAccepted(...args).domain;

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
    const attempt = withDomain.tryCreateAccepted({
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

  it("reads the building contract's, supplied in the options", () => {
    expect(
      withDomain.createAccepted(
        { source: 'com.web', data: {}, domain: ArvoDomain.FROM_SELF_CONTRACT },
        { domainCtx: { selfContract } },
      ).domain,
    ).toBe('services');
  });

  it("reads the triggering event's, supplied in the options", () => {
    expect(
      withDomain.createAccepted(
        {
          source: 'com.web',
          data: {},
          domain: ArvoDomain.FROM_TRIGGERING_EVENT,
        },
        { domainCtx: { triggeringEvent } },
      ).domain,
    ).toBe('inbound');
  });
});

describe('a source with nothing to give', () => {
  it('reads none from a contract declaring none', () => {
    expect(
      withoutDomain.createAccepted({
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
