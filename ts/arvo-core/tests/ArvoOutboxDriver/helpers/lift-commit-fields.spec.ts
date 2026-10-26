import { describe, expect, it } from 'vitest';
import { ArvoOutboxDriverValidationError } from '../../../src/ArvoOutboxDriver/errors.js';
import { liftCommitFields } from '../../../src/ArvoOutboxDriver/helpers/lift-commit-fields.js';
import type { JSONObject } from '../../../src/types.js';

/** A record carrying every field a commit lifts, among others it does not. */
const completeRecord: JSONObject = {
  executionId: 'execution-1',
  casVersion: 3,
  subject: 'subject-1',
  source: 'com_order_create',
  version: '1.0.0',
  lifecycle: 'waiting',
  data: { anything: true },
};

/** The issues a record is refused with. */
const issuesFor = (record: JSONObject) => {
  try {
    liftCommitFields(record);
  } catch (error_) {
    if (error_ instanceof ArvoOutboxDriverValidationError) {
      return error_.issues.map((issue) => issue.path);
    }
    throw error_;
  }
  throw new Error('the record was not refused');
};

describe('lifting the commit fields off a record', () => {
  it('lifts the six fields a commit carries, and nothing else', () => {
    expect(liftCommitFields(completeRecord)).toEqual({
      executionId: 'execution-1',
      casVersion: 3,
      subject: 'subject-1',
      source: 'com_order_create',
      version: '1.0.0',
      lifecycle: 'waiting',
    });
  });

  it('lifts the first revision', () => {
    expect(
      liftCommitFields({ ...completeRecord, casVersion: 0 }).casVersion,
    ).toBe(0);
  });

  it('refuses a record missing a field, naming it', () => {
    const { lifecycle: _lifecycle, ...withoutLifecycle } = completeRecord;
    expect(issuesFor(withoutLifecycle)).toEqual(['record.lifecycle']);
  });

  it.each([
    ['executionId', 7],
    ['executionId', ''],
    ['subject', null],
    ['source', ['com_order_create']],
    ['version', { major: 1 }],
    ['lifecycle', true],
  ])('refuses a %s that is not a non-empty string', (field, fieldValue) => {
    expect(issuesFor({ ...completeRecord, [field]: fieldValue })).toEqual([
      `record.${field}`,
    ]);
  });

  it.each([-1, 1.5, '3', null])('refuses a revision of %s', (casVersion) => {
    expect(issuesFor({ ...completeRecord, casVersion })).toEqual([
      'record.casVersion',
    ]);
  });

  it('names every field wrong at once', () => {
    expect(issuesFor({ data: {} })).toEqual([
      'record.executionId',
      'record.casVersion',
      'record.subject',
      'record.source',
      'record.version',
      'record.lifecycle',
    ]);
  });
});
