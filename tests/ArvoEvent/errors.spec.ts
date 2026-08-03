import { describe, expect, it } from 'vitest';
import {
  type ArvoEventValidationIssue,
  ArvoEventValidationError,
} from '../../src/ArvoEvent/errors.js';

/**
 * `describeValue` is not exported — it is reached through the rendered
 * message, which is the only place its output is ever seen.
 */
const messageFor = (received: unknown): string =>
  new ArvoEventValidationError([
    { path: 'field', message: 'is wrong', received },
  ]).message;

describe('ArvoEventValidationError', () => {
  describe('issue rendering', () => {
    it('names the path, the rule, and the received value', () => {
      const error = new ArvoEventValidationError([
        { path: 'dataschema', message: 'is required' },
      ]);
      expect(error.message).toContain('dataschema');
      expect(error.message).toContain('is required');
    });

    it('omits the received clause when an issue carries no received value', () => {
      const error = new ArvoEventValidationError([
        { path: 'data.fn', message: 'is a function' },
      ]);
      expect(error.message).not.toContain('received');
    });

    it('includes the received clause when received is present but undefined', () => {
      const error = new ArvoEventValidationError([
        { path: 'depth', message: 'must be a number', received: undefined },
      ]);
      expect(error.message).toContain('received undefined');
    });

    it('renders a dotted payload path unchanged', () => {
      const error = new ArvoEventValidationError([
        { path: 'data.items[2].price', message: 'must be finite' },
      ]);
      expect(error.message).toContain('data.items[2].price');
    });

    it('renders a combined cross-field path unchanged', () => {
      const error = new ArvoEventValidationError([
        { path: 'parentid + depth', message: 'must be 0' },
      ]);
      expect(error.message).toContain('parentid + depth');
    });
  });

  describe('received value rendering, one case per type', () => {
    it('quotes a string so it cannot be mistaken for a number', () => {
      expect(messageFor('3')).toContain('"3"');
    });

    it('renders a number bare, distinguishing it from the same digits as a string', () => {
      const asNumber = messageFor(3);
      expect(asNumber).toContain('received 3');
      expect(asNumber).not.toContain('"3"');
    });

    it('renders a boolean', () => {
      expect(messageFor(true)).toContain('received true');
      expect(messageFor(false)).toContain('received false');
    });

    it('renders null', () => {
      expect(messageFor(null)).toContain('received null');
    });

    it('renders undefined', () => {
      expect(messageFor(undefined)).toContain('received undefined');
    });

    it('marks a bigint as one, since its digits alone would read as a number', () => {
      expect(messageFor(10n)).toContain('10n (bigint)');
    });

    it('describes a function rather than printing its source', () => {
      expect(messageFor(() => 'x')).toContain('a function');
    });

    it('renders a symbol via its description', () => {
      expect(messageFor(Symbol('marker'))).toContain('Symbol(marker)');
    });

    it('summarises an array by length rather than printing it', () => {
      expect(messageFor([1, 2, 3])).toContain('an array of 3');
    });

    it('summarises an empty array as length zero', () => {
      expect(messageFor([])).toContain('an array of 0');
    });

    it('serializes a plain object', () => {
      expect(messageFor({ a: 1 })).toContain('{"a":1}');
    });

    it('falls back to a shape description for a cyclic object', () => {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      expect(messageFor(cyclic)).toContain('an object');
    });

    it('falls back to a shape description when serializing yields undefined', () => {
      // A lone symbol-valued object serializes to undefined rather than throwing.
      expect(messageFor(Symbol.iterator)).toContain('Symbol(Symbol.iterator)');
      expect(messageFor({ toJSON: () => undefined })).toContain('an object');
    });

    it('falls back to a shape description when toJSON throws', () => {
      const hostile = {
        toJSON() {
          throw new Error('nope');
        },
      };
      expect(messageFor(hostile)).toContain('an object');
    });
  });

  describe('truncation', () => {
    it('truncates a long string and marks it with an ellipsis', () => {
      const message = messageFor('x'.repeat(500));
      expect(message).toContain('…');
      expect(message.length).toBeLessThan(300);
    });

    it('truncates a long serialized object', () => {
      const wide = Object.fromEntries(
        Array.from({ length: 100 }, (_, i) => [`key${i}`, i]),
      );
      const message = messageFor(wide);
      expect(message).toContain('…');
      expect(message.length).toBeLessThan(300);
    });

    it('leaves a short string intact', () => {
      const message = messageFor('short');
      expect(message).toContain('"short"');
      expect(message).not.toContain('…');
    });
  });

  describe('message shape', () => {
    it('reads as one sentence for a single issue', () => {
      const error = new ArvoEventValidationError([
        { path: 'subject', message: 'is required' },
      ]);
      expect(error.message).toBe(
        'ArvoEvent is not structurally valid. subject: is required',
      );
      expect(error.message).not.toContain('\n');
    });

    it('reads as a counted list for several issues', () => {
      const error = new ArvoEventValidationError([
        { path: 'subject', message: 'is required' },
        { path: 'source', message: 'is required' },
        { path: 'type', message: 'is required' },
      ]);
      expect(error.message).toContain('(3 problems)');
      expect(error.message.split('\n')).toHaveLength(4);
      expect(error.message).toContain('  - subject: is required');
      expect(error.message).toContain('  - source: is required');
      expect(error.message).toContain('  - type: is required');
    });

    it('degrades to a bare statement when constructed with no issues', () => {
      const error = new ArvoEventValidationError([]);
      expect(error.message).toBe('ArvoEvent is not structurally valid.');
    });
  });

  describe('the error object itself', () => {
    it('is an Error', () => {
      expect(new ArvoEventValidationError([])).toBeInstanceOf(Error);
    });

    it('carries a discriminant that avoids an instanceof check', () => {
      expect(new ArvoEventValidationError([])._tag).toBe(
        'ArvoEventValidationError',
      );
    });

    it('names itself', () => {
      expect(new ArvoEventValidationError([]).name).toBe(
        'ArvoEventValidationError',
      );
    });

    it('preserves an underlying cause when given one', () => {
      const cause = new Error('underlying');
      const error = new ArvoEventValidationError([], { cause });
      expect(error.cause).toBe(cause);
    });

    it('exposes every issue individually, not only in the message', () => {
      const issues: ArvoEventValidationIssue[] = [
        { path: 'subject', message: 'is required' },
        { path: 'depth', message: 'must be a non-negative integer', received: -1 },
      ];
      const error = new ArvoEventValidationError(issues);
      expect(error.issues).toHaveLength(2);
      expect(error.issues[0]).toEqual({
        path: 'subject',
        message: 'is required',
      });
      expect(error.issues[1]?.received).toBe(-1);
    });

    it('freezes issues so a caller cannot mutate the record of what failed', () => {
      const error = new ArvoEventValidationError([
        { path: 'subject', message: 'is required' },
      ]);
      expect(Object.isFrozen(error.issues)).toBe(true);
      expect(() => {
        (error.issues as ArvoEventValidationIssue[]).push({
          path: 'x',
          message: 'y',
        });
      }).toThrow();
    });

    it('copies the issues it was given, so mutating the input afterwards does not change it', () => {
      const issues: ArvoEventValidationIssue[] = [
        { path: 'subject', message: 'is required' },
      ];
      const error = new ArvoEventValidationError(issues);
      issues.push({ path: 'source', message: 'is required' });
      expect(error.issues).toHaveLength(1);
    });
  });
});
