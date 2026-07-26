import { describe, expect, it } from 'vitest';
import { ArvoEvent } from '../../src/ArvoEvent/index.js';
import type { ArvoEventParam } from '../../src/ArvoEvent/types.js';
import { createArvoEvent } from '../../src/factory/index.js';

const baseEventParam = (
  overrides: Partial<ArvoEventParam<'test.event', { hello: string }>> = {},
): ArvoEventParam<'test.event', { hello: string }> => ({
  source: 'test/source',
  subject: 'test-subject',
  type: 'test.event',
  data: { hello: 'world' },
  ...overrides,
});

describe('createArvoEvent', () => {
  describe('base call (no parent)', () => {
    it('returns an ArvoEvent instance', () => {
      const event = createArvoEvent({ param: baseEventParam() });
      expect(event).toBeInstanceOf(ArvoEvent);
    });

    it('defaults to a root event: depth 0, rootsubject === subject', () => {
      const event = createArvoEvent({ param: baseEventParam() });
      expect(event.depth).toBe(0);
      expect(event.rootsubject).toBe(event.subject);
    });

    it('defaults parentid to null', () => {
      const event = createArvoEvent({ param: baseEventParam() });
      expect(event.parentid).toBeNull();
    });

    it('passes through baggage as-is when there is no parent', () => {
      const baggage = { tenant: 'acme' };
      const event = createArvoEvent({ param: baseEventParam({ baggage }) });
      expect(event.baggage).toEqual(baggage);
    });

    it('passes through source, subject, type, and data unchanged', () => {
      const param = baseEventParam();
      const event = createArvoEvent({ param });
      expect(event.source).toBe(param.source);
      expect(event.subject).toBe(param.subject);
      expect(event.type).toBe(param.type);
      expect(event.data).toEqual(param.data);
    });

    it('respects explicitly provided extensions', () => {
      const extensions = { customKey: 'customValue' };
      const event = createArvoEvent({ param: baseEventParam(), extensions });
      expect(event.extensions).toEqual(extensions);
    });
  });

  describe('with a parent event', () => {
    it('sets depth to parent.depth + 1', () => {
      const parent = createArvoEvent({ param: baseEventParam() });
      const child = createArvoEvent({
        parent,
        param: baseEventParam({ subject: 'child-subject' }),
      });
      expect(child.depth).toBe(parent.depth + 1);
    });

    it('propagates rootsubject from the parent, not the child subject', () => {
      const parent = createArvoEvent({ param: baseEventParam() });
      const child = createArvoEvent({
        parent,
        param: baseEventParam({ subject: 'child-subject' }),
      });
      expect(child.rootsubject).toBe(parent.rootsubject);
      expect(child.rootsubject).not.toBe(child.subject);
    });

    it('sets parentid to the parent event id', () => {
      const parent = createArvoEvent({ param: baseEventParam() });
      const child = createArvoEvent({
        parent,
        param: baseEventParam({ subject: 'child-subject' }),
      });
      expect(child.parentid).toBe(parent.id);
    });

    it('keeps rootsubject and depth consistent across three generations', () => {
      const grandparent = createArvoEvent({ param: baseEventParam() });
      const parent = createArvoEvent({
        parent: grandparent,
        param: baseEventParam({ subject: 'parent-subject' }),
      });
      const child = createArvoEvent({
        parent,
        param: baseEventParam({ subject: 'child-subject' }),
      });

      expect(grandparent.depth).toBe(0);
      expect(parent.depth).toBe(1);
      expect(child.depth).toBe(2);

      expect(parent.rootsubject).toBe(grandparent.rootsubject);
      expect(child.rootsubject).toBe(grandparent.rootsubject);
    });

    it('merges baggage, keeping the child value when there is no conflict', () => {
      const parent = createArvoEvent({
        param: baseEventParam({ baggage: { fromParent: 'p' } }),
      });
      const child = createArvoEvent({
        parent,
        param: baseEventParam({
          subject: 'child-subject',
          baggage: { fromChild: 'c' },
        }),
      });
      expect(child.baggage).toEqual({ fromParent: 'p', fromChild: 'c' });
    });

    it('keeps the parent value when the child attempts to override an existing baggage key', () => {
      const parent = createArvoEvent({
        param: baseEventParam({ baggage: { shared: 'parent-value' } }),
      });
      const child = createArvoEvent({
        parent,
        param: baseEventParam({
          subject: 'child-subject',
          baggage: { shared: 'child-attempted-override' },
        }),
      });
      expect(child.baggage.shared).toBe('parent-value');
    });
  });

  describe('.for(contract, input)', () => {
    it('returns an ArvoEvent instance', () => {
      const event = createArvoEvent.for('my.contract', {
        param: baseEventParam(),
      });
      expect(event).toBeInstanceOf(ArvoEvent);
    });

    it('behaves identically to the base call for a root event', () => {
      const event = createArvoEvent.for('my.contract', {
        param: baseEventParam(),
      });
      expect(event.depth).toBe(0);
      expect(event.rootsubject).toBe(event.subject);
      expect(event.parentid).toBeNull();
    });

    it('still applies parent-derived lineage when a parent is passed', () => {
      const parent = createArvoEvent({ param: baseEventParam() });
      const child = createArvoEvent.for('my.contract', {
        parent,
        param: baseEventParam({ subject: 'child-subject' }),
      });
      expect(child.depth).toBe(parent.depth + 1);
      expect(child.rootsubject).toBe(parent.rootsubject);
      expect(child.parentid).toBe(parent.id);
    });
  });

  describe('.by(contract, input)', () => {
    it('returns an ArvoEvent instance', () => {
      const event = createArvoEvent.by('my.contract', {
        param: baseEventParam(),
      });
      expect(event).toBeInstanceOf(ArvoEvent);
    });

    it('behaves identically to the base call for a root event', () => {
      const event = createArvoEvent.by('my.contract', {
        param: baseEventParam(),
      });
      expect(event.depth).toBe(0);
      expect(event.rootsubject).toBe(event.subject);
      expect(event.parentid).toBeNull();
    });

    it('still applies parent-derived lineage when a parent is passed', () => {
      const parent = createArvoEvent({ param: baseEventParam() });
      const child = createArvoEvent.by('my.contract', {
        parent,
        param: baseEventParam({ subject: 'child-subject' }),
      });
      expect(child.depth).toBe(parent.depth + 1);
      expect(child.rootsubject).toBe(parent.rootsubject);
      expect(child.parentid).toBe(parent.id);
    });
  });
});
