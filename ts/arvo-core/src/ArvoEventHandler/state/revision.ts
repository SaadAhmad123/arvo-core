import type { ArvoEntryKind } from '../context/types.js';
import type { ArvoExecutionState } from './index.js';
import { mutateState } from './utils.js';

/**
 * The record at the revision this execution will commit it under.
 *
 * An execution that opened one commits the revision it was built at: no
 * record was read, and a store takes it only where none exists. One that
 * read a record commits the revision after the one it read, which is what
 * lets a store tell whether another write landed in between.
 *
 * @param state - The record as this execution leaves it.
 * @param entry - How the execution arrived.
 *
 * @example
 * ```typescript
 * const committing = atNextRevision(settled, 'followup');
 * committing.casVersion; // the stored record's, plus one
 * ```
 */
export const atNextRevision = <TState extends ArvoExecutionState>(
  state: TState,
  entry: ArvoEntryKind,
): TState =>
  entry === 'init'
    ? state
    : mutateState(state, { casVersion: state.casVersion + 1 });
