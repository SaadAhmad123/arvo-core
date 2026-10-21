import { describe, expect, it } from 'vitest';
import { asError } from '../../../src/serializers/ArvoContractSerializer/errors.js';
import {
  buildWarningFromErrorIssues,
  demotedCheck,
  droppedConstraint,
} from '../../../src/serializers/ArvoContractSerializer/warnings.js';

describe('buildWarningFromErrorIssues', () => {
  it('renders nothing when nothing was lost', () => {
    expect(buildWarningFromErrorIssues([])).toBeNull();
  });

  it('renders a single loss without pluralising', () => {
    const message = buildWarningFromErrorIssues([
      droppedConstraint('versions["1.0.0"].input.createdAt', 'a Date'),
    ]);
    expect(message).toContain('One constraint did not survive');
    expect(message).toContain('versions["1.0.0"].input.createdAt');
    expect(message).toContain('a Date');
  });

  it('states the count when several were lost', () => {
    const message = buildWarningFromErrorIssues([
      droppedConstraint('a', 'one'),
      droppedConstraint('b', 'two'),
      droppedConstraint('c', 'three'),
    ]);
    expect(message).toContain('3 constraints did not survive');
    expect(message).toContain('- a: ');
    expect(message).toContain('- c: ');
  });

  it('never reads as a list of problems', () => {
    // These are the outcome ADR-005 mandates, not faults. Wording that says
    // otherwise teaches a reader to ignore the report.
    const message = buildWarningFromErrorIssues([
      droppedConstraint('a', 'one'),
    ]);
    expect(message).not.toContain('problem');
  });
});

describe('a drop and a demotion read differently', () => {
  const dropWarning = droppedConstraint('input.a', 'a BigInt');
  const demotionWarning = demotedCheck('input.email', 'format: email');

  it('a drop says the constraint is gone', () => {
    expect(dropWarning.toString()).toContain('dropped');
  });

  it('a demotion says it survives but enforces nothing', () => {
    expect(demotionWarning.toString()).toContain('documentation only');
    expect(demotionWarning.toString()).toContain('nothing enforces it');
  });

  it('neither is mistakable for the other', () => {
    expect(demotionWarning.toString()).not.toContain('dropped');
    expect(dropWarning.toString()).not.toContain('documentation only');
  });

  it('both carry the position they came from', () => {
    expect(dropWarning.path).toBe('input.a');
    expect(demotionWarning.path).toBe('input.email');
  });

  it('neither is blocking — a loss does not stop the crossing', () => {
    expect(dropWarning.isBlocking).toBe(false);
    expect(demotionWarning.isBlocking).toBe(false);
  });
});

describe('asError', () => {
  it('passes an Error through untouched', () => {
    const thrown = new SyntaxError('bad json');
    expect(asError(thrown)).toBe(thrown);
  });

  it('wraps anything else, keeping what it said', () => {
    // A `throw` can carry anything, and `cause` is declared an Error.
    expect(asError('a bare string')).toBeInstanceOf(Error);
    expect(asError('a bare string').message).toBe('a bare string');
    expect(asError(42).message).toBe('42');
  });
});
