import { describe, expect, it } from 'vitest';
import { ArvoEventDepthValidator } from '../../../src/ArvoEventHandler/validators/depth/index.js';
import { cloneArvoEvent } from '../../../src/factories/cloneArvoEvent.js';
import { initEvent } from '../fixtures.js';

/**
 * An event sitting at the depth given. A nested event, since ADR-001 fixes
 * a root event at depth 0 and a depth validator is about nesting.
 */
const atDepth = (depth: number) =>
  cloneArvoEvent(initEvent, { depth, parentid: 'the-event-that-caused-it' });

const bounded = (maxDepth: number) => new ArvoEventDepthValidator({ maxDepth });

describe('an event arriving', () => {
  it('is accepted where it sits below the maximum', () => {
    expect(bounded(10).validateInput(atDepth(3)).ok).toBe(true);
  });

  it('is accepted at one below the maximum', () => {
    expect(bounded(4).validateInput(atDepth(3)).ok).toBe(true);
  });

  it('is refused at the maximum, the bound being exclusive', () => {
    expect(bounded(3).validateInput(atDepth(3)).ok).toBe(false);
  });

  it('is refused beyond it', () => {
    expect(bounded(3).validateInput(atDepth(9)).ok).toBe(false);
  });

  it('is refused by a version allowing nothing', () => {
    expect(bounded(0).validateInput(atDepth(0)).ok).toBe(false);
  });

  it('names it as having arrived from too deep', () => {
    const result = bounded(3).validateInput(atDepth(3));
    expect(!result.ok && result.error.faultKind).toBe(
      'max_depth_event_received',
    );
  });
});

describe('an event about to be emitted', () => {
  it('is accepted where it sits below the maximum', () => {
    expect(bounded(10).validateOutput(atDepth(1)).ok).toBe(true);
  });

  it('is refused at the maximum', () => {
    expect(bounded(1).validateOutput(atDepth(1)).ok).toBe(false);
  });

  it('names it as having been asked for from too deep', () => {
    const result = bounded(1).validateOutput(atDepth(1));
    expect(!result.ok && result.error.faultKind).toBe(
      'max_depth_event_requested',
    );
  });
});

describe('what it says when it refuses', () => {
  const refusal = () => {
    const result = bounded(5).validateOutput(atDepth(7));
    if (result.ok) throw new Error('expected the event to be refused');
    return result.error;
  };

  it('says which event', () => {
    expect(refusal().message).toContain(initEvent.type);
  });

  it('says the limit in force', () => {
    expect(refusal().issues[0]?.message).toContain('5');
  });

  it('says the depth the event carried', () => {
    expect(refusal().issues[0]?.received).toBe(7);
  });

  it('names the field at fault', () => {
    expect(refusal().issues[0]?.path).toBe('depth');
  });
});

describe('what a validator holds', () => {
  it('carries the bound it was built with', () => {
    expect(bounded(42).maxDepth).toBe(42);
  });
});
