import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../src/ArvoContract/index.js';
import { ArvoEventHandlerValidationError } from '../../src/ArvoEventHandler/errors.js';
import { ArvoEventHandler } from '../../src/ArvoEventHandler/index.js';
import { ArvoEventHandlerSetup } from '../../src/ArvoEventHandler/setup.js';
import { setupArvoEventHandler } from '../../src/factories/setupArvoEventHandler.js';
import { orderContract } from './fixtures.js';

const twoVersions = new ArvoContract({
  type: 'com_report_build',
  versions: {
    '1.0.0': { input: z.object({ of: z.string() }), outputs: {} },
    '1.1.0': { input: z.object({ of: z.string() }), outputs: {} },
  },
});

const executor = async () => {};
const valid = () =>
  setupArvoEventHandler({ contracts: { self: orderContract } }).handler(
    '1.0.0',
    executor,
  );
const refused = () =>
  setupArvoEventHandler({ contracts: { self: twoVersions } }).handler(
    '1.0.0',
    executor,
  );

describe('the two ways to finish a declaration', () => {
  it('both produce a handler from a declaration that works', () => {
    expect(valid().build()).toBeInstanceOf(ArvoEventHandler);
    const reported = valid().tryBuild();
    expect(reported.ok && reported.value).toBeInstanceOf(ArvoEventHandler);
  });

  it('produce handlers that agree on what they hold', () => {
    const thrown = valid().build();
    const reported = valid().tryBuild();
    expect(reported.ok && reported.value.contracts.self).toBe(
      thrown.contracts.self,
    );
    expect(reported.ok && [...reported.value.versions.keys()]).toEqual([
      ...thrown.versions.keys(),
    ]);
  });

  it('build a different handler each time, rather than one shared', () => {
    expect(valid().build()).not.toBe(valid().build());
  });
});

describe('a declaration that is refused', () => {
  it('throws from build', () => {
    expect(() => refused().build()).toThrow(ArvoEventHandlerValidationError);
  });

  it('reports from tryBuild rather than throwing', () => {
    const reported = refused().tryBuild();
    expect(reported.ok).toBe(false);
  });

  it('reports the same issues either way', () => {
    let thrown: ArvoEventHandlerValidationError | null = null;
    try {
      refused().build();
    } catch (raised) {
      thrown = raised as ArvoEventHandlerValidationError;
    }
    const reported = refused().tryBuild();
    expect(
      !reported.ok && reported.error.issues.map((one) => one.path),
    ).toEqual(thrown?.issues.map((one) => one.path));
  });
});

describe('a failure that is not a refused declaration', () => {
  it('goes up as it arrived, rather than becoming a reported issue', () => {
    // a declaration that cannot be read at all is not a declaration rule
    // being broken, so the reported error type must not claim it is
    const broken = Object.create(
      ArvoEventHandlerSetup.prototype,
    ) as ArvoEventHandlerSetup;
    Object.defineProperty(broken, 'contracts', {
      get() {
        throw new TypeError('the declaration could not be read');
      },
    });
    expect(() => broken.tryBuild()).toThrow(TypeError);
  });
});

describe('what building leaves the declaration as', () => {
  it('leaves the chain unchanged, so it can be built again', () => {
    const chain = valid();
    chain.build();
    expect(chain.versions).toHaveLength(1);
    expect(chain.build()).toBeInstanceOf(ArvoEventHandler);
  });

  it('leaves a chain unchanged by a further version being added to it', () => {
    const chain = setupArvoEventHandler({ contracts: { self: twoVersions } })
      .handler('1.0.0', executor)
      .handler('1.1.0', executor);
    const branch = chain.handler('1.0.0', executor);
    expect(chain.build()).toBeInstanceOf(ArvoEventHandler);
    expect(() => branch.build()).toThrow(ArvoEventHandlerValidationError);
  });
});
