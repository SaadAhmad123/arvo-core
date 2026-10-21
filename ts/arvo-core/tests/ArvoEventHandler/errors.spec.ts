import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../src/ArvoContract/index.js';
import { ArvoEventHandlerValidationError } from '../../src/ArvoEventHandler/errors.js';
import { setupArvoEventHandler } from '../../src/factories/setupArvoEventHandler.js';
import { ErrorIssue } from '../../src/utils/error-issue.js';

const errorIssue = (path: string, message: string, blockingReason?: string) =>
  new ErrorIssue({ path, message, blockingReason });

describe('what a refused declaration reports', () => {
  it('carries every issue it was given', () => {
    const validationError = new ArvoEventHandlerValidationError([
      errorIssue('contract', 'must be an ArvoContract'),
      errorIssue('services.payments', 'is declared twice'),
    ]);
    expect(validationError.issues).toHaveLength(2);
  });

  it('names every rule in the message, not only the first', () => {
    const validationError = new ArvoEventHandlerValidationError([
      errorIssue('versions["1.0.0"]', 'has no executor'),
      errorIssue('versions["1.1.0"]', 'has no executor'),
    ]);
    expect(validationError.message).toContain('1.0.0');
    expect(validationError.message).toContain('1.1.0');
  });

  it('identifies itself without an instanceof check', () => {
    expect(new ArvoEventHandlerValidationError([])._tag).toBe(
      'ArvoEventHandlerValidationError',
    );
    expect(new ArvoEventHandlerValidationError([]).name).toBe(
      'ArvoEventHandlerValidationError',
    );
  });

  it('is an Error, so it throws and catches like one', () => {
    expect(() => {
      throw new ArvoEventHandlerValidationError([]);
    }).toThrow(Error);
  });

  it('holds its issues against being written into afterwards', () => {
    const validationError = new ArvoEventHandlerValidationError([
      errorIssue('contract', 'must be an ArvoContract'),
    ]);
    expect(() =>
      (validationError.issues as ErrorIssue[]).push(errorIssue('x', 'y')),
    ).toThrow();
  });

  it('says the list is partial where one issue stopped the rest', () => {
    const validationError = new ArvoEventHandlerValidationError([
      errorIssue(
        'contract',
        'must be an ArvoContract',
        'every other rule reads it',
      ),
    ]);
    expect(validationError.issues[0]?.isBlocking).toBe(true);
  });

  it('keeps an underlying failure where one is given', () => {
    const underlyingFailure = new Error('the declaration could not be read');
    const validationError = new ArvoEventHandlerValidationError([], {
      cause: underlyingFailure,
    });
    expect(validationError.cause).toBe(underlyingFailure);
  });
});

describe('what it never means', () => {
  it('says in its own message that it is about a declaration', () => {
    expect(new ArvoEventHandlerValidationError([]).message).toContain(
      'ArvoEventHandler',
    );
  });
});

describe('what a refused declaration reports from a real one', () => {
  const twoVersionContract = new ArvoContract({
    type: 'com_report_build',
    versions: {
      '1.0.0': { input: z.object({ of: z.string() }), outputs: {} },
      '1.1.0': { input: z.object({ of: z.string() }), outputs: {} },
    },
  });
  const executor = async () => {};

  it('reports two unrelated rules together', () => {
    const tryBuildResult = setupArvoEventHandler({
      contracts: { self: twoVersionContract },
      options: { maxDepth: -1 },
    })
      .handler('1.0.0', executor)
      .tryBuild();
    expect(
      !tryBuildResult.ok &&
        tryBuildResult.error.issues.map((issue) => issue.path),
    ).toEqual(['options.maxDepth', 'versions["1.1.0"]']);
  });

  it('reports a non-contract alone, every other rule reading it', () => {
    const tryBuildResult = setupArvoEventHandler({
      // what a JavaScript caller could pass where the types refuse it
      contracts: { self: 'com_order_create' as unknown as ArvoContract },
      options: { maxDepth: -1 },
    }).tryBuild();
    expect(!tryBuildResult.ok && tryBuildResult.error.issues).toHaveLength(1);
    expect(
      !tryBuildResult.ok && tryBuildResult.error.issues[0]?.isBlocking,
    ).toBe(true);
  });

  it('names the version and the option an issue is about', () => {
    const tryBuildResult = setupArvoEventHandler({
      contracts: { self: twoVersionContract },
    })
      .handler('1.0.0', {
        options: { collect: 'some' as 'all' },
        execute: executor,
      })
      .handler('1.1.0', executor)
      .tryBuild();
    expect(!tryBuildResult.ok && tryBuildResult.error.issues[0]?.path).toBe(
      'versions["1.0.0"].options.collect',
    );
  });

  it('names the version a timeout relation is in force for', () => {
    const tryBuildResult = setupArvoEventHandler({
      contracts: { self: twoVersionContract },
    })
      .handler('1.0.0', {
        options: { runTimeout: 30_000, executionTimeout: 1_000 },
        execute: executor,
      })
      .handler('1.1.0', executor)
      .tryBuild();
    expect(!tryBuildResult.ok && tryBuildResult.error.issues[0]?.path).toBe(
      'versions["1.0.0"].options.executionTimeout',
    );
  });
});
