import { closeSync, openSync } from 'node:fs';

/**
 * Creates `filename` readable and writable by its owner alone, where it is
 * missing, so SQLite, which gives the files beside it the same permissions,
 * never makes what an outbox holds readable by other users. A file that
 * already exists is left as it is.
 */
export const createOwnerOnlyFile = (filename: string): void => {
  try {
    closeSync(openSync(filename, 'wx', 0o600));
  } catch (error_) {
    if (
      typeof error_ === 'object' &&
      error_ !== null &&
      'code' in error_ &&
      error_.code === 'EEXIST'
    ) {
      return;
    }
    throw error_;
  }
};
