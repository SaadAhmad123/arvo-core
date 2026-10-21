import { describe, expect, it } from 'vitest';
import { createArvoEventFactory } from '../../../src/factories/ArvoEventFactory/index.js';
import { cloneArvoEvent } from '../../../src/factories/cloneArvoEvent.js';
import { declareWalker, walkContract, walkV1 } from './fixture.js';
import { ScenarioStore } from './store.js';

/**
 * A handler that calls itself, through its own gate.
 *
 * The one overlap in the protocol: a request to itself and a reply from
 * itself carry the same `dataschema`, so that field alone cannot say
 * which is which. The type breaks the tie, and it can because a
 * contract's input type matches neither its outputs nor its handler
 * error type.
 *
 * Reachable only here. The version was handed the answer.
 */

const walkRequest = (subject: string, remaining: number) =>
  createArvoEventFactory(walkV1).createInput({
    source: 'com.web.walk',
    subject,
    to: walkContract.type,
    data: { node: 'root', remaining },
  });

describe('a request a handler sends to itself', () => {
  it('opens a child execution rather than answering the parent', async () => {
    const store = new ScenarioStore();
    const walker = declareWalker();

    const parent = await walker.execute({
      event: walkRequest('walk-1', 2),
      state: store.resolver,
      attempt: 0,
    });
    expect(parent.kind).toBe('produced');
    expect(parent.kind === 'produced' && parent.events[0]?.type).toBe(
      'com_tree_walk',
    );
    expect(parent.kind === 'produced' && parent.events[0]?.category).toBe(
      'io.arvo.init',
    );
  });

  it('is run as a new execution when it comes back round', async () => {
    const store = new ScenarioStore();
    const walker = declareWalker();

    const parent = await walker.execute({
      event: walkRequest('walk-1', 2),
      state: store.resolver,
      attempt: 0,
    });
    if (parent.kind !== 'produced') throw new Error('nothing was asked');
    store.commit(parent.state);

    const child = await walker.execute({
      event: parent.events[0] as never,
      state: store.resolver,
      attempt: 0,
    });
    if (child.kind !== 'produced') throw new Error('no child opened');

    // its own execution, not the parent's
    expect(child.state.executionId).not.toBe(parent.state.executionId);
    expect(child.state.parentExecutionId).toBe(parent.state.executionId);
    expect(child.state.depth).toBe(Number(parent.state.depth) + 1);
  });
});

describe('a reply a handler sends itself', () => {
  const openParentAndChild = async () => {
    const store = new ScenarioStore();
    const walker = declareWalker();

    const parent = await walker.execute({
      event: walkRequest('walk-1', 2),
      state: store.resolver,
      attempt: 0,
    });
    if (parent.kind !== 'produced') throw new Error('nothing was asked');
    store.commit(parent.state);

    const child = await walker.execute({
      event: parent.events[0] as never,
      state: store.resolver,
      attempt: 0,
    });
    if (child.kind !== 'produced') throw new Error('no child opened');
    store.commit(child.state);

    return { store, walker, parent, child };
  };

  it('resumes the parent rather than opening another child', async () => {
    const { store, walker, parent, child } = await openParentAndChild();

    // the grandchild answers, which completes the child
    const grandchild = await walker.execute({
      event: child.events[0] as never,
      state: store.resolver,
      attempt: 0,
    });
    if (grandchild.kind !== 'produced') throw new Error('no grandchild');
    store.commit(grandchild.state);

    const childCompletion = await walker.execute({
      event: grandchild.events[0] as never,
      state: store.resolver,
      attempt: 0,
    });
    if (childCompletion.kind !== 'produced')
      throw new Error('child not answered');
    store.commit(childCompletion.state);

    const parentCompletion = await walker.execute({
      event: childCompletion.events[0] as never,
      state: store.resolver,
      attempt: 0,
    });
    if (parentCompletion.kind !== 'produced')
      throw new Error('parent not answered');

    // the parent resumed and completed, rather than opening a fourth
    expect(parentCompletion.state.executionId).toBe(parent.state.executionId);
    expect(parentCompletion.state.lifecycle).toBe('success');
    expect(parentCompletion.events[0]?.type).toBe('evt_walk_done');
    expect(parentCompletion.events[0]?.to).toBe('com.web.walk');
  });

  it('is told apart from a request by its type alone', async () => {
    const { store, walker, child } = await openParentAndChild();
    const reply = child.events[0];

    // the two carry the same dataschema; only the type differs
    expect(reply?.dataschema).toBe(walkV1.dataschema);

    const resumedOutcome = await walker.execute({
      event: reply as never,
      state: store.resolver,
      attempt: 0,
    });
    expect(resumedOutcome.kind).toBe('produced');
  });
});

describe('an event that is neither a request nor a reply', () => {
  it('cannot be placed, nothing saying which it is', async () => {
    const store = new ScenarioStore();
    const walker = declareWalker();

    const parent = await walker.execute({
      event: walkRequest('walk-1', 1),
      state: store.resolver,
      attempt: 0,
    });
    if (parent.kind !== 'produced') throw new Error('nothing was asked');
    store.commit(parent.state);

    const unplaceableEvent = cloneArvoEvent(parent.events[0] as never, {
      type: 'evt_nothing_declared',
    });
    const refusal = await walker.tryExecute({
      event: unplaceableEvent,
      state: store.resolver,
      attempt: 0,
    });

    expect(!refusal.ok && refusal.error.faultKind).toBe('event_unclassifiable');
    expect(!refusal.ok && refusal.error.violations.join(' ')).toContain(
      'evt_walk_done',
    );
  });
});
