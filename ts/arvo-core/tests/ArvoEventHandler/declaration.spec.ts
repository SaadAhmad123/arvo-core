import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../src/ArvoContract/index.js';
import { ArvoEventHandlerValidationError } from '../../src/ArvoEventHandler/errors.js';
import { ARVO_NO_STATE_SCHEMA } from '../../src/ArvoEventHandler/helpers/defaults.js';
import { setupArvoEventHandler } from '../../src/factories/setupArvoEventHandler.js';
import { orderContract, paymentVersion } from './fixtures.js';

const twoVersions = new ArvoContract({
  type: 'com_report_build',
  versions: {
    '1.0.0': {
      input: z.object({ of: z.string() }),
      outputs: { evt_report_built: z.object({ url: z.string() }) },
    },
    '1.1.0': {
      input: z.object({ of: z.string() }),
      outputs: { evt_report_published: z.object({ url: z.string() }) },
    },
  },
});

const executor = async () => {};

describe('a handler that was built', () => {
  const handler = setupArvoEventHandler({
    contracts: { self: orderContract, services: { payments: paymentVersion } },
  })
    .handler('1.0.0', { execute: executor })
    .build();

  it('holds the contract it implements', () => {
    expect(handler.contracts.self).toBe(orderContract);
  });

  it('holds what it may send to', () => {
    expect(handler.contracts.services).toEqual({ payments: paymentVersion });
  });

  it('holds one version for each the contract declares', () => {
    expect([...handler.versions.keys()]).toEqual(['1.0.0']);
  });

  it('binds each version to that version of the contract', () => {
    expect(handler.versions.get('1.0.0').contracts.self).toBe(
      orderContract.versions['1.0.0'],
    );
  });

  it('gives each version what it may send to', () => {
    expect(handler.versions.get('1.0.0').contracts.services).toEqual({
      payments: paymentVersion,
    });
  });

  it('holds itself against being written into afterwards', () => {
    expect(() => {
      (handler as { contracts: unknown }).contracts = {};
    }).toThrow();
  });
});

describe('a handler with nothing to send to', () => {
  it('is built, a version that only answers its caller being legitimate', () => {
    const handler = setupArvoEventHandler({
      contracts: { self: orderContract },
    })
      .handler('1.0.0', { execute: executor })
      .build();
    expect(handler.contracts.services).toEqual({});
  });
});

describe('a handler of several versions', () => {
  const handler = setupArvoEventHandler({ contracts: { self: twoVersions } })
    .handler('1.0.0', { execute: executor })
    .handler('1.1.0', { execute: executor })
    .build();

  it('holds every one of them', () => {
    expect([...handler.versions.keys()].sort()).toEqual(['1.0.0', '1.1.0']);
  });

  it('binds each to its own version of the contract', () => {
    expect(handler.versions.get('1.1.0').version).toBe('1.1.0');
  });
});

describe('what a version remembers', () => {
  it('keeps the schema a version declared', () => {
    const data = z.object({ orderId: z.string() });
    const handler = setupArvoEventHandler({
      contracts: { self: orderContract },
    })
      .handler('1.0.0', { state: data, execute: executor })
      .build();
    expect(handler.versions.get('1.0.0').dataSchema).toBe(data);
  });

  it('gives a version declaring none the schema that admits none', () => {
    const handler = setupArvoEventHandler({
      contracts: { self: orderContract },
    })
      .handler('1.0.0', executor)
      .build();
    expect(handler.versions.get('1.0.0').dataSchema).toBe(ARVO_NO_STATE_SCHEMA);
  });
});

describe('a version declared as its executor alone', () => {
  it('is built, and behaves as the object form does', () => {
    const shorthand = setupArvoEventHandler({
      contracts: { self: orderContract },
    })
      .handler('1.0.0', executor)
      .build();
    const longhand = setupArvoEventHandler({
      contracts: { self: orderContract },
    })
      .handler('1.0.0', { execute: executor })
      .build();
    expect(shorthand.versions.get('1.0.0').options).toEqual(
      longhand.versions.get('1.0.0').options,
    );
  });
});

describe('the options each version runs under', () => {
  const handler = setupArvoEventHandler({
    contracts: { self: twoVersions },
    options: { maxRetryAttempts: 5, runTimeout: 10_000 },
  })
    .handler('1.0.0', { options: { maxDepth: 250 }, execute: executor })
    .handler('1.1.0', { execute: executor })
    .build();

  it('are settled on the version, where a consumer reads them', () => {
    expect(handler.versions.get('1.0.0').options.maxDepth).toBe(250);
  });

  it("take the handler's where the version declared nothing", () => {
    expect(handler.versions.get('1.1.0').options.maxRetryAttempts).toBe(5);
    expect(handler.versions.get('1.1.0').options.runTimeout).toBe(10_000);
  });

  it("take the protocol's where neither declared anything", () => {
    expect(handler.versions.get('1.0.0').options.collect).toBe('all');
  });

  it('are settled per version, so one does not reach another', () => {
    expect(handler.versions.get('1.1.0').options.maxDepth).not.toBe(250);
  });
});

describe('the types a mechanism will supply', () => {
  it('are carried for typing and stored nowhere', () => {
    const handler = setupArvoEventHandler({
      contracts: { self: orderContract },
      types: {} as { dependencies: { db: string } },
    })
      .handler('1.0.0', executor)
      .build();
    expect(Object.keys(handler)).not.toContain('types');
  });
});

describe('a declaration that cannot work', () => {
  it('is refused where a version has no executor', () => {
    expect(() =>
      setupArvoEventHandler({ contracts: { self: twoVersions } })
        .handler('1.0.0', executor)
        .build(),
    ).toThrow(ArvoEventHandlerValidationError);
  });

  it('is refused where two capabilities share a type', () => {
    const clashing = new ArvoContract({
      type: 'com_order_created',
      versions: {
        '1.0.0': { input: z.object({ of: z.string() }), outputs: {} },
      },
    });
    expect(() =>
      setupArvoEventHandler({
        contracts: {
          self: orderContract,
          services: { clashing: clashing.versions['1.0.0'] },
        },
      })
        .handler('1.0.0', executor)
        .build(),
    ).toThrow(ArvoEventHandlerValidationError);
  });

  it('is refused where an option is outside what it accepts', () => {
    expect(() =>
      setupArvoEventHandler({
        contracts: { self: orderContract },
        options: { maxDepth: -1 },
      })
        .handler('1.0.0', executor)
        .build(),
    ).toThrow(ArvoEventHandlerValidationError);
  });

  it('is refused where a version is allowed less time than one attempt', () => {
    expect(() =>
      setupArvoEventHandler({ contracts: { self: orderContract } })
        .handler('1.0.0', {
          options: { runTimeout: 30_000, executionTimeout: 1_000 },
          execute: executor,
        })
        .build(),
    ).toThrow(ArvoEventHandlerValidationError);
  });
});
