import type { ArvoOutboxStateCommit } from '../../../ArvoOutbox/types/commit.js';

/**
 * A commit of a state with no events, overridden by whatever the case
 * needs fixed.
 */
export const buildStateCommit = (
  overrides: Partial<ArvoOutboxStateCommit> &
    Pick<ArvoOutboxStateCommit, 'executionId' | 'casVersion'>,
): ArvoOutboxStateCommit => ({
  subject: crypto.randomUUID(),
  source: 'com_conformance_source',
  version: '1.0.0',
  lifecycle: 'waiting',
  state: { revision: overrides.casVersion },
  events: [],
  ...overrides,
});
