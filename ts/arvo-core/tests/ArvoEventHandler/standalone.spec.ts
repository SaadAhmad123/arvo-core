import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../src/ArvoContract/index.js';
import { ArvoEventHandlerValidationError } from '../../src/ArvoEventHandler/errors.js';
import { ARVO_NO_STATE_SCHEMA } from '../../src/ArvoEventHandler/helpers/defaults.js';
import { createArvoEventHandlerVersion } from '../../src/factories/createArvoEventHandlerVersion.js';
import { setupArvoEventHandler } from '../../src/factories/setupArvoEventHandler.js';
import { orderContract, paymentVersion } from './fixtures.js';

const twoVersions = new ArvoContract({
  type: 'com_report_build',
  versions: {
    '1.0.0': { input: z.object({ of: z.string() }), outputs: {} },
    '1.1.0': { input: z.object({ of: z.string() }), outputs: {} },
  },
});

const setup = setupArvoEventHandler({
  contracts: { self: orderContract, services: { payments: paymentVersion } },
});

const executor = async () => {};

describe('a version written away from the chain', () => {
  it('carries the version it was created for', () => {
    const written = createArvoEventHandlerVersion(setup, '1.0.0', executor);
    expect(written.version).toBe('1.0.0');
  });

  it('keeps the schema it declared', () => {
    const data = z.object({ orderId: z.string() });
    const written = createArvoEventHandlerVersion(setup, '1.0.0', {
      state: data,
      execute: executor,
    });
    expect(written.state).toBe(data);
  });

  it('is given the schema that admits none where it declared none', () => {
    const written = createArvoEventHandlerVersion(setup, '1.0.0', executor);
    expect(written.state).toBe(ARVO_NO_STATE_SCHEMA);
  });

  it('keeps only the options it declared', () => {
    const written = createArvoEventHandlerVersion(setup, '1.0.0', {
      options: { maxDepth: 250 },
      execute: executor,
    });
    expect(written.options).toEqual({ maxDepth: 250 });
  });

  it('declares nothing where it declared no options', () => {
    expect(
      createArvoEventHandlerVersion(setup, '1.0.0', executor).options,
    ).toBeNull();
  });

  it('judges nothing, which the chain does when it is built', () => {
    expect(() =>
      createArvoEventHandlerVersion(setup, '1.0.0', {
        options: { maxDepth: -1 },
        execute: executor,
      }),
    ).not.toThrow();
  });
});

describe('assembling one into the chain', () => {
  it('names the version once overall, the created one carrying it', () => {
    const written = createArvoEventHandlerVersion(setup, '1.0.0', executor);
    expect(setup.handler(written).versions.map((one) => one.version)).toEqual([
      '1.0.0',
    ]);
  });

  it('builds a handler that holds it', () => {
    const written = createArvoEventHandlerVersion(setup, '1.0.0', executor);
    const handler = setup.handler(written).build();
    expect(handler.versions.get('1.0.0').version).toBe('1.0.0');
  });

  it('leaves the chain it was added to unchanged', () => {
    const written = createArvoEventHandlerVersion(setup, '1.0.0', executor);
    setup.handler(written);
    expect(setup.versions).toEqual([]);
  });

  it('mixes with versions declared inline', () => {
    const inlineSetup = setupArvoEventHandler({
      contracts: { self: twoVersions },
    });
    const written = createArvoEventHandlerVersion(
      inlineSetup,
      '1.1.0',
      executor,
    );
    const handler = inlineSetup
      .handler('1.0.0', executor)
      .handler(written)
      .build();
    expect([...handler.versions.keys()].sort()).toEqual(['1.0.0', '1.1.0']);
  });
});

describe('what a created version behaves like', () => {
  it('reaches the same declaration as the inline form', () => {
    const data = z.object({ orderId: z.string() });
    const written = createArvoEventHandlerVersion(setup, '1.0.0', {
      state: data,
      options: { maxDepth: 250 },
      execute: executor,
    });
    const [assembled] = setup.handler(written).versions;
    const [inline] = setup.handler('1.0.0', {
      state: data,
      options: { maxDepth: 250 },
      execute: executor,
    }).versions;
    expect(assembled).toEqual(inline);
  });

  it('runs under the same options once built', () => {
    const written = createArvoEventHandlerVersion(setup, '1.0.0', executor);
    const fromCreated = setup.handler(written).build();
    const fromInline = setup.handler('1.0.0', executor).build();
    expect(fromCreated.versions.get('1.0.0').options).toEqual(
      fromInline.versions.get('1.0.0').options,
    );
  });
});

describe('a created version the contract does not declare', () => {
  it('is refused at build like any other, nothing being judged before then', () => {
    const loose = setupArvoEventHandler({ contracts: { self: twoVersions } });
    const written = createArvoEventHandlerVersion(loose, '1.0.0', executor);
    expect(() => loose.handler(written).build()).toThrow(
      ArvoEventHandlerValidationError,
    );
  });
});

describe('what writing one away from the chain is typed by', () => {
  it('types the context exactly as the inline form does', () => {
    const written = createArvoEventHandlerVersion(setup, '1.0.0', {
      state: z.object({ orderId: z.string() }),
      execute: async (ctx) => {
        const orderId: string | undefined = ctx.state.data?.orderId;
        expect(orderId).toBeUndefined();
        return ctx.build({
          type: 'com_payment_charge',
          data: { amount: 10 },
        });
      },
    });
    expect(written.version).toBe('1.0.0');
  });

  it('refuses a version the contract does not declare', () => {
    // @ts-expect-error 9.9.9 is not a version com_order_create declares
    createArvoEventHandlerVersion(setup, '9.9.9', executor);
    expect(setup.versions).toEqual([]);
  });

  it('refuses an emission of a type the declaration never named', () => {
    createArvoEventHandlerVersion(setup, '1.0.0', {
      execute: async (ctx) =>
        ctx.build({
          // @ts-expect-error nothing this handler declared takes this in
          type: 'com_nothing_declared',
          data: { amount: 10 },
        }),
    });
    expect(setup.versions).toEqual([]);
  });

  it('refuses assembling one written for a different declaration', () => {
    const elsewhere = setupArvoEventHandler({
      contracts: { self: twoVersions },
    });
    const written = createArvoEventHandlerVersion(elsewhere, '1.0.0', executor);
    // @ts-expect-error written against another handler's contracts
    setup.handler(written);
    expect(setup.versions).toEqual([]);
  });
});
