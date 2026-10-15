import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../../src/ArvoContract/index.js';
import { checkServices } from '../../../src/ArvoEventHandler/helpers/check-services.js';
import { orderVersion, paymentVersion } from '../fixtures.js';

const shipping = new ArvoContract({
  type: 'com_shipping_book',
  versions: {
    '1.0.0': {
      input: z.object({ to: z.string() }),
      outputs: { evt_shipping_booked: z.object({ tracking: z.string() }) },
    },
    '1.1.0': {
      input: z.object({ to: z.string() }),
      outputs: { evt_shipping_booked: z.object({ tracking: z.string() }) },
    },
  },
});

describe('what a handler may depend on', () => {
  it('accepts no services at all', () => {
    expect(checkServices({})).toEqual([]);
  });

  it('accepts two unrelated contracts', () => {
    expect(
      checkServices({
        payments: paymentVersion,
        shipping: shipping.versions['1.0.0'],
      }),
    ).toEqual([]);
  });

  it("accepts the handler's own contract among them, which is how it recurses", () => {
    expect(
      checkServices({ payments: paymentVersion, self: orderVersion }),
    ).toEqual([]);
  });
});

describe('two versions of one service contract', () => {
  const issues = checkServices({
    shippingNow: shipping.versions['1.0.0'],
    shippingNext: shipping.versions['1.1.0'],
  });

  it('is refused, a response having nothing to be checked against', () => {
    expect(issues).toHaveLength(1);
  });

  it('names the one declared second', () => {
    expect(issues[0]?.path).toBe('services["shippingNext"]');
  });

  it('names what it was first declared as, so both can be found', () => {
    expect(issues[0]?.message).toContain('shippingNow');
  });

  it('shows the contract declared twice', () => {
    expect(issues[0]?.message).toContain(shipping.uri);
  });
});

describe('one contract declared three times', () => {
  it('reports each repeat against the first', () => {
    const issues = checkServices({
      first: shipping.versions['1.0.0'],
      second: shipping.versions['1.1.0'],
      third: shipping.versions['1.0.0'],
    });
    expect(issues.map((issue) => issue.path)).toEqual([
      'services["second"]',
      'services["third"]',
    ]);
  });
});

describe('the same contract at the same version, declared twice', () => {
  it('is still refused, two names for one dependency saying nothing new', () => {
    expect(
      checkServices({ once: paymentVersion, twice: paymentVersion }),
    ).toHaveLength(1);
  });
});
