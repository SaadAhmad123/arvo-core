import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { handlerErrorType } from '../../../src/ArvoContract/handler-error.js';
import { ArvoContract } from '../../../src/ArvoContract/index.js';
import { checkCollisions } from '../../../src/ArvoEventHandler/helpers/check-collisions.js';
import { orderContract, paymentVersion } from '../fixtures.js';

/** A contract taking in one type and answering with another. */
const singleOutputContract = (
  type: string,
  output: string,
  versions = ['1.0.0'],
) =>
  new ArvoContract({
    type,
    versions: Object.fromEntries(
      versions.map((version) => [
        version,
        {
          input: z.object({ of: z.string() }),
          outputs: { [output]: z.object({ url: z.string() }) },
        },
      ]),
    ),
  });

describe('a capability set with nothing shared', () => {
  it('accepts a handler whose service, outputs and handler error all differ', () => {
    expect(
      checkCollisions(orderContract, { payments: paymentVersion }),
    ).toEqual([]);
  });

  it('accepts a handler with no services', () => {
    expect(checkCollisions(orderContract, {})).toEqual([]);
  });
});

describe('two services sharing a type', () => {
  it('is refused, the type no longer saying where an event goes', () => {
    const leftContract = singleOutputContract('com_same_name', 'evt_left_done');
    const rightContract = new ArvoContract({
      type: 'com_same_name',
      versions: {
        '1.0.0': {
          input: z.object({ of: z.number() }),
          outputs: { evt_right_done: z.object({ url: z.string() }) },
        },
      },
    });
    const issues = checkCollisions(orderContract, {
      left: leftContract.versions['1.0.0'],
      right: rightContract.versions['1.0.0'],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('com_same_name');
  });
});

describe("a service colliding with this version's own output", () => {
  it('is refused', () => {
    const clashingContract = singleOutputContract(
      'com_order_created',
      'evt_anything',
    );
    const issues = checkCollisions(orderContract, {
      clashing: clashingContract.versions['1.0.0'],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('com_order_created');
  });
});

describe("a service colliding with this version's handler error type", () => {
  it('is refused', () => {
    const clashingContract = singleOutputContract(
      handlerErrorType('com_order_create'),
      'evt_x',
    );
    const issues = checkCollisions(orderContract, {
      clashing: clashingContract.versions['1.0.0'],
    });
    expect(issues).toHaveLength(1);
  });
});

describe('a collision in one version of two', () => {
  const twoVersionContract = new ArvoContract({
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

  it('is reported against the version that has it, and that one only', () => {
    const clashingContract = singleOutputContract(
      'evt_report_published',
      'evt_x',
    );
    const issues = checkCollisions(twoVersionContract, {
      clashing: clashingContract.versions['1.0.0'],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('versions["1.1.0"]');
  });
});

describe('what the model permits, which a rejection-only suite would miss', () => {
  it('accepts two versions declaring the same output type', () => {
    const sharedOutputContract = new ArvoContract({
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
    expect(
      checkCollisions(sharedOutputContract, { payments: paymentVersion }),
    ).toEqual([]);
  });

  it('accepts the implemented contract declared as a service, which is recursion', () => {
    expect(
      checkCollisions(orderContract, {
        self: orderContract.versions['1.0.0'],
      }),
    ).toEqual([]);
  });

  it('still accepts it where that version also declares outputs', () => {
    const issues = checkCollisions(orderContract, {
      self: orderContract.versions['1.0.0'],
      payments: paymentVersion,
    });
    expect(issues).toEqual([]);
  });
});

describe('what a refusal names', () => {
  it('names both sides of the clash, so neither has to be guessed', () => {
    const clashingContract = singleOutputContract('com_order_created', 'evt_x');
    const [issue] = checkCollisions(orderContract, {
      clashing: clashingContract.versions['1.0.0'],
    });
    expect(issue?.message).toContain('clashing');
    expect(issue?.message).toContain('com_order_created');
  });
});
