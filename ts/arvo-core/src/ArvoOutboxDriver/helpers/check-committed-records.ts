import { err, ok } from 'neverthrow';
import type { ArvoOutboxCommittedEventRecord } from '../../ArvoOutbox/types/event-record.js';
import { fromNeverthrow } from '../../result.js';
import type { Result } from '../../types.js';
import { ErrorIssue } from '../../utils/error-issue.js';
import { isObjectRecord } from './is-object-record.js';

/** Why a read of events answered wrongly, and every place it did. */
export type CommittedRecordsFailure = {
  readonly kind: 'malformed_response' | 'malformed_event';
  readonly issues: readonly ErrorIssue[];
};

/**
 * One committed event record, every field read with its type, or issues
 * and stand-ins never returned.
 */
const readCommittedRecord = (
  candidate: Readonly<Record<string, unknown>>,
  path: string,
  issues: ErrorIssue[],
): ArvoOutboxCommittedEventRecord => {
  const report = (fieldName: string, rule: string) =>
    issues.push(
      new ErrorIssue({
        path: `${path}.${fieldName}`,
        message: rule,
        received: candidate[fieldName],
      }),
    );
  const readText = (fieldName: string): string => {
    const fieldValue = candidate[fieldName];
    if (typeof fieldValue === 'string') return fieldValue;
    report(fieldName, 'must be a string');
    return '';
  };
  const readTextOrNone = (fieldName: string): string | null => {
    const fieldValue = candidate[fieldName];
    if (typeof fieldValue === 'string' || fieldValue === null)
      return fieldValue;
    report(fieldName, 'must be a string or null');
    return null;
  };
  const readCasVersion = (): number | null => {
    const fieldValue = candidate.casVersion;
    if (
      fieldValue === null ||
      (typeof fieldValue === 'number' &&
        Number.isInteger(fieldValue) &&
        fieldValue >= 0)
    ) {
      return fieldValue;
    }
    report('casVersion', 'must be a whole number zero or more, or null');
    return null;
  };
  const readSeen = (): boolean => {
    const fieldValue = candidate.seen;
    if (typeof fieldValue === 'boolean') return fieldValue;
    report('seen', 'must be a boolean');
    return false;
  };
  return {
    id: readText('id'),
    subject: readText('subject'),
    executionId: readText('executionId'),
    casVersion: readCasVersion(),
    parentId: readTextOrNone('parentId'),
    initId: readTextOrNone('initId'),
    triggeringEventId: readText('triggeringEventId'),
    source: readText('source'),
    type: readText('type'),
    to: readTextOrNone('to'),
    domain: readTextOrNone('domain'),
    time: readText('time'),
    payload: readText('payload'),
    committedAt: readText('committedAt'),
    seen: readSeen(),
  };
};

/**
 * A read of events' answer as committed event records, every field of every
 * one with its type, or why not: `malformed_response` where the answer is no
 * list, `malformed_event` naming every field wrong in any record.
 */
export const checkCommittedRecords = (
  answer: unknown,
): Result<
  readonly ArvoOutboxCommittedEventRecord[],
  CommittedRecordsFailure
> => {
  if (!Array.isArray(answer)) {
    return fromNeverthrow(
      err({
        kind: 'malformed_response',
        issues: [
          new ErrorIssue({
            path: 'records',
            message: 'must be a list of committed event records',
            received: answer,
          }),
        ],
      }),
    );
  }
  const issues: ErrorIssue[] = [];
  const committedRecords = answer.map((candidate: unknown, recordPosition) => {
    const path = `records[${recordPosition}]`;
    if (isObjectRecord(candidate)) {
      return readCommittedRecord(candidate, path, issues);
    }
    issues.push(
      new ErrorIssue({
        path,
        message: 'must be a committed event record',
        received: candidate,
      }),
    );
    return null;
  });
  // the stand-ins read above are never returned: any issue answers the failure here
  if (issues.length > 0) {
    return fromNeverthrow(err({ kind: 'malformed_event', issues }));
  }
  return fromNeverthrow(
    ok(committedRecords.filter((committedRecord) => committedRecord !== null)),
  );
};
