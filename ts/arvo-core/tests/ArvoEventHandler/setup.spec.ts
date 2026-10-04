import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../src/ArvoContract/index.js';
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
      outputs: { evt_report_built: z.object({ url: z.string() }) },
    },
  },
});

const beginning = () =>
  setupArvoEventHandler({
    contracts: { self: orderContract, services: { payments: paymentVersion } },
  });

describe('what a declaration begins with', () => {
  const setup = beginning();

  it('holds the contract it was given', () => {
    expect(setup.contracts.self).toBe(orderContract);
  });

  it('holds the services it may send to', () => {
    expect(setup.contracts.services).toEqual({ payments: paymentVersion });
  });

  it('holds no services where none were declared', () => {
    expect(
      setupArvoEventHandler({ contracts: { self: orderContract } }).contracts
        .services,
    ).toEqual({});
  });

  it('holds no options of its own where none were declared', () => {
    expect(setup.options).toBeNull();
  });

  it('has accumulated no versions yet', () => {
    expect(setup.versions).toEqual([]);
  });

  it('holds what it was given against being written into afterwards', () => {
    expect(() => {
      (setup.contracts.services as Record<string, unknown>).extra =
        paymentVersion;
    }).toThrow();
  });
});

describe('adding a version to a chain', () => {
  const executor = async () => {};

  it('accumulates it', () => {
    const setup = beginning().handler('1.0.0', { execute: executor });
    expect(setup.versions).toHaveLength(1);
    expect(setup.versions[0]?.version).toBe('1.0.0');
  });

  it('leaves the chain it came from unchanged, so one can be shared', () => {
    const before = beginning();
    before.handler('1.0.0', { execute: executor });
    expect(before.versions).toEqual([]);
  });

  it('returns a different setup rather than itself', () => {
    const before = beginning();
    expect(before.handler('1.0.0', { execute: executor })).not.toBe(before);
  });

  it('carries the contract and services forward', () => {
    const after = beginning().handler('1.0.0', { execute: executor });
    expect(after.contracts.self).toBe(orderContract);
    expect(after.contracts.services).toEqual({ payments: paymentVersion });
  });

  it("carries the handler's own options forward", () => {
    const withOptions = setupArvoEventHandler({
      contracts: { self: orderContract },
      options: { maxRetryAttempts: 5 },
    }).handler('1.0.0', { execute: executor });
    expect(withOptions.options).toEqual({ maxRetryAttempts: 5 });
  });

  it('keeps them in the order they were declared', () => {
    const setup = setupArvoEventHandler({ contracts: { self: twoVersions } })
      .handler('1.1.0', { execute: executor })
      .handler('1.0.0', { execute: executor });
    expect(setup.versions.map((one) => one.version)).toEqual([
      '1.1.0',
      '1.0.0',
    ]);
  });

  it('accumulates a version declared twice rather than collapsing it', () => {
    const setup = beginning()
      .handler('1.0.0', { execute: executor })
      .handler('1.0.0', { execute: executor });
    expect(setup.versions.map((one) => one.version)).toEqual([
      '1.0.0',
      '1.0.0',
    ]);
  });
});

describe('the two ways to declare a version', () => {
  const executor = async () => {};

  it('takes a declaration object', () => {
    const data = z.object({ orderId: z.string() });
    const [declared] = beginning().handler('1.0.0', {
      state: data,
      options: { maxDepth: 5 },
      execute: executor,
    }).versions;
    expect(declared?.state).toBe(data);
    expect(declared?.options).toEqual({ maxDepth: 5 });
    expect(declared?.execute).toBe(executor);
  });

  it('takes the executor alone, which declares nothing else', () => {
    const [declared] = beginning().handler('1.0.0', executor).versions;
    expect(declared?.execute).toBe(executor);
    expect(declared?.options).toBeNull();
  });

  it('settles both forms into one shape, so nothing downstream sees two', () => {
    const [fromObject] = beginning().handler('1.0.0', {
      execute: executor,
    }).versions;
    const [fromExecutor] = beginning().handler('1.0.0', executor).versions;
    expect(fromObject).toEqual(fromExecutor);
  });
});

describe('a version that remembers nothing', () => {
  const executor = async () => {};

  it('is given the schema that admits no state of its own', () => {
    const [declared] = beginning().handler('1.0.0', executor).versions;
    expect(declared?.state).toBe(ARVO_NO_STATE_SCHEMA);
  });

  it('is given it through the object form too', () => {
    const [declared] = beginning().handler('1.0.0', {
      execute: executor,
    }).versions;
    expect(declared?.state).toBe(ARVO_NO_STATE_SCHEMA);
  });
});

describe('what a version declared nothing for', () => {
  it('reads as nothing declared rather than as an empty declaration', () => {
    const [declared] = beginning().handler('1.0.0', {
      execute: async () => {},
      options: undefined,
    }).versions;
    expect(declared?.options).toBeNull();
  });
});
