import { describe, expect, it } from 'vitest';
import type { ArvoOutboxCommittedEventRecord } from '../../../src/ArvoOutbox/types/event-record.js';
import {
  buildCommittedRecordsSchema,
  checkCommittedRecords,
} from '../../../src/ArvoOutboxDriver/helpers/check-committed-records.js';

/** A committed event record with every field of the type it must have. */
const completeRecord: ArvoOutboxCommittedEventRecord = {
  id: 'event-1',
  subject: 'subject-1',
  executionId: 'execution-1',
  casVersion: 0,
  parentId: null,
  initId: 'init-1',
  triggeringEventId: 'triggering-1',
  source: 'com_order_create',
  type: 'com_payment_charge',
  to: null,
  domain: 'payments',
  time: '2026-01-01T00:00:00.000Z',
  payload: '{}',
  committedAt: '2026-01-01T00:00:00.000Z',
  seen: false,
};

describe("checking a read of events' answer", () => {
  it('accepts a list of complete records, nothing missing or mistyped', () => {
    const answer = [
      completeRecord,
      { ...completeRecord, id: 'event-2', casVersion: null, seen: true },
    ];
    const recordsResult = checkCommittedRecords(
      buildCommittedRecordsSchema(),
      answer,
    );
    expect(recordsResult.ok && recordsResult.value).toEqual(answer);
  });

  it('accepts no records', () => {
    expect(checkCommittedRecords(buildCommittedRecordsSchema(), [])).toEqual({
      ok: true,
      value: [],
    });
  });

  it.each([null, undefined, 'records', { records: [] }])(
    'refuses %o, which is not a list, as a malformed response',
    (answer) => {
      const recordsResult = checkCommittedRecords(
        buildCommittedRecordsSchema(),
        answer,
      );
      expect(!recordsResult.ok && recordsResult.error.kind).toBe(
        'malformed_response',
      );
    },
  );

  it.each([
    ['id', 1],
    ['subject', null],
    ['executionId', undefined],
    ['casVersion', '0'],
    ['casVersion', -1],
    ['casVersion', 0.5],
    ['parentId', 1],
    ['initId', false],
    ['triggeringEventId', null],
    ['source', {}],
    ['type', []],
    ['to', 3],
    ['domain', true],
    ['time', 0],
    ['payload', { raw: true }],
    ['committedAt', null],
    ['seen', 'no'],
  ])(
    'refuses a record whose %s is %o, as a malformed event, naming it',
    (field, fieldValue) => {
      const recordsResult = checkCommittedRecords(
        buildCommittedRecordsSchema(),
        [completeRecord, { ...completeRecord, [field]: fieldValue }],
      );
      expect(!recordsResult.ok && recordsResult.error.kind).toBe(
        'malformed_event',
      );
      expect(
        !recordsResult.ok &&
          recordsResult.error.issues.map((issue) => issue.path),
      ).toEqual([`records[1].${field}`]);
    },
  );

  it('refuses a record that is not an object, as a malformed event', () => {
    const recordsResult = checkCommittedRecords(buildCommittedRecordsSchema(), [
      completeRecord,
      'a record',
    ]);
    expect(
      !recordsResult.ok &&
        recordsResult.error.issues.map((issue) => issue.path),
    ).toEqual(['records[1]']);
  });

  it('names every field wrong across every record at once', () => {
    const recordsResult = checkCommittedRecords(buildCommittedRecordsSchema(), [
      { ...completeRecord, id: 1 },
      { ...completeRecord, seen: 'no', time: 0 },
    ]);
    expect(
      !recordsResult.ok &&
        recordsResult.error.issues.map((issue) => issue.path),
    ).toEqual(['records[0].id', 'records[1].time', 'records[1].seen']);
  });
});
