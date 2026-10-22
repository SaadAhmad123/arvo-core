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
import {
  mutateArvoEvent,
  tryMutateArvoEvent,
} from '../../src/factories/mutateArvoEvent.js';

const orderVersion = new ArvoContract({
  type: 'com_order_create',
  versions: {
    '1.0.0': {
      input: z.object({ items: z.array(z.string()) }),
      outputs: { com_order_created: z.object({ order_id: z.string() }) },
    },
  },
}).versions['1.0.0'];

const orderFactory = createArvoEventFactory(orderVersion);

/** One instance, so both forms compose the same stack from it. */
const sharedError = new Error('boom');

const event = new ArvoEvent({
  source: 'com.test.suite',
  subject: 'order-42',
  type: 'com_order_created',
  dataschema: orderVersion.dataschema,
  data: { order_id: 'o-1' },
});

/** Each builder, as the pair it comes in, with a good and a bad input. */
const builderPairs = [
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
    'mutateArvoEvent',
    () => mutateArvoEvent(event, { to: 'com.audit.log' }),
    () => tryMutateArvoEvent(event, { to: 'com.audit.log' }),
    () => mutateArvoEvent(event, { to: '' }),
    () => tryMutateArvoEvent(event, { to: '' }),
  ],
  [
    'createInput',
    () => orderFactory.createInput({ source: 's', data: { items: [] } }),
    () => orderFactory.tryCreateInput({ source: 's', data: { items: [] } }),
    () => orderFactory.createInput({ source: 's', data: {} as never }),
    () => orderFactory.tryCreateInput({ source: 's', data: {} as never }),
  ],
  [
    'createOutput',
    () =>
      orderFactory.createOutput({
        type: 'com_order_created',
        source: 's',
        data: { order_id: 'o' },
      }),
    () =>
      orderFactory.tryCreateOutput({
        type: 'com_order_created',
        source: 's',
        data: { order_id: 'o' },
      }),
    () =>
      orderFactory.createOutput({
        type: 'com_order_created',
        source: 's',
        data: {} as never,
      }),
    () =>
      orderFactory.tryCreateOutput({
        type: 'com_order_created',
        source: 's',
        data: {} as never,
      }),
  ],
  [
    'createError',
    () => orderFactory.createError({ source: 's', error: sharedError }),
    () => orderFactory.tryCreateError({ source: 's', error: sharedError }),
    () =>
      orderFactory.createError({
        source: 's',
        error: null as unknown as Error,
      }),
    () =>
      orderFactory.tryCreateError({
        source: 's',
        error: null as unknown as Error,
      }),
  ],
] as const;

describe.each(builderPairs)(
  '%s and its reporting form',
  (_name, buildValid, tryBuildValid, buildInvalid, tryBuildInvalid) => {
    it('agree on success', () => {
      const tryResult = tryBuildValid();
      expect(tryResult.ok).toBe(true);
      expect(() => buildValid()).not.toThrow();
    });

    it('produce an equivalent event on success', () => {
      const tryResult = tryBuildValid();
      if (!tryResult.ok) throw tryResult.error;
      const builtEvent = buildValid();
      // `id`, `subject` and `time` are generated per call where not supplied,
      // so the payload and the routing fields are what must agree.
      expect(builtEvent.type).toBe(tryResult.value.type);
      expect(builtEvent.data).toEqual(tryResult.value.data);
      expect(builtEvent.dataschema).toBe(tryResult.value.dataschema);
      expect(builtEvent.to).toBe(tryResult.value.to);
    });

    it('agree on failure', () => {
      const tryResult = tryBuildInvalid();
      expect(tryResult.ok).toBe(false);
      expect(() => buildInvalid()).toThrow();
    });

    it('raise from the throwing form what the other reported', () => {
      const tryResult = tryBuildInvalid();
      if (tryResult.ok) throw new Error('expected a failure');
      expect(() => buildInvalid()).toThrow(tryResult.error.message);
    });

    it('report rather than raise, for an input a caller can supply', () => {
      expect(() => tryBuildInvalid()).not.toThrow();
    });
  },
);

describe('reaching a factory', () => {
  it('reports something that is not a version of a contract', () => {
    const createResult = tryCreateArvoEventFactory(null as never);
    expect(createResult.ok).toBe(false);
    if (createResult.ok) return;
    expect(createResult.error).toBeInstanceOf(ArvoContractValidationError);
    expect(createResult.error.issues[0]?.path).toBe('contract');
  });

  it('raises the same from the throwing form', () => {
    expect(() => createArvoEventFactory({} as never)).toThrow(
      ArvoContractValidationError,
    );
  });

  it('carries the version it was given, and is frozen', () => {
    expect(orderFactory.contract).toBe(orderVersion);
    expect(Object.isFrozen(orderFactory)).toBe(true);
  });

  it('is reachable by construction too', () => {
    expect(new ArvoEventFactory(orderVersion).contract).toBe(orderVersion);
  });
});
