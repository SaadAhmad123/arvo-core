import { describe, expect, it } from 'vitest';
import {
  ArvoOutboxDriverError,
  type ArvoOutboxDriverErrorKind,
  ArvoOutboxDriverValidationError,
} from '../../src/ArvoOutboxDriver/errors.js';
import { ErrorIssue } from '../../src/utils/error-issue.js';

describe('an outbox driver error', () => {
  it.each<[ArvoOutboxDriverErrorKind, string]>([
    [
      'state_exists',
      'the outbox refused it: a state already exists for the execution, and this one claimed to be its first',
    ],
    [
      'revision_stale',
      'the outbox refused it: the stored revision is not the one this state follows',
    ],
    ['unavailable', 'the outbox threw, so it could not do its work'],
    [
      'malformed_state',
      'the outbox answered a state that is not a JSON object or none',
    ],
    [
      'malformed_event',
      'the outbox answered an event record missing a field, holding one of the wrong type, or whose payload does not restore to an Arvo event',
    ],
    [
      'malformed_response',
      'the outbox answered with something of the wrong shape',
    ],
  ])('names the operation and what %s means', (kind, meaning) => {
    const error = new ArvoOutboxDriverError({
      kind,
      operationName: 'commitStateAndEvents',
    });
    expect(error.message).toBe(
      `ArvoOutboxDriver.commitStateAndEvents failed (${kind}): ${meaning}.`,
    );
    expect(error.kind).toBe(kind);
    expect(error.operationName).toBe('commitStateAndEvents');
    expect(error.issues).toEqual([]);
  });

  it('carries what the outbox threw as its cause, and describes it', () => {
    const thrown = new Error('connection refused');
    const error = new ArvoOutboxDriverError({
      kind: 'unavailable',
      operationName: 'readLatestState',
      cause: thrown,
    });
    expect(error.cause).toBe(thrown);
    expect(error.message).toBe(
      'ArvoOutboxDriver.readLatestState failed (unavailable): the outbox threw, so it could not do its work. It threw Error: connection refused.',
    );
  });

  it('lists every problem found in what the outbox answered', () => {
    const issues = [
      new ErrorIssue({
        path: 'records[0].id',
        message: 'must be a string',
        received: 3,
      }),
      new ErrorIssue({
        path: 'records[1].seen',
        message: 'must be a boolean',
        received: 'no',
      }),
    ];
    const error = new ArvoOutboxDriverError({
      kind: 'malformed_event',
      operationName: 'readCommittedEvents',
      issues,
    });
    expect(error.issues).toEqual(issues);
    expect(Object.isFrozen(error.issues)).toBe(true);
    expect(error.message).toContain('The following 2 problems were found:');
    expect(error.message).toContain('records[0].id');
  });

  it('is an Error, told apart by its tag and its name', () => {
    const error = new ArvoOutboxDriverError({
      kind: 'unavailable',
      operationName: 'open',
    });
    expect(error).toBeInstanceOf(Error);
    expect(error._tag).toBe('ArvoOutboxDriverError');
    expect(error.name).toBe('ArvoOutboxDriverError');
  });
});

describe('an outbox driver validation error', () => {
  const issues = [
    new ErrorIssue({
      path: 'record.executionId',
      message: 'must be a non-empty string',
    }),
    new ErrorIssue({
      path: 'record.casVersion',
      message: 'must be a whole number, zero or more',
      received: -1,
    }),
  ];

  it('names every field the driver could not lift off the record', () => {
    const error = new ArvoOutboxDriverValidationError(issues);
    expect(error.message).toContain(
      'The execution record handed to ArvoOutboxDriver cannot be committed, because it lacks fields the commit carries.',
    );
    expect(error.message).toContain('record.executionId');
    expect(error.message).toContain('record.casVersion');
  });

  it('carries a frozen copy of every issue', () => {
    const given = [...issues];
    const error = new ArvoOutboxDriverValidationError(given);
    given.pop();
    expect(error.issues).toEqual(issues);
    expect(Object.isFrozen(error.issues)).toBe(true);
  });

  it('is an Error, told apart by its tag and its name', () => {
    const error = new ArvoOutboxDriverValidationError(issues);
    expect(error).toBeInstanceOf(Error);
    expect(error._tag).toBe('ArvoOutboxDriverValidationError');
    expect(error.name).toBe('ArvoOutboxDriverValidationError');
  });
});
