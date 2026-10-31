import { describe, expect, it } from 'vitest';
import { ArvoOutboxDriverValidationError } from '../../../src/ArvoOutboxDriver/errors.js';
import { buildCapacityRequest } from '../../../src/ArvoOutboxDriver/helpers/build-capacity-request.js';
import { createArvoEvent } from '../../../src/factories/createArvoEvent.js';

/** An event to count, as a handler would return it. */
const event = createArvoEvent({
  id: 'event-1',
  type: 'com_payment_charge',
  source: 'com_order_create',
  subject: 'subject-1',
  executionid: 'execution-1',
  parentid: 'parent-1',
  initid: 'init-1',
  dataschema: '#/com/payment/charge/1.0.0',
  data: { amount: 10 },
});

/** The delivered event both commits answer. */
const triggeringEvent = createArvoEvent({
  id: 'triggering-1',
  type: 'com_order_create',
  source: 'com_caller',
  subject: 'subject-1',
  executionid: 'subject-1',
  dataschema: '#/com/order/create/1.0.0',
  data: {},
});

/** A record carrying every field a commit lifts. */
const record = {
  executionId: 'execution-1',
  casVersion: 3,
  subject: 'subject-1',
  source: 'com_order_create',
  version: '1.0.0',
  lifecycle: 'waiting',
};

describe('building what the outbox is asked to make room for', () => {
  it("asks for a commit with a record with its event count and the record's revision", () => {
    expect(
      buildCapacityRequest({
        state: record,
        events: [event, event],
        triggeringEvent,
      }),
    ).toEqual({ events: 2, state: { casVersion: 3 } });
  });

  it('asks for events alone with their count and no state', () => {
    expect(buildCapacityRequest({ events: [event], triggeringEvent })).toEqual({
      events: 1,
    });
  });

  it('counts a commit with a record and no events as no events', () => {
    expect(
      buildCapacityRequest({ state: record, events: [], triggeringEvent }),
    ).toEqual({ events: 0, state: { casVersion: 3 } });
  });

  it('asks, given nothing, for one event and a state at the first revision', () => {
    expect(buildCapacityRequest({})).toEqual({
      events: 1,
      state: { casVersion: 0 },
    });
  });

  it('asks the same, given only telemetry', () => {
    expect(buildCapacityRequest({ telemetry: {} })).toEqual({
      events: 1,
      state: { casVersion: 0 },
    });
  });

  it('throws the validation error for a record the commit would refuse', () => {
    const { casVersion: _dropped, ...recordWithoutRevision } = record;
    expect(() =>
      buildCapacityRequest({
        state: recordWithoutRevision,
        events: [event],
        triggeringEvent,
      }),
    ).toThrow(ArvoOutboxDriverValidationError);
  });
});
