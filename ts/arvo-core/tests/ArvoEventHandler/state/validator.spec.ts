import { describe, expect, it } from 'vitest';
import { checkExecutionState } from '../../../src/ArvoEventHandler/state/validator.js';
import { chargedEvent, initEvent } from '../fixtures.js';

const stateFields = (overrides: Record<string, unknown> = {}) => ({
  data: null,
  subject: initEvent.subject,
  executionId: initEvent.executionid,
  parentExecutionId: initEvent.executionid,
  depth: 0,
  source: 'com_order_create',
  version: '1.0.0',
  lifecycle: 'waiting',
  lifecycleDescription: null,
  initEvent,
  triggeringEvent: chargedEvent,
  eventIds: [],
  inFlightEventMap: new Map(),
  recordFormatVersion: '1.0.0',
  casVersion: 0,
  ...overrides,
});

/** Every path reported for a record built with the given fields replaced. */
const reportedPaths = (overrides: Record<string, unknown>): string[] =>
  checkExecutionState(stateFields(overrides)).map((issue) => issue.path);

describe('checking what an execution remembers', () => {
  it('finds nothing wrong with a whole record', () => {
    expect(checkExecutionState(stateFields())).toEqual([]);
  });

  describe('the record itself', () => {
    it.each([null, 'a string', 42, ['an', 'array']])(
      'refuses %s, which is not a record at all',
      (candidate) => {
        expect(
          checkExecutionState(candidate).map((issue) => issue.path),
        ).toEqual(['(root)']);
      },
    );
  });

  describe('the identifiers', () => {
    it.each(['subject', 'executionId', 'parentExecutionId', 'source'])(
      'refuses an empty %s',
      (field) => {
        expect(reportedPaths({ [field]: '' })).toEqual([field]);
      },
    );

    it.each(['subject', 'executionId', 'parentExecutionId', 'source'])(
      'refuses a %s that is not a string',
      (field) => {
        expect(reportedPaths({ [field]: 42 })).toEqual([field]);
      },
    );
  });

  describe('the counts', () => {
    it.each(['depth', 'casVersion'])('refuses a negative %s', (field) => {
      expect(reportedPaths({ [field]: -1 })).toEqual([field]);
    });

    it.each(['depth', 'casVersion'])('refuses a fractional %s', (field) => {
      expect(reportedPaths({ [field]: 1.5 })).toEqual([field]);
    });

    it.each(['depth', 'casVersion'])('refuses a %s that is absent', (field) => {
      expect(reportedPaths({ [field]: undefined })).toEqual([field]);
    });

    it.each(['depth', 'casVersion'])('accepts a %s of zero', (field) => {
      expect(reportedPaths({ [field]: 0 })).toEqual([]);
    });
  });

  describe('the two events', () => {
    it.each(['initEvent', 'triggeringEvent'])(
      'refuses a %s that is a plain object rather than an event',
      (field) => {
        expect(reportedPaths({ [field]: { id: 'e-1' } })).toEqual([field]);
      },
    );

    it.each(['initEvent', 'triggeringEvent'])(
      'refuses a %s that is absent',
      (field) => {
        expect(reportedPaths({ [field]: null })).toEqual([field]);
      },
    );
  });

  describe('the event log', () => {
    it('refuses a log that is not a list', () => {
      expect(reportedPaths({ eventIds: 'e-1' })).toEqual(['eventIds']);
    });

    it('refuses an entry that is not an object', () => {
      expect(reportedPaths({ eventIds: ['e-1'] })).toEqual(['eventIds[0]']);
    });

    it('refuses an entry with no id', () => {
      expect(reportedPaths({ eventIds: [{ direction: 'received' }] })).toEqual([
        'eventIds[0].id',
      ]);
    });

    it('refuses a direction an event cannot go', () => {
      expect(
        reportedPaths({ eventIds: [{ id: 'e-1', direction: 'sideways' }] }),
      ).toEqual(['eventIds[0].direction']);
    });

    it('names the entry that is wrong, not merely the log', () => {
      expect(
        reportedPaths({
          eventIds: [
            { id: 'e-1', direction: 'received' },
            { id: 'e-2', direction: 'sideways' },
          ],
        }),
      ).toEqual(['eventIds[1].direction']);
    });

    it.each(['received', 'emitted'])(
      'accepts the direction %s',
      (direction) => {
        expect(reportedPaths({ eventIds: [{ id: 'e-1', direction }] })).toEqual(
          [],
        );
      },
    );
  });

  describe('what is awaited', () => {
    it('refuses a collection that is not a map', () => {
      expect(reportedPaths({ inFlightEventMap: {} })).toEqual([
        'inFlightEventMap',
      ]);
    });

    it('refuses an answer that is neither an event nor nothing', () => {
      expect(
        reportedPaths({ inFlightEventMap: new Map([['e-1', 'answered']]) }),
      ).toEqual(['inFlightEventMap[e-1]']);
    });

    it('refuses an empty key, there being no such event to await', () => {
      expect(
        reportedPaths({ inFlightEventMap: new Map([['', null]]) }),
      ).toEqual(['inFlightEventMap[]']);
    });

    it('accepts an unanswered request', () => {
      expect(
        reportedPaths({ inFlightEventMap: new Map([['e-1', null]]) }),
      ).toEqual([]);
    });

    it('accepts an answered one', () => {
      expect(
        reportedPaths({ inFlightEventMap: new Map([['e-1', chargedEvent]]) }),
      ).toEqual([]);
    });
  });

  describe('the remaining fields', () => {
    it('refuses data that is neither an object nor nothing', () => {
      expect(reportedPaths({ data: 'written' })).toEqual(['data']);
    });

    it('refuses a version that is not a semantic version', () => {
      expect(reportedPaths({ version: 'one' })).toEqual(['version']);
    });

    it('refuses a lifecycle outside the six', () => {
      expect(reportedPaths({ lifecycle: 'pondering' })).toEqual(['lifecycle']);
    });

    it('refuses a description that is neither a string nor nothing', () => {
      expect(reportedPaths({ lifecycleDescription: 42 })).toEqual([
        'lifecycleDescription',
      ]);
    });

    it('refuses a format version that is not a semantic version', () => {
      expect(reportedPaths({ recordFormatVersion: 'one' })).toEqual([
        'recordFormatVersion',
      ]);
    });
  });

  it('reports every field that is wrong, not only the first', () => {
    expect(
      reportedPaths({ subject: '', depth: -1, lifecycle: 'pondering' }).sort(),
    ).toEqual(['depth', 'lifecycle', 'subject']);
  });

  it('says what was there instead, so a reader need not go looking', () => {
    expect(checkExecutionState(stateFields({ depth: -1 }))[0]?.received).toBe(
      -1,
    );
  });
});
