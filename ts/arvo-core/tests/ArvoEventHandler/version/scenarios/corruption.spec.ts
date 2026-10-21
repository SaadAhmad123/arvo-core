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

const executionTelemetry = () =>
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
const awaitingReview = async () => {
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
    ([, storedRow]) => storedRow.source === orderV1.type,
  ) as [string, JSONObject];
  const reviewRequest = lattice.parked.get('human_review')?.[0] as ArvoEvent;

  return { lattice, executionId, row, reviewRequest };
};

/** What a person decides, as an answer to what that order asked for. */
const answerTo = (reviewRequest: ArvoEvent, executionId: string) =>
  createArvoEventFactory(reviewV1).createOutput({
    type: 'evt_review_decided',
    source: reviewV1.type,
    subject: reviewRequest.subject,
    to: orderV1.type,
    executionid: executionId,
    parentid: reviewRequest.id,
    initid: reviewRequest.id,
    depth: reviewRequest.depth,
    data: { approved: true },
  });

/**
 * That same order resumed against its own row, made into whatever the
 * test needs — the row and the execution it belongs to coming from one
 * run, since a row from another would be refused for that first.
 */
const faultOnResume = async (
  corruptRow: (row: JSONObject) => unknown,
): Promise<ArvoHandlerFault> => {
  const { executionId, row, reviewRequest } = await awaitingReview();
  const versions = declareVersions();
  try {
    await versions[orderV1.type]?.['1.0.0']?.execute({
      entry: 'followup',
      event: answerTo(reviewRequest, executionId),
      state: corruptRow(row),
      executionId,
      attempt: 0,
      dependencies: null,
      hooks: {},
      telemetry: executionTelemetry(),
    } as never);
  } catch (thrown) {
    return thrown as ArvoHandlerFault;
  }
  throw new Error('expected this row to be refused');
};

describe('a row that is not a record', () => {
  it('is refused where it does not read at all', async () => {
    const fault = await faultOnResume(() => 'not a row');
    expect(fault.faultKind).toBe('record_invalid');
    expect(fault.abandonmentEvent).toBeNull();
    expect(fault.abandonmentState).toBeNull();
  });

  it('is refused where it holds nothing a record holds', async () => {
    const fault = await faultOnResume(() => ({ nothing: 'much' }));
    expect(fault.faultKind).toBe('record_event_unrestorable');
  });

  it('is refused where an event it holds will not restore', async () => {
    const fault = await faultOnResume((row) => ({
      ...row,
      initEvent: { not: 'one' },
    }));
    expect(fault.faultKind).toBe('record_event_unrestorable');
    expect(fault.abandonmentEvent).toBeNull();
  });

  it('says nothing about an execution it could not read', async () => {
    const fault = await faultOnResume(() => 'not a row');
    expect(fault.executionId).not.toBeNull();
    expect(fault.abandonmentState).toBeNull();
  });
});

describe('a row that reads, and contradicts itself', () => {
  const faultOnDrift = (overrides: JSONObject) =>
    faultOnResume((row) => ({ ...row, ...overrides }));

  it('is refused where it sits at a level its opening event does not', async () => {
    const fault = await faultOnDrift({ depth: 4 });
    expect(fault.faultKind).toBe('record_invalid');
    expect(
      fault.violations.some((violation) => violation.includes('depth')),
    ).toBe(true);
  });

  it('is refused where it names a workflow its opening event does not', async () => {
    const fault = await faultOnDrift({ subject: 'another-workflow' });
    expect(
      fault.violations.some((violation) => violation.includes('subject')),
    ).toBe(true);
  });

  it('is refused where it names a caller its opening event does not', async () => {
    const fault = await faultOnDrift({ parentExecutionId: 'somebody-else' });
    expect(
      fault.violations.some((violation) =>
        violation.includes('parentExecutionId'),
      ),
    ).toBe(true);
  });

  it('is refused where it awaits something it never sent', async () => {
    const fault = await faultOnDrift({
      inFlightEventMap: [['never-sent', null]],
    });
    expect(
      fault.violations.some((violation) => violation.includes('never-sent')),
    ).toBe(true);
  });

  it('is refused where it does not hold the event that opened it', async () => {
    const fault = await faultOnResume((row) => ({
      ...row,
      eventIds: (row.eventIds as { id: string; direction: string }[]).filter(
        (trailEntry) => trailEntry.direction === 'emitted',
      ),
    }));
    expect(
      fault.violations.some((violation) => violation.includes('eventIds')),
    ).toBe(true);
  });

  it('reports every field that drifted, not the first', async () => {
    const fault = await faultOnDrift({ depth: 4, subject: 'another-workflow' });
    expect(fault.violations.length).toBeGreaterThanOrEqual(2);
  });

  it('still answers the caller, the record having read back', async () => {
    const fault = await faultOnDrift({ depth: 4 });
    expect(typeof fault.abandonmentEvent).toBe('string');
    expect(typeof fault.abandonmentState).toBe('string');
  });
});

describe('a row from a deployment that knows more than this one', () => {
  it('is accepted, a reader refusing what it does not know being worse', async () => {
    const { lattice, executionId, row, reviewRequest } = await awaitingReview();
    const versions = declareVersions();

    const response = await versions[orderV1.type]?.['1.0.0']?.execute({
      entry: 'followup',
      event: answerTo(reviewRequest, executionId),
      // a field a later envelope added, which this reader has never seen
      state: { ...row, somethingNewer: { added: 'later' } },
      executionId,
      attempt: 0,
      dependencies: null,
      hooks: {},
      telemetry: executionTelemetry(),
    } as never);

    expect(response?.kind).toBe('produced');
    expect(lattice.transcript.faults).toEqual([]);
  });
});

describe('a crash between committing and publishing', () => {
  const crashingLattice = async (crashRate: number, seed: number) => {
    const lattice = createArvoLattice({
      versions: declareVersions(),
      chaos: { crashBeforePublish: crashRate },
      seed,
    });
    await lattice.publish(anOrder()).settle();
    return lattice;
  };

  it('holds what was committed, and publishes it on recovery', async () => {
    const lattice = await crashingLattice(1, 2);
    expect(lattice.store.size).toBe(1);
    expect(lattice.holding).toBe(2);

    await lattice.recover().settle();
    expect(lattice.store.size).toBe(3);
  });

  it('sends the very events that were committed, not events built again', async () => {
    const lattice = await crashingLattice(1, 2);
    const committedEventIds = [...lattice.transcript.fromExecutions];
    await lattice.recover().settle();

    const publishedIds = lattice.transcript.published.map((event) => event.id);
    for (const id of committedEventIds) expect(publishedIds).toContain(id);
  });

  it('reaches the same end as a run that never crashed', async () => {
    const crashedLattice = await crashingLattice(0.5, 44);
    while (crashedLattice.holding > 0) await crashedLattice.recover().settle();
    const cleanLattice = await crashingLattice(0, 44);

    const endStates = (lattice: Awaited<ReturnType<typeof crashingLattice>>) =>
      [...lattice.store.values()]
        .map((row) => `${row.source}:${row.lifecycle}:${row.casVersion}`)
        .sort();

    expect(endStates(crashedLattice)).toEqual(endStates(cleanLattice));
  });

  it('discards a committed event republished after it was processed', async () => {
    const lattice = await crashingLattice(0, 6);
    // only what a handler receives can be discarded by one: the order's
    // own answer goes to whoever opened it, which is not a handler here
    const answers = lattice.transcript.published.filter(
      (event) => event.initid !== null && event.to === orderV1.type,
    );

    // recovery publishing again what a receiver already processed
    for (const answer of answers) lattice.inject(answer);
    await lattice.settle();

    expect(lattice.transcript.discarded).toHaveLength(answers.length);
    expect(lattice.transcript.faults).toEqual([]);
  });

  it('holds everything that must hold, through a crash and a recovery', async () => {
    const lattice = await crashingLattice(0.5, 44);
    while (lattice.holding > 0) await lattice.recover().settle();
    await checkInvariants(lattice);
  });
});
