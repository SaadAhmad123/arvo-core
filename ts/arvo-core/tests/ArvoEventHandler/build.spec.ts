import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../src/ArvoContract/index.js';
import { ArvoEventHandlerValidationError } from '../../src/ArvoEventHandler/errors.js';
import { ArvoEventHandler } from '../../src/ArvoEventHandler/index.js';
import { ArvoEventHandlerSetup } from '../../src/ArvoEventHandler/setup.js';
import { setupArvoEventHandler } from '../../src/factories/setupArvoEventHandler.js';
import { orderContract } from './fixtures.js';

const twoVersionContract = new ArvoContract({
  type: 'com_report_build',
  versions: {
    '1.0.0': { input: z.object({ of: z.string() }), outputs: {} },
    '1.1.0': { input: z.object({ of: z.string() }), outputs: {} },
  },
});

const executor = async () => {};
const completeDeclaration = () =>
  setupArvoEventHandler({ contracts: { self: orderContract } }).handler(
    '1.0.0',
    executor,
  );
const incompleteDeclaration = () =>
  setupArvoEventHandler({ contracts: { self: twoVersionContract } }).handler(
    '1.0.0',
    executor,
  );

describe('the two ways to finish a declaration', () => {
  it('both produce a handler from a declaration that works', () => {
    expect(completeDeclaration().build()).toBeInstanceOf(ArvoEventHandler);
    const tryBuildResult = completeDeclaration().tryBuild();
    expect(tryBuildResult.ok && tryBuildResult.value).toBeInstanceOf(
      ArvoEventHandler,
    );
  });

  it('produce handlers that agree on what they hold', () => {
    const handler = completeDeclaration().build();
    const tryBuildResult = completeDeclaration().tryBuild();
    expect(tryBuildResult.ok && tryBuildResult.value.contracts.self).toBe(
      handler.contracts.self,
    );
    expect(
      tryBuildResult.ok && [...tryBuildResult.value.versions.keys()],
    ).toEqual([...handler.versions.keys()]);
  });

  it('build a different handler each time, rather than one shared', () => {
    expect(completeDeclaration().build()).not.toBe(
      completeDeclaration().build(),
    );
  });
});

describe('a declaration that is refused', () => {
  it('throws from build', () => {
    expect(() => incompleteDeclaration().build()).toThrow(
      ArvoEventHandlerValidationError,
    );
  });

  it('reports from tryBuild rather than throwing', () => {
    const tryBuildResult = incompleteDeclaration().tryBuild();
    expect(tryBuildResult.ok).toBe(false);
  });

  it('reports the same issues either way', () => {
    let thrownError: ArvoEventHandlerValidationError | null = null;
    try {
      incompleteDeclaration().build();
    } catch (thrown) {
      thrownError = thrown as ArvoEventHandlerValidationError;
    }
    const tryBuildResult = incompleteDeclaration().tryBuild();
    expect(
      !tryBuildResult.ok &&
        tryBuildResult.error.issues.map((issue) => issue.path),
    ).toEqual(thrownError?.issues.map((issue) => issue.path));
  });
});

describe('a failure that is not a refused declaration', () => {
  it('goes up as it arrived, rather than becoming a reported issue', () => {
    // a declaration that cannot be read at all is not a declaration rule
    // being broken, so the reported error type must not claim it is
    const unreadableSetup = Object.create(
      ArvoEventHandlerSetup.prototype,
    ) as ArvoEventHandlerSetup;
    Object.defineProperty(unreadableSetup, 'contracts', {
      get() {
        throw new TypeError('the declaration could not be read');
      },
    });
    expect(() => unreadableSetup.tryBuild()).toThrow(TypeError);
  });
});

describe('what building leaves the declaration as', () => {
  it('leaves the chain unchanged, so it can be built again', () => {
    const chain = completeDeclaration();
    chain.build();
    expect(chain.versions).toHaveLength(1);
    expect(chain.build()).toBeInstanceOf(ArvoEventHandler);
  });

  it('leaves a chain unchanged by a further version being added to it', () => {
    const chain = setupArvoEventHandler({
      contracts: { self: twoVersionContract },
    })
      .handler('1.0.0', executor)
      .handler('1.1.0', executor);
    const branch = chain.handler('1.0.0', executor);
    expect(chain.build()).toBeInstanceOf(ArvoEventHandler);
    expect(() => branch.build()).toThrow(ArvoEventHandlerValidationError);
  });
});
