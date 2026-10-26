import type { ArvoOutboxEventRecord } from '../../../ArvoOutbox/types/event-record.js';

/**
 * An event record with identifiers no other case uses, overridden by
 * whatever the case needs fixed.
 */
export const buildEventRecord = (
  overrides: Partial<ArvoOutboxEventRecord> = {},
): ArvoOutboxEventRecord => {
  const id = overrides.id ?? crypto.randomUUID();
  return {
    id,
    subject: crypto.randomUUID(),
    executionId: crypto.randomUUID(),
    casVersion: null,
    parentId: null,
    initId: null,
    triggeringEventId: crypto.randomUUID(),
    source: 'com_conformance_source',
    type: 'com_conformance_type',
    to: 'com_conformance_type',
    domain: null,
    time: new Date().toISOString(),
    payload: JSON.stringify({ id, specversion: '1.0' }),
    ...overrides,
  };
};
