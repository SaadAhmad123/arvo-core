import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../src/ArvoContract/index.js';
import { ArvoEventHandlerValidationError } from '../../src/ArvoEventHandler/errors.js';
import { ARVO_NO_STATE_SCHEMA } from '../../src/ArvoEventHandler/helpers/defaults.js';
import { createArvoEventHandlerVersion } from '../../src/factories/createArvoEventHandlerVersion.js';
import { setupArvoEventHandler } from '../../src/factories/setupArvoEventHandler.js';
import { orderContract, paymentVersion } from './fixtures.js';

const twoVersionContract = new ArvoContract({
  type: 'com_report_build',
  versions: {
    '1.0.0': { input: z.object({ of: z.string() }), outputs: {} },
    '1.1.0': { input: z.object({ of: z.string() }), outputs: {} },
  },
});

const orderSetup = setupArvoEventHandler({
  contracts: { self: orderContract, services: { payments: paymentVersion } },
});

const executor = async () => {};

describe('a version written away from the chain', () => {
  it('carries the version it was created for', () => {
    const standaloneVersion = createArvoEventHandlerVersion(
      orderSetup,
      '1.0.0',
      executor,
    );
    expect(standaloneVersion.version).toBe('1.0.0');
  });

  it('keeps the schema it declared', () => {
    const stateSchema = z.object({ orderId: z.string() });
    const standaloneVersion = createArvoEventHandlerVersion(
      orderSetup,
      '1.0.0',
      {
        state: stateSchema,
        execute: executor,
      },
    );
    expect(standaloneVersion.state).toBe(stateSchema);
  });

  it('is given the schema that admits none where it declared none', () => {
    const standaloneVersion = createArvoEventHandlerVersion(
      orderSetup,
      '1.0.0',
      executor,
    );
    expect(standaloneVersion.state).toBe(ARVO_NO_STATE_SCHEMA);
  });

  it('keeps only the options it declared', () => {
    const standaloneVersion = createArvoEventHandlerVersion(
      orderSetup,
      '1.0.0',
      {
        options: { maxDepth: 250 },
        execute: executor,
      },
    );
    expect(standaloneVersion.options).toEqual({ maxDepth: 250 });
  });

  it('declares nothing where it declared no options', () => {
    expect(
      createArvoEventHandlerVersion(orderSetup, '1.0.0', executor).options,
    ).toBeNull();
  });

  it('judges nothing, which the chain does when it is built', () => {
    expect(() =>
      createArvoEventHandlerVersion(orderSetup, '1.0.0', {
        options: { maxDepth: -1 },
        execute: executor,
      }),
    ).not.toThrow();
  });
});

describe('assembling one into the chain', () => {
  it('names the version once overall, the created one carrying it', () => {
    const standaloneVersion = createArvoEventHandlerVersion(
      orderSetup,
      '1.0.0',
      executor,
    );
    expect(
      orderSetup
        .handler(standaloneVersion)
        .versions.map((declaration) => declaration.version),
    ).toEqual(['1.0.0']);
  });

  it('builds a handler that holds it', () => {
    const standaloneVersion = createArvoEventHandlerVersion(
      orderSetup,
      '1.0.0',
      executor,
    );
    const handler = orderSetup.handler(standaloneVersion).build();
    expect(handler.versions.get('1.0.0').version).toBe('1.0.0');
  });

  it('leaves the chain it was added to unchanged', () => {
    const standaloneVersion = createArvoEventHandlerVersion(
      orderSetup,
      '1.0.0',
      executor,
    );
    orderSetup.handler(standaloneVersion);
    expect(orderSetup.versions).toEqual([]);
  });

  it('mixes with versions declared inline', () => {
    const inlineSetup = setupArvoEventHandler({
      contracts: { self: twoVersionContract },
    });
    const standaloneVersion = createArvoEventHandlerVersion(
      inlineSetup,
      '1.1.0',
      executor,
    );
    const handler = inlineSetup
      .handler('1.0.0', executor)
      .handler(standaloneVersion)
      .build();
    expect([...handler.versions.keys()].sort()).toEqual(['1.0.0', '1.1.0']);
  });
});

describe('what a created version behaves like', () => {
  it('reaches the same declaration as the inline form', () => {
    const stateSchema = z.object({ orderId: z.string() });
    const standaloneVersion = createArvoEventHandlerVersion(
      orderSetup,
      '1.0.0',
      {
        state: stateSchema,
        options: { maxDepth: 250 },
        execute: executor,
      },
    );
    const [assembledDeclaration] =
      orderSetup.handler(standaloneVersion).versions;
    const [inlineDeclaration] = orderSetup.handler('1.0.0', {
      state: stateSchema,
      options: { maxDepth: 250 },
      execute: executor,
    }).versions;
    expect(assembledDeclaration).toEqual(inlineDeclaration);
  });

  it('runs under the same options once built', () => {
    const standaloneVersion = createArvoEventHandlerVersion(
      orderSetup,
      '1.0.0',
      executor,
    );
    const standaloneHandler = orderSetup.handler(standaloneVersion).build();
    const inlineHandler = orderSetup.handler('1.0.0', executor).build();
    expect(standaloneHandler.versions.get('1.0.0').options).toEqual(
      inlineHandler.versions.get('1.0.0').options,
    );
  });
});

describe('a created version the contract does not declare', () => {
  it('is refused at build like any other, nothing being judged before then', () => {
    const twoVersionSetup = setupArvoEventHandler({
      contracts: { self: twoVersionContract },
    });
    const standaloneVersion = createArvoEventHandlerVersion(
      twoVersionSetup,
      '1.0.0',
      executor,
    );
    expect(() => twoVersionSetup.handler(standaloneVersion).build()).toThrow(
      ArvoEventHandlerValidationError,
    );
  });
});

describe('what writing one away from the chain is typed by', () => {
  it('types the context exactly as the inline form does', () => {
    const standaloneVersion = createArvoEventHandlerVersion(
      orderSetup,
      '1.0.0',
      {
        state: z.object({ orderId: z.string() }),
        execute: async (ctx) => {
          const orderId: string | undefined = ctx.state.data?.orderId;
          expect(orderId).toBeUndefined();
          return ctx.build({
            type: 'com_payment_charge',
            data: { amount: 10 },
          });
        },
      },
    );
    expect(standaloneVersion.version).toBe('1.0.0');
  });

  it('refuses a version the contract does not declare', () => {
    // @ts-expect-error 9.9.9 is not a version com_order_create declares
    createArvoEventHandlerVersion(orderSetup, '9.9.9', executor);
    expect(orderSetup.versions).toEqual([]);
  });

  it('refuses an emission of a type the declaration never named', () => {
    createArvoEventHandlerVersion(orderSetup, '1.0.0', {
      execute: async (ctx) =>
        ctx.build({
          // @ts-expect-error nothing this handler declared takes this in
          type: 'com_nothing_declared',
          data: { amount: 10 },
        }),
    });
    expect(orderSetup.versions).toEqual([]);
  });

  it('refuses assembling one written for a different declaration', () => {
    const foreignSetup = setupArvoEventHandler({
      contracts: { self: twoVersionContract },
    });
    const standaloneVersion = createArvoEventHandlerVersion(
      foreignSetup,
      '1.0.0',
      executor,
    );
    // @ts-expect-error written against another handler's contracts
    orderSetup.handler(standaloneVersion);
    expect(orderSetup.versions).toEqual([]);
  });
});
