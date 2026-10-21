import { describe, expect, it } from 'vitest';
import { ArvoEventDepthValidator } from '../../../src/ArvoEventHandler/validators/depth/index.js';
import { cloneArvoEvent } from '../../../src/factories/cloneArvoEvent.js';
import { initEvent } from '../fixtures.js';

/**
 * An event sitting at the depth given. A nested event, since ADR-001 fixes
 * a root event at depth 0 and a depth validator is about nesting.
 */
const eventAtDepth = (depth: number) =>
  cloneArvoEvent(initEvent, { depth, parentid: 'the-event-that-caused-it' });

const depthValidator = (maxDepth: number) =>
  new ArvoEventDepthValidator({
    maxDepth,
    contractAtVersion: 'com_order_create@1.0.0',
  });

describe('an event arriving', () => {
  it('is accepted where it sits below the maximum', () => {
    expect(depthValidator(10).validateInput(eventAtDepth(3)).ok).toBe(true);
  });

  it('is accepted at one below the maximum', () => {
    expect(depthValidator(4).validateInput(eventAtDepth(3)).ok).toBe(true);
  });

  it('is refused at the maximum, the bound being exclusive', () => {
    expect(depthValidator(3).validateInput(eventAtDepth(3)).ok).toBe(false);
  });

  it('is refused beyond it', () => {
    expect(depthValidator(3).validateInput(eventAtDepth(9)).ok).toBe(false);
  });

  it('is refused by a version allowing nothing', () => {
    expect(depthValidator(0).validateInput(eventAtDepth(0)).ok).toBe(false);
  });

  it('names it as having arrived from too deep', () => {
    const validation = depthValidator(3).validateInput(eventAtDepth(3));
    expect(!validation.ok && validation.error.faultKind).toBe(
      'max_depth_event_received',
    );
  });
});

describe('an event about to be emitted', () => {
  it('is accepted where it sits below the maximum', () => {
    expect(depthValidator(10).validateOutput(eventAtDepth(1)).ok).toBe(true);
  });

  it('is refused at the maximum', () => {
    expect(depthValidator(1).validateOutput(eventAtDepth(1)).ok).toBe(false);
  });

  it('names it as having been asked for from too deep', () => {
    const validation = depthValidator(1).validateOutput(eventAtDepth(1));
    expect(!validation.ok && validation.error.faultKind).toBe(
      'max_depth_event_requested',
    );
  });
});

describe('what it says when it refuses', () => {
  const refusalError = () => {
    const validation = depthValidator(5).validateOutput(eventAtDepth(7));
    if (validation.ok) throw new Error('expected the event to be refused');
    return validation.error;
  };

  it('says which event', () => {
    expect(refusalError().message).toContain(initEvent.type);
  });

  it('names the version that refused it, and the option that bounds it', () => {
    const message = refusalError().message;
    expect(message).toContain('com_order_create@1.0.0');
    expect(message).toContain('maxDepth');
  });

  it('says the depth the event carried, so a reader need not look it up', () => {
    expect(refusalError().message).toContain('at depth 7');
  });

  it('says the limit in force', () => {
    expect(refusalError().issues[0]?.message).toContain('5');
  });

  it('says the depth the event carried', () => {
    expect(refusalError().issues[0]?.received).toBe(7);
  });

  it('names the field at fault', () => {
    expect(refusalError().issues[0]?.path).toBe('depth');
  });
});

describe('what a validator holds', () => {
  it('carries the bound it was built with', () => {
    expect(depthValidator(42).maxDepth).toBe(42);
  });
});
