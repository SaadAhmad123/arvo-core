import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../src/ArvoContract/index.js';
import { ArvoDomain } from '../../src/ArvoDomain/index.js';
import { resolveEventDomain } from '../../src/ArvoDomain/resolve.js';
import { ArvoEvent } from '../../src/ArvoEvent/index.js';

/** A version whose contract declares a domain, and one whose does not. */
const withDomain = new ArvoContract({
  type: 'com_order_create',
  domain: 'orders',
  versions: { '1.0.0': { input: z.object({}), outputs: {} } },
}).versions['1.0.0'];

const withoutDomain = new ArvoContract({
  type: 'com_order_create',
  versions: { '1.0.0': { input: z.object({}), outputs: {} } },
}).versions['1.0.0'];

const selfContract = new ArvoContract({
  type: 'com_order_service',
  domain: 'services',
  versions: { '1.0.0': { input: z.object({}), outputs: {} } },
}).versions['1.0.0'];

const triggeringEvent = new ArvoEvent({
  source: 'com.test',
  subject: 'order-1',
  type: 'com_order_create',
  dataschema: withDomain.dataschema,
  data: {},
  domain: 'inbound',
});

describe('a domain supplied as a value', () => {
  it('is used as it stands', () => {
    expect(resolveEventDomain('explicit', { eventContract: withDomain })).toBe(
      'explicit',
    );
  });

  it('is used even when it looks like a symbol description', () => {
    expect(
      resolveEventDomain('arvo.domain.local', { eventContract: withDomain }),
    ).toBe('arvo.domain.local');
  });
});

describe('a domain named by a symbol', () => {
  it('reads nothing for LOCAL', () => {
    expect(
      resolveEventDomain(ArvoDomain.LOCAL, { eventContract: withDomain }),
    ).toBeNull();
  });

  it("reads the event contract's own domain", () => {
    expect(
      resolveEventDomain(ArvoDomain.FROM_EVENT_CONTRACT, {
        eventContract: withDomain,
      }),
    ).toBe('orders');
  });

  it("reads the self contract's domain", () => {
    expect(
      resolveEventDomain(ArvoDomain.FROM_SELF_CONTRACT, {
        eventContract: withDomain,
        selfContract,
      }),
    ).toBe('services');
  });

  it("reads the triggering event's domain", () => {
    expect(
      resolveEventDomain(ArvoDomain.FROM_TRIGGERING_EVENT, {
        eventContract: withDomain,
        triggeringEvent,
      }),
    ).toBe('inbound');
  });
});

describe('a source with no domain to give', () => {
  it('reads null from a contract declaring none', () => {
    expect(
      resolveEventDomain(ArvoDomain.FROM_EVENT_CONTRACT, {
        eventContract: withoutDomain,
      }),
    ).toBeNull();
  });

  it('reads null from an event carrying none', () => {
    const local = new ArvoEvent({
      source: 'com.test',
      subject: 'order-1',
      type: 'com_order_create',
      dataschema: withDomain.dataschema,
      data: {},
    });
    expect(
      resolveEventDomain(ArvoDomain.FROM_TRIGGERING_EVENT, {
        eventContract: withDomain,
        triggeringEvent: local,
      }),
    ).toBeNull();
  });
});

describe('a source that was not supplied', () => {
  it('reads null rather than failing, for a self contract', () => {
    expect(
      resolveEventDomain(ArvoDomain.FROM_SELF_CONTRACT, {
        eventContract: withDomain,
      }),
    ).toBeNull();
  });

  it('reads null rather than failing, for a triggering event', () => {
    expect(
      resolveEventDomain(ArvoDomain.FROM_TRIGGERING_EVENT, {
        eventContract: withDomain,
      }),
    ).toBeNull();
  });
});

describe('the symbols themselves', () => {
  it('are distinct from one another', () => {
    const all = [
      ArvoDomain.LOCAL,
      ArvoDomain.FROM_EVENT_CONTRACT,
      ArvoDomain.FROM_SELF_CONTRACT,
      ArvoDomain.FROM_TRIGGERING_EVENT,
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it('cannot be reassigned', () => {
    try {
      (ArvoDomain as { LOCAL: unknown }).LOCAL = 'replaced';
    } catch {
      // Strict mode raises rather than ignoring. Either is a refusal.
    }
    expect(typeof ArvoDomain.LOCAL).toBe('symbol');
  });
});
