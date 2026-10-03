import { trace } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { ArvoDomain } from '../../../../src/ArvoDomain/index.js';
import type { ArvoEvent } from '../../../../src/ArvoEvent/index.js';
import { ArvoExecutionContextTelemetry } from '../../../../src/ArvoEventHandler/context/telemetry/index.js';
import type { ArvoHandlerFault } from '../../../../src/ArvoEventHandler/fault/index.js';
import { createArvoEventFactory } from '../../../../src/factories/ArvoEventFactory/index.js';
import type { JSONObject } from '../../../../src/types.js';
import {
  declareVersions,
  type OrderContext,
  orderV1,
  reviewV1,
} from './fixture.js';
import { checkInvariants } from './invariants.js';
import { createArvoLattice } from './lattice.js';

/**
 * Rows that are not what they claim, and a crash between committing and
 * publishing.
 *
 * A stored record outlives the process that wrote it. It is read back by
 * another one, possibly a newer deployment, possibly after something
 * edited it by hand. What must hold is that nothing is read off a
 * structure before it is established to be a record, that a record which
 * contradicts itself is refused as corrupt rather than run, and that a
 * record carrying something this deployment does not know is accepted
 * rather than refused.
 */

const telemetryFor = () =>
  new ArvoExecutionContextTelemetry({
    span: trace.getTracer('corruption').startSpan('execution'),
    meter: null,
    logger: null,
  });

const anOrder = (subject = 'order-1') =>
  createArvoEventFactory(orderV1).createInput({
    source: 'com.web.checkout',
    subject,
    to: orderV1.type,
    data: { items: ['book'] },
  });

/**
 * An order genuinely waiting, with the row as the store holds it.
 *
 * It asks a person rather than a service, because a service answers at
 * once and a row from a finished execution is not the row this file is
 * about.
 */
const waiting = async () => {
  const lattice = createArvoLattice({ versions: declareVersions(), seed: 29 });
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
      domain: ArvoDomain.FROM_EVENT_CONTRACT,
    });
  });
  await lattice.publish(anOrder()).settle();

  const [executionId, row] = [...lattice.store.entries()].find(
    ([, held]) => held.source === orderV1.type,
  ) as [string, JSONObject];
  const asked = lattice.parked.get('human_review')?.[0] as ArvoEvent;

  return { lattice, executionId, row, asked };
};

/** What a person decides, as an answer to what that order asked for. */
const answerTo = (asked: ArvoEvent, executionId: string) =>
  createArvoEventFactory(reviewV1).createOutput({
    type: 'evt_review_decided',
    source: reviewV1.type,
    subject: asked.subject,
    to: orderV1.type,
    executionid: executionId,
    parentid: asked.id,
    initid: asked.id,
    depth: asked.depth,
    data: { approved: true },
  });

/**
 * That same order resumed against its own row, made into whatever the
 * test needs — the row and the execution it belongs to coming from one
 * run, since a row from another would be refused for that first.
 */
const resumedWith = async (
  becomes: (row: JSONObject) => unknown,
): Promise<ArvoHandlerFault> => {
  const { executionId, row, asked } = await waiting();
  const versions = declareVersions();
  try {
    await versions[orderV1.type]?.['1.0.0']?.execute({
      entry: 'followup',
      event: answerTo(asked, executionId),
      state: becomes(row),
      executionId,
      attempt: 0,
      dependencies: {},
      hooks: {},
      telemetry: telemetryFor(),
    } as never);
  } catch (raised) {
    return raised as ArvoHandlerFault;
  }
  throw new Error('expected this row to be refused');
};

describe('a row that is not a record', () => {
  it('is refused where it does not read at all', async () => {
    const refused = await resumedWith(() => 'not a row');
    expect(refused.faultKind).toBe('record_invalid');
    expect(refused.abandonmentEvent).toBeNull();
    expect(refused.abandonmentState).toBeNull();
  });

  it('is refused where it holds nothing a record holds', async () => {
    const refused = await resumedWith(() => ({ nothing: 'much' }));
    expect(refused.faultKind).toBe('record_event_unrestorable');
  });

  it('is refused where an event it holds will not restore', async () => {
    const refused = await resumedWith((row) => ({
      ...row,
      initEvent: { not: 'one' },
    }));
    expect(refused.faultKind).toBe('record_event_unrestorable');
    expect(refused.abandonmentEvent).toBeNull();
  });

  it('says nothing about an execution it could not read', async () => {
    const refused = await resumedWith(() => 'not a row');
    expect(refused.executionId).not.toBeNull();
    expect(refused.abandonmentState).toBeNull();
  });
});

describe('a row that reads, and contradicts itself', () => {
  const drifted = (overrides: JSONObject) =>
    resumedWith((row) => ({ ...row, ...overrides }));

  it('is refused where it sits at a level its opening event does not', async () => {
    const refused = await drifted({ depth: 4 });
    expect(refused.faultKind).toBe('record_invalid');
    expect(refused.violations.some((broken) => broken.includes('depth'))).toBe(
      true,
    );
  });

  it('is refused where it names a workflow its opening event does not', async () => {
    const refused = await drifted({ subject: 'another-workflow' });
    expect(
      refused.violations.some((broken) => broken.includes('subject')),
    ).toBe(true);
  });

  it('is refused where it names a caller its opening event does not', async () => {
    const refused = await drifted({ parentExecutionId: 'somebody-else' });
    expect(
      refused.violations.some((broken) => broken.includes('parentExecutionId')),
    ).toBe(true);
  });

  it('is refused where it awaits something it never sent', async () => {
    const refused = await drifted({
      inFlightEventMap: [['never-sent', null]],
    });
    expect(
      refused.violations.some((broken) => broken.includes('never-sent')),
    ).toBe(true);
  });

  it('is refused where it does not hold the event that opened it', async () => {
    const refused = await resumedWith((row) => ({
      ...row,
      eventIds: (row.eventIds as { id: string; direction: string }[]).filter(
        (logged) => logged.direction === 'emitted',
      ),
    }));
    expect(
      refused.violations.some((broken) => broken.includes('eventIds')),
    ).toBe(true);
  });

  it('reports every field that drifted, not the first', async () => {
    const refused = await drifted({ depth: 4, subject: 'another-workflow' });
    expect(refused.violations.length).toBeGreaterThanOrEqual(2);
  });

  it('still answers the caller, the record having read back', async () => {
    const refused = await drifted({ depth: 4 });
    expect(typeof refused.abandonmentEvent).toBe('string');
    expect(typeof refused.abandonmentState).toBe('string');
  });
});

describe('a row from a deployment that knows more than this one', () => {
  it('is accepted, a reader refusing what it does not know being worse', async () => {
    const { lattice, executionId, row, asked } = await waiting();
    const versions = declareVersions();

    const written = await versions[orderV1.type]?.['1.0.0']?.execute({
      entry: 'followup',
      event: answerTo(asked, executionId),
      // a field a later envelope added, which this reader has never seen
      state: { ...row, somethingNewer: { added: 'later' } },
      executionId,
      attempt: 0,
      dependencies: {},
      hooks: {},
      telemetry: telemetryFor(),
    } as never);

    expect(written?.kind).toBe('produced');
    expect(lattice.transcript.faults).toEqual([]);
  });
});

describe('a crash between committing and publishing', () => {
  const crashing = async (rate: number, seed: number) => {
    const lattice = createArvoLattice({
      versions: declareVersions(),
      chaos: { crashBeforePublish: rate },
      seed,
    });
    await lattice.publish(anOrder()).settle();
    return lattice;
  };

  it('holds what was committed, and publishes it on recovery', async () => {
    const lattice = await crashing(1, 2);
    expect(lattice.store.size).toBe(1);
    expect(lattice.holding).toBe(2);

    await lattice.recover().settle();
    expect(lattice.store.size).toBe(3);
  });

  it('sends the very events that were committed, not events built again', async () => {
    const lattice = await crashing(1, 2);
    const held = [...lattice.transcript.fromExecutions];
    await lattice.recover().settle();

    const sent = lattice.transcript.published.map((event) => event.id);
    for (const id of held) expect(sent).toContain(id);
  });

  it('reaches the same end as a run that never crashed', async () => {
    const crashed = await crashing(0.5, 44);
    while (crashed.holding > 0) await crashed.recover().settle();
    const clean = await crashing(0, 44);

    const resting = (lattice: Awaited<ReturnType<typeof crashing>>) =>
      [...lattice.store.values()]
        .map((row) => `${row.source}:${row.lifecycle}:${row.casVersion}`)
        .sort();

    expect(resting(crashed)).toEqual(resting(clean));
  });

  it('discards a committed event republished after it was processed', async () => {
    const lattice = await crashing(0, 6);
    // only what a handler receives can be discarded by one: the order's
    // own answer goes to whoever opened it, which is not a handler here
    const answers = lattice.transcript.published.filter(
      (event) => event.initid !== null && event.to === orderV1.type,
    );

    // recovery publishing again what a receiver already processed
    for (const again of answers) lattice.inject(again);
    await lattice.settle();

    expect(lattice.transcript.discarded.length).toBe(answers.length);
    expect(lattice.transcript.faults).toEqual([]);
  });

  it('holds everything that must hold, through a crash and a recovery', async () => {
    const lattice = await crashing(0.5, 44);
    while (lattice.holding > 0) await lattice.recover().settle();
    await checkInvariants(lattice);
  });
});
