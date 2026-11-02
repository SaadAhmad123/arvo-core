import type { ArvoOutboxStateCommit } from '../../ArvoOutbox/types/commit.js';
import type { JSONObject } from '../../types.js';
import { ErrorIssue } from '../../utils/error-issue.js';
import { ArvoOutboxDriverValidationError } from '../errors.js';

/** The fields a commit carries beside the record, so the outbox never opens it. */
export type ArvoOutboxCommitFields = Pick<
  ArvoOutboxStateCommit,
  'executionId' | 'casVersion' | 'subject' | 'source' | 'version' | 'lifecycle'
>;

/**
 * The six fields a commit carries, read off the record, or a validation
 * error naming every one missing or mistyped. The record is a defect of its
 * builder where this throws, so the outbox is never called with it.
 */
export const liftCommitFields = (
  record: JSONObject,
): ArvoOutboxCommitFields => {
  const issues: ErrorIssue[] = [];

  /** A field that must be a non-empty string, or an issue and a stand-in never used. */
  const readText = (fieldName: string): string => {
    const fieldValue = record[fieldName];
    if (typeof fieldValue === 'string' && fieldValue !== '') return fieldValue;
    issues.push(
      new ErrorIssue({
        path: `record.${fieldName}`,
        message: 'must be a non-empty string',
        received: fieldValue,
      }),
    );
    return '';
  };

  /** The revision, a whole number zero or more, or an issue and a stand-in never used. */
  const readCasVersion = (): number => {
    const fieldValue = record.casVersion;
    if (
      typeof fieldValue === 'number' &&
      Number.isInteger(fieldValue) &&
      fieldValue >= 0
    ) {
      return fieldValue;
    }
    issues.push(
      new ErrorIssue({
        path: 'record.casVersion',
        message: 'must be a whole number, zero or more',
        received: fieldValue,
      }),
    );
    return 0;
  };

  const commitFields: ArvoOutboxCommitFields = {
    executionId: readText('executionId'),
    casVersion: readCasVersion(),
    subject: readText('subject'),
    source: readText('source'),
    version: readText('version'),
    lifecycle: readText('lifecycle'),
  };
  // the stand-ins above are never returned: any issue throws here
  if (issues.length > 0) throw new ArvoOutboxDriverValidationError(issues);
  return commitFields;
};
