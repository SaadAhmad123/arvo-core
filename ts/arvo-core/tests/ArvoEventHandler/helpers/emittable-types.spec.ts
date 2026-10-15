import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../../src/ArvoContract/index.js';
import { emittableTypes } from '../../../src/ArvoEventHandler/helpers/emittable-types.js';
import { orderContract, orderVersion, paymentVersion } from '../fixtures.js';

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

describe('what one version of a handler may emit', () => {
  const emittable = emittableTypes(orderVersion, { payments: paymentVersion });

  it('holds what each declared service takes in', () => {
    expect(emittable.has(paymentVersion.type)).toBe(true);
  });

  it('holds every output this version declares', () => {
    expect(emittable.has('com_order_created')).toBe(true);
  });

  it("holds this version's handler error type", () => {
    expect(emittable.has(orderVersion.error.type)).toBe(true);
  });

  it('holds nothing else', () => {
    expect(emittable.size).toBe(3);
  });

  it('does not hold the type this version takes in', () => {
    expect(emittable.has(orderContract.type)).toBe(false);
  });
});

describe('what differs between two versions of one contract', () => {
  const first = emittableTypes(twoVersions.versions['1.0.0'], {
    payments: paymentVersion,
  });
  const second = emittableTypes(twoVersions.versions['1.1.0'], {
    payments: paymentVersion,
  });

  it('shares every service type', () => {
    expect(first.has(paymentVersion.type)).toBe(true);
    expect(second.has(paymentVersion.type)).toBe(true);
  });

  it('differs in the outputs each declares', () => {
    expect(first.has('evt_report_built')).toBe(true);
    expect(second.has('evt_report_built')).toBe(false);
    expect(second.has('evt_report_published')).toBe(true);
  });
});

describe('the shapes with nothing of their own', () => {
  it('holds only the handler error type where a version declares no outputs and no service is declared', () => {
    const sink = new ArvoContract({
      type: 'com_audit_write',
      versions: {
        '1.0.0': { input: z.object({ line: z.string() }), outputs: {} },
      },
    });
    const emittable = emittableTypes(sink.versions['1.0.0'], {});
    expect([...emittable]).toEqual([sink.versions['1.0.0'].error.type]);
  });
});
