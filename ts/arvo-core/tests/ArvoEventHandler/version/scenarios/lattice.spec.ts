import { describe, expect, it } from 'vitest';
import { createArvoEventFactory } from '../../../../src/factories/ArvoEventFactory/index.js';
import {
  declareVersions,
  type OrderContext,
  orderV1,
  reviewV1,
} from './fixture.js';
import { createArvoLattice } from './lattice.js';

/** What opens an order, as whatever mints a root event would. */
const anOrder = (subject = 'order-1') =>
  createArvoEventFactory(orderV1).createInput({
    source: 'com.web.checkout',
    subject,
    to: orderV1.type,
    data: { items: ['book'] },
  });

const latticeWith = (chaos = {}) =>
  createArvoLattice({ versions: declareVersions(), chaos, seed: 7 });

describe('a lattice running one workflow through', () => {
  it('carries an order from its first event to its last', async () => {
    const lattice = latticeWith();
    await lattice.publish(anOrder()).settle();

    const answered = lattice.transcript.published.filter(
      (event) => event.type === 'evt_order_fulfilled',
    );
    expect(answered).toHaveLength(1);
    expect(answered[0]?.to).toBe('com.web.checkout');
  });

  it('runs every execution the workflow opened', async () => {
    const lattice = latticeWith();
    await lattice.publish(anOrder()).settle();

    // the order, the two services it asked, and nothing else
    expect(lattice.store.size).toBe(3);
  });

  it('raises nothing where nothing was made to go wrong', async () => {
    const lattice = latticeWith();
    await lattice.publish(anOrder()).settle();
    expect(lattice.transcript.faults).toEqual([]);
    expect(lattice.transcript.conflicts).toEqual([]);
  });

  it('keeps two workflows apart', async () => {
    const lattice = latticeWith();
    lattice.publish(anOrder('order-1')).publish(anOrder('order-2'));
    await lattice.settle();

    const answered = lattice.transcript.published.filter(
      (event) => event.type === 'evt_order_fulfilled',
    );
    expect(answered.map((event) => event.subject).sort()).toEqual([
      'order-1',
      'order-2',
    ]);
  });
});

describe('what a lattice does with work it cannot do itself', () => {
  it('parks an event that names a path, rather than delivering it', async () => {
    const lattice = latticeWith();
    lattice.behave(orderV1.type, async (ctx: OrderContext) => {
      await ctx.setState({ data: { stage: 'asking', answers: 0 } });
      return ctx.build({
        type: 'com_manual_review',
        data: { order_id: 'o-1' },
        domain: 'human_review',
      });
    });
    await lattice.publish(anOrder()).settle();

    expect(lattice.parked.get('human_review')).toHaveLength(1);
    expect(
      lattice.transcript.delivered.some(
        (given) => given.event.type === 'com_manual_review',
      ),
    ).toBe(false);
  });

  it('resumes the execution waiting on it once something answers', async () => {
    const lattice = latticeWith();
    lattice.behave(orderV1.type, async (ctx: OrderContext) => {
      if (ctx.entry === 'followup') {
        await ctx.setState({ data: { stage: 'answering', answers: 1 } });
        return ctx.build({
          type: 'evt_order_fulfilled',
          data: { order_id: 'o-1' },
        });
      }
      await ctx.setState({ data: { stage: 'asking', answers: 0 } });
      return ctx.build({
        type: 'com_manual_review',
        data: { order_id: 'o-1' },
        domain: 'human_review',
      });
    });
    await lattice.publish(anOrder()).settle();

    lattice.fulfil('human_review', (asked) =>
      createArvoEventFactory(reviewV1).createOutput({
        type: 'evt_review_decided',
        source: reviewV1.type,
        subject: asked.subject,
        to: asked.source,
        executionid: asked.executionid,
        parentid: asked.id,
        initid: asked.id,
        depth: asked.depth,
        data: { approved: true },
      }),
    );
    await lattice.settle();

    expect(
      lattice.transcript.published.filter(
        (event) => event.type === 'evt_order_fulfilled',
      ),
    ).toHaveLength(1);
  });
});

describe('a lattice told to misbehave', () => {
  it('delivers everything twice, and the workflow still ends once', async () => {
    const lattice = latticeWith({ duplicate: 1 });
    await lattice.publish(anOrder()).settle();

    expect(
      lattice.transcript.published.filter(
        (event) => event.type === 'evt_order_fulfilled',
      ),
    ).toHaveLength(1);
    expect(lattice.transcript.discarded.length).toBeGreaterThan(0);
  });

  it('delivers in no particular order, and the workflow still ends once', async () => {
    const lattice = latticeWith({ shuffle: true, duplicate: 2 });
    await lattice.publish(anOrder()).settle();

    expect(
      lattice.transcript.published.filter(
        (event) => event.type === 'evt_order_fulfilled',
      ),
    ).toHaveLength(1);
  });

  it('holds what it committed but never published, until recovery', async () => {
    const lattice = latticeWith({ crashBeforePublish: 1 });
    await lattice.publish(anOrder()).settle();
    expect(lattice.store.size).toBe(1);

    await lattice.recover().settle();
    expect(lattice.store.size).toBeGreaterThan(1);
  });
});
