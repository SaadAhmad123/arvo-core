import { err, ok } from 'neverthrow';
import type { ArvoOutboxCommittedEventRecord } from '../../ArvoOutbox/types/event-record.js';
import { fromNeverthrow } from '../../result.js';
import type { ArvoEventSerializer } from '../../serializers/ArvoEventSerializer/index.js';
import type { AsyncResult } from '../../types.js';
import { ErrorIssue } from '../../utils/error-issue.js';
import { ArvoOutboxDriverError } from '../errors.js';
import type { ArvoOutboxDriverEventEntry } from '../types.js';
import { restoreEvent } from './restore-event.js';

/**
 * Each committed record beside the live event its payload holds, or with no
 * event where `restoreEvents` is off; `malformed_event` naming every payload
 * that will not restore.
 */
export const restoreEntries = async (param: {
  readonly cloudEventSerializer: ArvoEventSerializer;
  readonly committedRecords: readonly ArvoOutboxCommittedEventRecord[];
  readonly restoreEvents: boolean;
  readonly operationName: string;
}): AsyncResult<
  readonly ArvoOutboxDriverEventEntry[],
  ArvoOutboxDriverError
> => {
  if (!param.restoreEvents) {
    return fromNeverthrow(
      ok(param.committedRecords.map((record) => ({ record, event: null }))),
    );
  }
  const restorations = await Promise.all(
    param.committedRecords.map(async (record) => ({
      record,
      restoreResult: await restoreEvent(
        param.cloudEventSerializer,
        record.payload,
      ),
    })),
  );
  const entries: ArvoOutboxDriverEventEntry[] = [];
  const issues: ErrorIssue[] = [];
  const restoreFailures: Error[] = [];
  restorations.forEach(({ record, restoreResult }, recordPosition) => {
    if (restoreResult.ok) {
      entries.push({ record, event: restoreResult.value });
      return;
    }
    restoreFailures.push(restoreResult.error);
    issues.push(
      new ErrorIssue({
        path: `records[${recordPosition}].payload`,
        message: 'must restore to an Arvo event',
        received: restoreResult.error,
      }),
    );
  });
  if (issues.length > 0) {
    return fromNeverthrow(
      err(
        new ArvoOutboxDriverError({
          kind: 'malformed_event',
          operationName: param.operationName,
          cause: restoreFailures[0],
          issues,
        }),
      ),
    );
  }
  return fromNeverthrow(ok(entries));
};
