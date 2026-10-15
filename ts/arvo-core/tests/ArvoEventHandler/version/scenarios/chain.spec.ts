import { describe, expect, it } from 'vitest';
import { createArvoEventFactory } from '../../../../src/factories/ArvoEventFactory/index.js';
import { declareVersions, type WalkContext, walkV1 } from './fixture.js';
import { checkInvariants } from './invariants.js';
import { createArvoLattice } from './lattice.js';

/**
 * A workflow fifty executions deep, each delegating one level further
 * before answering back up.
 *
 * Depth is the only signal a lattice has that recursion is running away,
 * and it is carried by the events rather than held anywhere central. A
 * chain is where that goes wrong: one hop that fails to count, or one
 * completion addressed to the wrong level, and a workflow either looks
 * flat forever or loses a branch silently.
 */

const DEEP = 50;

/** The event that starts a walk of a given depth. */
const aWalk = (remaining: number, subject = 'walk-1') =>
  createArvoEventFactory(walkV1).createInput({
    source: 'com.web.start',
    subject,
    to: walkV1.type,
    data: { node: 'root', remaining },
  });

const walked = async (remaining = DEEP, chaos = {}) => {
  const lattice = createArvoLattice({
    versions: declareVersions({ [walkV1.type]: { maxDepth: 10_000 } }),
    chaos,
    seed: 11,
  });
  await lattice.publish(aWalk(remaining)).settle();
  return lattice;
};

describe('a workflow fifty executions deep', () => {
  it('opens one execution per level, and no more', async () => {
    const lattice = await walked();
    expect(lattice.store.size).toBe(DEEP + 1);
  });

  it('counts one level per hop on the way down', async () => {
    const lattice = await walked();
    const asked = lattice.transcript.published
      .filter((event) => event.type === walkV1.type)
      .map((event) => event.depth)
      .sort((first, second) => first - second);

    expect(asked).toEqual([...Array(DEEP + 1).keys()]);
  });

  it('answers back up, each completion at the level it belongs to', async () => {
    const lattice = await walked();
    const answered = lattice.transcript.published
      .filter((event) => event.type === 'evt_walk_done')
      .map((event) => event.depth)
      .sort((first, second) => first - second);

    expect(answered).toEqual([...Array(DEEP + 1).keys()]);
  });

  it('ends with the first caller answered, from the top of the chain', async () => {
    const lattice = await walked();
    const home = lattice.transcript.published.filter(
      (event) => event.to === 'com.web.start',
    );
    expect(home).toHaveLength(1);
    expect(home[0]?.type).toBe('evt_walk_done');
    expect(home[0]?.depth).toBe(0);
  });

  it('leaves every execution of the chain finished', async () => {
    const lattice = await walked();
    const resting = [...lattice.store.values()].map((row) => row.lifecycle);
    expect(new Set(resting)).toEqual(new Set(['success']));
  });

  it('keeps every execution in the one workflow it belongs to', async () => {
    const lattice = await walked();
    const workflows = new Set(
      lattice.transcript.published.map((event) => event.subject),
    );
    expect(workflows).toEqual(new Set(['walk-1']));
  });

  it('stamps each execution identity downward and its caller upward', async () => {
    const lattice = await walked(3);
    for (const [executionId, row] of lattice.store) {
      const sent = lattice.transcript.published.filter(
        (event) => event.parentid !== null && event.source === walkV1.type,
      );
      const asking = sent.filter(
        (event) => event.executionid === executionId && event.initid === null,
      );
      const answering = sent.filter(
        (event) =>
          event.initid !== null &&
          event.executionid === String(row.parentExecutionId),
      );
      expect(
        asking.length + answering.length,
        `${executionId} sent something addressed to neither`,
      ).toBeGreaterThan(0);
    }
  });

  it('holds everything that must hold, however deep it went', async () => {
    await checkInvariants(await walked());
  });
});

describe('a chain under a transport that repeats itself', () => {
  it('still ends once, with every level run once', async () => {
    const lattice = await walked(DEEP, { duplicate: 2, shuffle: true });

    expect(
      lattice.transcript.published.filter(
        (event) => event.to === 'com.web.start',
      ),
    ).toHaveLength(1);
    expect(lattice.store.size).toBe(DEEP + 1);
    expect(lattice.transcript.discarded.length).toBeGreaterThan(0);
    expect(lattice.transcript.faults).toEqual([]);
  });

  it('holds everything that must hold', async () => {
    await checkInvariants(await walked(DEEP, { duplicate: 2, shuffle: true }));
  });
});

describe('a chain that reaches as deep as it is allowed', () => {
  it('stops where the bound is, and answers from there', async () => {
    const lattice = createArvoLattice({
      versions: declareVersions({ [walkV1.type]: { maxDepth: 5 } }),
      seed: 3,
    });
    await lattice.publish(aWalk(DEEP)).settle();

    const deepest = Math.max(
      ...lattice.transcript.published.map((event) => event.depth),
    );
    expect(deepest).toBeLessThan(5);
    expect(
      lattice.transcript.published.filter(
        (event) => event.to === 'com.web.start',
      ),
    ).toHaveLength(1);
  });

  it('refuses the hop that would cross it, and commits nothing for it', async () => {
    const lattice = createArvoLattice({
      versions: declareVersions({ [walkV1.type]: { maxDepth: 3 } }),
      seed: 3,
    });
    lattice.behave(walkV1.type, async (ctx: WalkContext) => {
      await ctx.setState({ data: { stage: 'walking', answers: 0 } });
      if (ctx.entry === 'followup') {
        return ctx.build({ type: 'evt_walk_done', data: { visited: 1 } });
      }
      // Asking without ever checking how deep it already is, which is the
      // mistake the bound exists to stop.
      return ctx.build({
        type: 'com_tree_walk',
        data: { node: 'deeper', remaining: 1 },
      });
    });
    await lattice.publish(aWalk(DEEP)).settle();

    const refused = lattice.transcript.faults.map(
      ({ fault }) => fault.faultKind,
    );
    expect(refused).toContain('max_depth_event_requested');
    expect(lattice.store.size).toBe(3);
  });
});
