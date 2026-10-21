import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../../src/ArvoContract/index.js';
import { emittableTypes } from '../../../src/ArvoEventHandler/helpers/emittable-types.js';
import { orderContract, orderVersion, paymentVersion } from '../fixtures.js';

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

describe('what one version of a handler may emit', () => {
  const emittableSet = emittableTypes(orderVersion, {
    payments: paymentVersion,
  });

  it('holds what each declared service takes in', () => {
    expect(emittableSet.has(paymentVersion.type)).toBe(true);
  });

  it('holds every output this version declares', () => {
    expect(emittableSet.has('com_order_created')).toBe(true);
  });

  it("holds this version's handler error type", () => {
    expect(emittableSet.has(orderVersion.error.type)).toBe(true);
  });

  it('holds nothing else', () => {
    expect(emittableSet.size).toBe(3);
  });

  it('does not hold the type this version takes in', () => {
    expect(emittableSet.has(orderContract.type)).toBe(false);
  });
});

describe('what differs between two versions of one contract', () => {
  const version100Types = emittableTypes(twoVersionContract.versions['1.0.0'], {
    payments: paymentVersion,
  });
  const version110Types = emittableTypes(twoVersionContract.versions['1.1.0'], {
    payments: paymentVersion,
  });

  it('shares every service type', () => {
    expect(version100Types.has(paymentVersion.type)).toBe(true);
    expect(version110Types.has(paymentVersion.type)).toBe(true);
  });

  it('differs in the outputs each declares', () => {
    expect(version100Types.has('evt_report_built')).toBe(true);
    expect(version110Types.has('evt_report_built')).toBe(false);
    expect(version110Types.has('evt_report_published')).toBe(true);
  });
});

describe('the shapes with nothing of their own', () => {
  it('holds only the handler error type where a version declares no outputs and no service is declared', () => {
    const sinkContract = new ArvoContract({
      type: 'com_audit_write',
      versions: {
        '1.0.0': { input: z.object({ line: z.string() }), outputs: {} },
      },
    });
    const emittableSet = emittableTypes(sinkContract.versions['1.0.0'], {});
    expect([...emittableSet]).toEqual([
      sinkContract.versions['1.0.0'].error.type,
    ]);
  });
});
