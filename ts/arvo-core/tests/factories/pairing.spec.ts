import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContractValidationError } from '../../src/ArvoContract/errors.js';
import { ArvoContract } from '../../src/ArvoContract/index.js';
import { ArvoEvent } from '../../src/ArvoEvent/index.js';
import {
  ArvoEventFactory,
  createArvoEventFactory,
  tryCreateArvoEventFactory,
} from '../../src/factories/ArvoEventFactory/index.js';
import {
  cloneArvoEvent,
  tryCloneArvoEvent,
} from '../../src/factories/cloneArvoEvent.js';
import {
  createArvoEvent,
  tryCreateArvoEvent,
} from '../../src/factories/createArvoEvent.js';

const version = new ArvoContract({
  type: 'com_order_create',
  versions: {
    '1.0.0': {
      accepts: z.object({ items: z.array(z.string()) }),
      emits: { com_order_created: z.object({ order_id: z.string() }) },
    },
  },
}).versions['1.0.0'];

const orders = createArvoEventFactory(version);

/** One instance, so both forms compose the same stack from it. */
const caught = new Error('boom');

const event = new ArvoEvent({
  source: 'com.test.suite',
  subject: 'order-42',
  type: 'com_order_created',
  dataschema: version.dataschema,
  data: { order_id: 'o-1' },
});

/** Each builder, as the pair it comes in, with a good and a bad input. */
const pairs = [
  [
    'createArvoEvent',
    () =>
      createArvoEvent({
        type: 'com_x',
        source: 's',
        dataschema: '#/x/1.0.0',
        data: {},
      }),
    () =>
      tryCreateArvoEvent({
        type: 'com_x',
        source: 's',
        dataschema: '#/x/1.0.0',
        data: {},
      }),
    () =>
      createArvoEvent({
        type: 'com_x',
        source: '',
        dataschema: '#/x/1.0.0',
        data: {},
      }),
    () =>
      tryCreateArvoEvent({
        type: 'com_x',
        source: '',
        dataschema: '#/x/1.0.0',
        data: {},
      }),
  ],
  [
    'cloneArvoEvent',
    () => cloneArvoEvent(event),
    () => tryCloneArvoEvent(event),
    () => cloneArvoEvent(event, { to: '' }),
    () => tryCloneArvoEvent(event, { to: '' }),
  ],
  [
    'createAccepted',
    () => orders.createAccepted({ source: 's', data: { items: [] } }),
    () => orders.tryCreateAccepted({ source: 's', data: { items: [] } }),
    () => orders.createAccepted({ source: 's', data: {} as never }),
    () => orders.tryCreateAccepted({ source: 's', data: {} as never }),
  ],
  [
    'createEmitted',
    () =>
      orders.createEmitted({
        type: 'com_order_created',
        source: 's',
        data: { order_id: 'o' },
      }),
    () =>
      orders.tryCreateEmitted({
        type: 'com_order_created',
        source: 's',
        data: { order_id: 'o' },
      }),
    () =>
      orders.createEmitted({
        type: 'com_order_created',
        source: 's',
        data: {} as never,
      }),
    () =>
      orders.tryCreateEmitted({
        type: 'com_order_created',
        source: 's',
        data: {} as never,
      }),
  ],
  [
    'createError',
    () => orders.createError({ source: 's', error: caught }),
    () => orders.tryCreateError({ source: 's', error: caught }),
    () => orders.createError({ source: 's', error: null as unknown as Error }),
    () =>
      orders.tryCreateError({ source: 's', error: null as unknown as Error }),
  ],
] as const;

describe.each(pairs)(
  '%s and its reporting form',
  (_name, build, report, buildBad, reportBad) => {
    it('agree on success', () => {
      const reported = report();
      expect(reported.ok).toBe(true);
      expect(() => build()).not.toThrow();
    });

    it('produce an equivalent event on success', () => {
      const reported = report();
      if (!reported.ok) throw reported.error;
      const built = build();
      // `id`, `subject` and `time` are generated per call where not supplied,
      // so the payload and the routing fields are what must agree.
      expect(built.type).toBe(reported.value.type);
      expect(built.data).toEqual(reported.value.data);
      expect(built.dataschema).toBe(reported.value.dataschema);
      expect(built.to).toBe(reported.value.to);
    });

    it('agree on failure', () => {
      const reported = reportBad();
      expect(reported.ok).toBe(false);
      expect(() => buildBad()).toThrow();
    });

    it('raise from the throwing form what the other reported', () => {
      const reported = reportBad();
      if (reported.ok) throw new Error('expected a failure');
      expect(() => buildBad()).toThrow(reported.error.message);
    });

    it('report rather than raise, for an input a caller can supply', () => {
      expect(() => reportBad()).not.toThrow();
    });
  },
);

describe('reaching a factory', () => {
  it('reports something that is not a version of a contract', () => {
    const attempt = tryCreateArvoEventFactory(null as never);
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error).toBeInstanceOf(ArvoContractValidationError);
    expect(attempt.error.issues[0]?.path).toBe('contract');
  });

  it('raises the same from the throwing form', () => {
    expect(() => createArvoEventFactory({} as never)).toThrow(
      ArvoContractValidationError,
    );
  });

  it('carries the version it was given, and is frozen', () => {
    expect(orders.contract).toBe(version);
    expect(Object.isFrozen(orders)).toBe(true);
  });

  it('is reachable by construction too', () => {
    expect(new ArvoEventFactory(version).contract).toBe(version);
  });
});
