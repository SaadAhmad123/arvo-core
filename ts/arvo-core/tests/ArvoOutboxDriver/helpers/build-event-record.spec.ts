import { describe, expect, it } from 'vitest';
import { buildEventRecord } from '../../../src/ArvoOutboxDriver/helpers/build-event-record.js';
import { createArvoEvent } from '../../../src/factories/createArvoEvent.js';
import { ArvoEventSerializer } from '../../../src/serializers/ArvoEventSerializer/index.js';

/** Writes events as CloudEvent JSON, as the driver's own serializer does. */
const cloudEventSerializer = new ArvoEventSerializer({ type: 'cloudevent' });

/** An event with every field an event record takes from it set. */
const event = createArvoEvent({
  id: 'event-1',
  type: 'com_payment_charge',
  source: 'com_order_create',
  subject: 'subject-1',
  executionid: 'execution-1',
  parentid: 'parent-1',
  initid: 'init-1',
  to: 'com_payment_charge',
  domain: 'payments',
  dataschema: '#/com/payment/charge/1.0.0',
  data: { amount: 10 },
});

describe('building the event record that stores an event', () => {
  it("takes the event's own fields, the delivery's identifier and the record's revision", async () => {
    const eventRecord = await buildEventRecord(cloudEventSerializer, event, {
      triggeringEventId: 'triggering-1',
      casVersion: 4,
    });
    expect(eventRecord).toEqual({
      id: 'event-1',
      subject: 'subject-1',
      executionId: 'execution-1',
      casVersion: 4,
      parentId: 'parent-1',
      initId: 'init-1',
      triggeringEventId: 'triggering-1',
      source: 'com_order_create',
      type: 'com_payment_charge',
      to: 'com_payment_charge',
      domain: 'payments',
      time: event.time,
      payload: eventRecord.payload,
    });
  });

  it('carries no revision where the events commit alone', async () => {
    const eventRecord = await buildEventRecord(cloudEventSerializer, event, {
      triggeringEventId: 'triggering-1',
      casVersion: null,
    });
    expect(eventRecord.casVersion).toBeNull();
  });

  it('carries no parent, origin, destination or domain where the event has none', async () => {
    const bareEvent = createArvoEvent({
      type: 'com_payment_charge',
      source: 'com_order_create',
      dataschema: '#/com/payment/charge/1.0.0',
      data: {},
    });
    const eventRecord = await buildEventRecord(
      cloudEventSerializer,
      bareEvent,
      {
        triggeringEventId: 'triggering-1',
        casVersion: null,
      },
    );
    expect([eventRecord.parentId, eventRecord.to, eventRecord.domain]).toEqual([
      bareEvent.parentid,
      bareEvent.to,
      bareEvent.domain,
    ]);
  });

  it('stores the event as its CloudEvent JSON, which restores to the same event', async () => {
    const eventRecord = await buildEventRecord(cloudEventSerializer, event, {
      triggeringEventId: 'triggering-1',
      casVersion: 4,
    });
    const serializer = new ArvoEventSerializer();
    expect(eventRecord.payload).toBe(await serializer.serialize(event));
    expect(JSON.parse(eventRecord.payload).specversion).toBe('1.0');
    const restoredEvent = await serializer.deserialize(eventRecord.payload);
    expect(await serializer.serialize(restoredEvent)).toBe(eventRecord.payload);
  });
});
