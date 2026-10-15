import { describe, expect, it } from 'vitest';
import { deriveArvoExecutionId } from '../../../src/ArvoEventHandler/helpers/execution-id.js';
import { disagreementsWithInitEvent } from '../../../src/ArvoEventHandler/state/agreement.js';
import { cloneArvoEvent } from '../../../src/factories/cloneArvoEvent.js';
import { chargedEvent, initEvent, orderVersion } from '../fixtures.js';
import { buildState } from './fixtures.js';

/** A record that says about itself exactly what its init event says. */
const agreeing = async (overrides: Record<string, unknown> = {}) =>
  buildState({
    subject: initEvent.subject,
    parentExecutionId: initEvent.executionid,
    depth: initEvent.depth,
    executionId: await deriveArvoExecutionId(initEvent),
    source: orderVersion.type,
    version: '1.0.0',
    eventIds: [
      { id: initEvent.id, direction: 'received' },
      { id: 'charge-request', direction: 'emitted' },
    ],
    inFlightEventMap: new Map([['charge-request', chargedEvent]]),
    ...overrides,
  });

const broken = async (overrides: Record<string, unknown>) =>
  disagreementsWithInitEvent(await agreeing(overrides));

describe('a record read against its own init event', () => {
  it('agrees where every copy still matches its source', async () => {
    expect(await disagreementsWithInitEvent(await agreeing())).toEqual([]);
  });

  it('disagrees on a workflow that is not the one it was opened in', async () => {
    const found = await broken({ subject: 'another-workflow' });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('subject');
  });

  it('disagrees on a caller the init event does not name', async () => {
    expect(
      (await broken({ parentExecutionId: 'somewhere-else' }))[0],
    ).toContain('parentExecutionId');
  });

  it('disagrees on a depth the init event does not carry', async () => {
    expect((await broken({ depth: 7 }))[0]).toContain('depth');
  });

  it('disagrees on an execution the init event does not derive to', async () => {
    expect((await broken({ executionId: 'a'.repeat(64) }))[0]).toContain(
      'executionId',
    );
  });

  it('disagrees on a contract the init event was not addressed to', async () => {
    expect((await broken({ source: 'com_something_else' }))[0]).toContain(
      'source',
    );
  });

  it('disagrees on a version the init event does not name', async () => {
    expect((await broken({ version: '2.0.0' }))[0]).toContain('version');
  });

  it('disagrees where it does not hold the event that opened it', async () => {
    const found = await broken({
      eventIds: [{ id: 'charge-request', direction: 'emitted' }],
    });
    expect(found[0]).toContain('eventIds');
  });

  it('disagrees where it holds that event as something it sent', async () => {
    const found = await broken({
      eventIds: [
        { id: initEvent.id, direction: 'emitted' },
        { id: 'charge-request', direction: 'emitted' },
      ],
    });
    expect(found[0]).toContain('eventIds');
  });

  it('disagrees where it awaits a request it never sent', async () => {
    const found = await broken({
      inFlightEventMap: new Map([['never-sent', null]]),
    });
    expect(found.some((issue) => issue.includes('never-sent'))).toBe(true);
  });

  it('says both what is stored and what the opening event says', async () => {
    const found = await broken({ depth: 7 });
    expect(found[0]).toContain('stored state says 7');
    expect(found[0]).toContain('the event that opened it says 0');
  });

  it('reports every disagreement together, not merely the first', async () => {
    const found = await broken({ subject: 'another-workflow', depth: 7 });
    expect(found).toHaveLength(2);
  });

  it('reads the init event it holds, not the event that caused this execution', async () => {
    const opened = cloneArvoEvent(initEvent, {
      subject: 'the-real-workflow',
      executionid: 'the-real-workflow',
    });
    const record = await agreeing({
      initEvent: opened,
      subject: opened.subject,
      parentExecutionId: opened.executionid,
      executionId: await deriveArvoExecutionId(opened),
      triggeringEvent: chargedEvent,
    });
    expect(await disagreementsWithInitEvent(record)).toEqual([]);
  });
});
