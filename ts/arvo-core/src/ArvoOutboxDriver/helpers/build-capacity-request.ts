import type { ArvoOutboxCapacityRequest } from '../../ArvoOutbox/types/capacity.js';
import type { ArvoOutboxDriverCapacityParam } from '../types.js';
import { liftCommitFields } from './lift-commit-fields.js';

/**
 * The facts of what would be committed, as the outbox is asked about them:
 * the event count and the record's revision, the event count alone, or one
 * event and a first revision where nothing is given. Throws the validation
 * error where the record lacks a field its commit would lift.
 */
export const buildCapacityRequest = (
  param: ArvoOutboxDriverCapacityParam,
): ArvoOutboxCapacityRequest => {
  if ('state' in param) {
    return {
      events: param.events.length,
      state: { casVersion: liftCommitFields(param.state).casVersion },
    };
  }
  if ('events' in param) return { events: param.events.length };
  return { events: 1, state: { casVersion: 0 } };
};
