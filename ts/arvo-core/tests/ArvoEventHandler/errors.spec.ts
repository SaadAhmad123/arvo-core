import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../src/ArvoContract/index.js';
import { ArvoEventHandlerValidationError } from '../../src/ArvoEventHandler/errors.js';
import { setupArvoEventHandler } from '../../src/factories/setupArvoEventHandler.js';
import { ErrorIssue } from '../../src/utils/error-issue.js';

const issue = (path: string, message: string, blockingReason?: string) =>
  new ErrorIssue({ path, message, blockingReason });

describe('what a refused declaration reports', () => {
  it('carries every issue it was given', () => {
    const refused = new ArvoEventHandlerValidationError([
      issue('contract', 'must be an ArvoContract'),
      issue('services.payments', 'is declared twice'),
    ]);
    expect(refused.issues).toHaveLength(2);
  });

  it('names every rule in the message, not only the first', () => {
    const refused = new ArvoEventHandlerValidationError([
      issue('versions["1.0.0"]', 'has no executor'),
      issue('versions["1.1.0"]', 'has no executor'),
    ]);
    expect(refused.message).toContain('1.0.0');
    expect(refused.message).toContain('1.1.0');
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
    const refused = new ArvoEventHandlerValidationError([
      issue('contract', 'must be an ArvoContract'),
    ]);
    expect(() =>
      (refused.issues as ErrorIssue[]).push(issue('x', 'y')),
    ).toThrow();
  });

  it('says the list is partial where one issue stopped the rest', () => {
    const refused = new ArvoEventHandlerValidationError([
      issue('contract', 'must be an ArvoContract', 'every other rule reads it'),
    ]);
    expect(refused.issues[0]?.isBlocking).toBe(true);
  });

  it('keeps an underlying failure where one is given', () => {
    const underneath = new Error('the declaration could not be read');
    const refused = new ArvoEventHandlerValidationError([], {
      cause: underneath,
    });
    expect(refused.cause).toBe(underneath);
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
  const twoVersions = new ArvoContract({
    type: 'com_report_build',
    versions: {
      '1.0.0': { input: z.object({ of: z.string() }), outputs: {} },
      '1.1.0': { input: z.object({ of: z.string() }), outputs: {} },
    },
  });
  const executor = async () => {};

  it('reports two unrelated rules together', () => {
    const reported = setupArvoEventHandler({
      contracts: { self: twoVersions },
      options: { maxDepth: -1 },
    })
      .handler('1.0.0', executor)
      .tryBuild();
    expect(
      !reported.ok && reported.error.issues.map((one) => one.path),
    ).toEqual(['options.maxDepth', 'versions["1.1.0"]']);
  });

  it('reports a non-contract alone, every other rule reading it', () => {
    const reported = setupArvoEventHandler({
      // what a JavaScript caller could pass where the types refuse it
      contracts: { self: 'com_order_create' as unknown as ArvoContract },
      options: { maxDepth: -1 },
    }).tryBuild();
    expect(!reported.ok && reported.error.issues).toHaveLength(1);
    expect(!reported.ok && reported.error.issues[0]?.isBlocking).toBe(true);
  });

  it('names the version and the option an issue is about', () => {
    const reported = setupArvoEventHandler({ contracts: { self: twoVersions } })
      .handler('1.0.0', {
        options: { collect: 'some' as 'all' },
        execute: executor,
      })
      .handler('1.1.0', executor)
      .tryBuild();
    expect(!reported.ok && reported.error.issues[0]?.path).toBe(
      'versions["1.0.0"].options.collect',
    );
  });

  it('names the version a timeout relation is in force for', () => {
    const reported = setupArvoEventHandler({ contracts: { self: twoVersions } })
      .handler('1.0.0', {
        options: { runTimeout: 30_000, executionTimeout: 1_000 },
        execute: executor,
      })
      .handler('1.1.0', executor)
      .tryBuild();
    expect(!reported.ok && reported.error.issues[0]?.path).toBe(
      'versions["1.0.0"].options.executionTimeout',
    );
  });
});
