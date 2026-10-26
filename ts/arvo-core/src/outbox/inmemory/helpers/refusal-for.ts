import type { ArvoOutboxRefusal } from '../../../ArvoOutbox/types/commit.js';

/** The revision that marks an execution's first state, per ADR-007. */
const firstCasVersion = 0;

/**
 * Which refusal, if any, a commit at `casVersion` meets, where
 * `storedCasVersion` is the latest revision stored for its execution and
 * absent where nothing is.
 */
export const refusalFor = (param: {
  readonly casVersion: number;
  readonly storedCasVersion?: number;
}): ArvoOutboxRefusal | null => {
  if (param.casVersion === firstCasVersion) {
    return param.storedCasVersion === undefined ? null : 'state_exists';
  }
  return param.storedCasVersion !== undefined &&
    param.casVersion === param.storedCasVersion + 1
    ? null
    : 'revision_stale';
};
