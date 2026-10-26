import { expect } from 'vitest';
import { buildEventRecord } from '../fixtures/event-record.js';
import type { ArvoOutboxConformanceCase } from '../types.js';

/** An event's payload is kept and returned as the same string, never opened. */
export const payloadIsKeptByteForByteCases: readonly ArvoOutboxConformanceCase[] =
  [
    {
      name: 'returns a payload as exactly the string committed',
      check: async (outbox) => {
        const payload = '{ "z":1,  "a":"é\\u00e9 ☃",\n\t"n":1.0, "e":1e3 }';
        const event = buildEventRecord({ payload });
        await outbox.commitEvents({ events: [event] });
        const [committedEvent] = await outbox.readCommittedEvents({
          triggeringEventId: event.triggeringEventId,
        });
        expect(committedEvent?.payload).toBe(payload);
      },
    },
    {
      name: 'stores a payload it could not parse as given',
      check: async (outbox) => {
        const payload = 'not json {';
        const event = buildEventRecord({ payload });
        await outbox.commitEvents({ events: [event] });
        const [committedEvent] = await outbox.readCommittedEvents({
          triggeringEventId: event.triggeringEventId,
        });
        expect(committedEvent?.payload).toBe(payload);
      },
    },
  ];
