import { describe, expect, it } from 'vitest';
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
      droppedConstraint('versions["1.0.0"].accepts.createdAt', 'a Date'),
    ]);
    expect(message).toContain('One constraint did not survive');
    expect(message).toContain('versions["1.0.0"].accepts.createdAt');
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
  const dropped = droppedConstraint('accepts.a', 'a BigInt');
  const demoted = demotedCheck('accepts.email', 'format: email');

  it('a drop says the constraint is gone', () => {
    expect(dropped.toString()).toContain('dropped');
  });

  it('a demotion says it survives but enforces nothing', () => {
    expect(demoted.toString()).toContain('documentation only');
    expect(demoted.toString()).toContain('nothing enforces it');
  });

  it('neither is mistakable for the other', () => {
    expect(demoted.toString()).not.toContain('dropped');
    expect(dropped.toString()).not.toContain('documentation only');
  });

  it('both carry the position they came from', () => {
    expect(dropped.path).toBe('accepts.a');
    expect(demoted.path).toBe('accepts.email');
  });

  it('neither is blocking — a loss does not stop the crossing', () => {
    expect(dropped.isBlocking).toBe(false);
    expect(demoted.isBlocking).toBe(false);
  });
});
