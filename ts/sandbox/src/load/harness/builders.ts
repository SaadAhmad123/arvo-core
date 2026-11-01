import {
  type ArvoEvent,
  type ArvoOutboxEventRecord,
  createArvoEvent,
  type JSONObject,
} from 'arvo-core';

/**
 * What checks commit when they go straight at an outbox or its driver,
 * rather than through the handlers.
 */

/** An event record, ready for an outbox, with a payload of about `payloadBytes`. */
export const buildRecord = (
  param: {
    readonly executionId?: string;
    readonly triggeringEventId?: string;
    readonly casVersion?: number | null;
    readonly payloadBytes?: number;
  } = {},
): ArvoOutboxEventRecord => {
  const id = crypto.randomUUID();
  return {
    id,
    subject: crypto.randomUUID(),
    executionId: param.executionId ?? crypto.randomUUID(),
    casVersion: param.casVersion ?? null,
    parentId: null,
    initId: null,
    triggeringEventId: param.triggeringEventId ?? crypto.randomUUID(),
    source: 'com_load_source',
    type: 'com_load_type',
    to: 'com_load_type',
    domain: null,
    time: new Date().toISOString(),
    payload: JSON.stringify({ id, blob: 'x'.repeat(param.payloadBytes ?? 64) }),
  };
};

/** A live event whose data holds about `dataBytes`. */
export const buildEvent = (param: {
  readonly executionId: string;
  readonly dataBytes: number;
}): ArvoEvent =>
  createArvoEvent({
    type: 'com_load_type',
    source: 'com_load_source',
    subject: param.executionId,
    executionid: param.executionId,
    to: 'com_load_type',
    dataschema: '#/com/load/type/1.0.0',
    data: { blob: 'x'.repeat(param.dataBytes) },
  });

/** A record a handler would produce: the fields a commit lifts, and a body of the shape asked for. */
export const buildState = (param: {
  readonly executionId: string;
  readonly casVersion: number;
  readonly lifecycle?: string;
  readonly body?: JSONObject;
}): JSONObject => ({
  executionId: param.executionId,
  casVersion: param.casVersion,
  subject: param.executionId,
  source: 'com_load_source',
  version: '1.0.0',
  lifecycle: param.lifecycle ?? 'waiting',
  body: param.body ?? {},
});

/** A JSON value nested `depth` deep, each level holding a few fields. */
export const nestedBody = (depth: number): JSONObject => {
  let body: JSONObject = { leaf: true };
  for (let level = 0; level < depth; level += 1) {
    body = { level, label: `level-${level}`, child: body };
  }
  return body;
};

/** Waits real time, for an outbox's own timer to run. */
export const waitMs = (durationMs: number) =>
  new Promise<void>((settle) => setTimeout(settle, durationMs));
