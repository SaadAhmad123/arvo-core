import { expect } from 'vitest';
import type { ArvoEvent } from '../../../../src/ArvoEvent/index.js';
import { deriveArvoExecutionId } from '../../../../src/ArvoEventHandler/helpers/execution-id.js';
import type { JSONObject } from '../../../../src/types.js';
import type { ArvoLattice } from './lattice.js';

/**
 * What must be true of any run, however it went.
 *
 * Checked after every scenario in every mode, so each scenario proves
 * these as well as its own point. A property that only holds on the happy
 * path is not a property, and the cheapest way to find that out is to
 * assert all of them every time.
 */

/** Where an event sits in the trail of the execution that handled it. */
type Logged = { id: string; direction: 'received' | 'emitted' };

/**
 * Every event an execution produced to complete something, which answers
 * exactly one request.
 *
 * What something outside the lattice injected is not counted: a second
 * answer somebody types in by hand is the world misbehaving, and what is
 * asked of a handler is what the handler did with it.
 */
const completions = (lattice: ArvoLattice): ArvoEvent[] =>
  lattice.transcript.published.filter(
    (event) =>
      event.initid !== null && lattice.transcript.fromExecutions.has(event.id),
  );

/** Every event asking something to be done, which awaits exactly one answer. */
const requests = (lattice: ArvoLattice): ArvoEvent[] =>
  lattice.transcript.published.filter(
    (event) => event.initid === null && event.parentid !== null,
  );

/** Everything the store holds, as records rather than rows. */
const rows = (lattice: ArvoLattice): [string, JSONObject][] => [
  ...lattice.store.entries(),
];

/**
 * Every request has exactly one terminal answer.
 *
 * The property a user actually depends on: nobody is left waiting, and
 * nobody is answered twice. A repeat answered twice would reach a caller
 * as two outcomes for one ask, which no amount of care downstream can
 * undo.
 */
export const everyRequestAnsweredOnce = (lattice: ArvoLattice): void => {
  const answers = new Map<string, number>();
  for (const answer of completions(lattice)) {
    const asked = answer.initid as string;
    answers.set(asked, (answers.get(asked) ?? 0) + 1);
  }

  const twice = [...answers.entries()].filter(([, count]) => count > 1);
  expect(twice, 'a request answered more than once').toEqual([]);

  const unanswered = requests(lattice)
    .filter((asked) => !answers.has(asked.id))
    .filter((asked) => asked.domain === null)
    .filter((asked) => !stillParked(lattice, asked));
  expect(
    unanswered.map((asked) => asked.type),
    'a request nothing ever answered',
  ).toEqual([]);
};

/** Whether this request is one something outside the lattice still holds. */
const stillParked = (lattice: ArvoLattice, asked: ArvoEvent): boolean =>
  [...lattice.parked.values()].some((waiting) =>
    waiting.some((event) => event.id === asked.id),
  );

/**
 * Nothing an execution emitted survives the round that faulted.
 *
 * A fault concludes nothing, so a batch it refused must have left no
 * trace: the events were never published and the record was never
 * committed. Half of a batch reaching the lattice would leave an
 * execution in a state no lifecycle describes.
 */
export const nothingLeaksFromAFaultedRound = (lattice: ArvoLattice): void => {
  const published = new Set(
    lattice.transcript.published.map((event) => event.id),
  );
  for (const { fault } of lattice.transcript.faults) {
    if (fault.abandonmentEvent === null) continue;
    const abandonment = JSON.parse(fault.abandonmentEvent) as { id: string };
    const wasPublished = published.has(abandonment.id);
    const wasAbandoned = lattice.transcript.abandoned.some(
      (given) => given.fault === fault,
    );
    expect(
      !wasPublished || wasAbandoned,
      'an abandonment event published without the lattice giving up',
    ).toBe(true);
  }
};

/**
 * Every record a store holds is one that reads back.
 *
 * A row is read by a different process, and possibly a newer deployment,
 * so one that cannot be parsed and compared is a workflow that cannot
 * resume. Written twice it must also give the same bytes, because a store
 * that compares or deduplicates on them would otherwise see two records
 * where there is one.
 */
export const everyRecordReadsBack = (lattice: ArvoLattice): void => {
  for (const [executionId, row] of rows(lattice)) {
    const written = JSON.stringify(row);
    expect(
      JSON.stringify(JSON.parse(written)),
      `the record for ${executionId} does not survive being written out`,
    ).toBe(written);
  }
};

/**
 * Each execution's revisions run from zero, one at a time.
 *
 * A gap means a write landed that nothing read; a repeat means two writes
 * believed they were the same one. Either way a store comparing revisions
 * can no longer tell a concurrent write from an ordinary one.
 */
export const revisionsAdvanceOneAtATime = (lattice: ArvoLattice): void => {
  const seen = new Map<string, number[]>();
  for (const { executionId, row } of lattice.transcript.committed) {
    const at = seen.get(executionId) ?? [];
    at.push(Number(row.casVersion));
    seen.set(executionId, at);
  }

  for (const [executionId, revisions] of seen) {
    expect(revisions[0], `${executionId} did not open at revision 0`).toBe(0);
    for (let at = 1; at < revisions.length; at += 1) {
      expect(
        revisions[at],
        `${executionId} jumped from ${revisions[at - 1]} to ${revisions[at]}`,
      ).toBe((revisions[at - 1] as number) + 1);
    }
  }
};

/**
 * Every event sits where the execution that sent it says it does.
 *
 * A request opens an execution one level deeper, so it carries one more
 * than the execution sending it. A completion belongs to the execution it
 * ends, so it carries that execution's own level — which is one *below*
 * the request that caused it, and why this is read off the record rather
 * than off the event that came before.
 *
 * It is the whole of the runaway-nesting signal: a request that failed to
 * count would make an unbounded chain look flat.
 */
export const everyEventSitsWhereItSaysItDoes = (lattice: ArvoLattice): void => {
  const byId = new Map(
    lattice.transcript.published.map((event) => [event.id, event]),
  );

  for (const [executionId, row] of rows(lattice)) {
    const sitsAt = Number(row.depth);
    for (const logged of row.eventIds as Logged[]) {
      if (logged.direction !== 'emitted') continue;
      const sent = byId.get(logged.id);
      if (sent === undefined) continue;

      const opensAnother = sent.initid === null;
      expect(
        sent.depth,
        `${sent.type} left ${executionId} at the wrong level`,
      ).toBe(opensAnother ? sitsAt + 1 : sitsAt);
    }
  }
};

/**
 * Every event belongs to the workflow of whatever caused it.
 *
 * One workflow, one `subject`, for its whole life and every branch of it.
 * A branch that leaves takes its executions with it, and whoever asked
 * about the workflow afterwards is told a story with a piece missing.
 */
export const everyEventStaysInItsWorkflow = (lattice: ArvoLattice): void => {
  const byId = new Map(
    lattice.transcript.published.map((event) => [event.id, event]),
  );

  for (const event of lattice.transcript.published) {
    expect(event.subject, 'an event belonging to no workflow').toBeTruthy();
    const caused = event.parentid === null ? null : byId.get(event.parentid);
    if (caused === undefined || caused === null) continue;
    expect(
      event.subject,
      `${event.type} left the workflow its cause belonged to`,
    ).toBe(caused.subject);
  }
};

/**
 * Nothing a workflow carries across every event is altered on the way.
 *
 * `baggage` is written once at the root and copied forward. A branch that
 * changes it couples two nodes with no contract saying so, and fan-in
 * then needs a merge rule the model does not have.
 */
export const baggageNeverDrifts = (lattice: ArvoLattice): void => {
  const perWorkflow = new Map<string, string>();
  for (const event of lattice.transcript.published) {
    const carried = JSON.stringify(event.baggage);
    const first = perWorkflow.get(event.subject);
    if (first === undefined) {
      perWorkflow.set(event.subject, carried);
      continue;
    }
    expect(carried, `${event.subject} carries two different baggages`).toBe(
      first,
    );
  }
};

/**
 * No handler was given work that had left the lattice.
 *
 * A domained event is work to be fulfilled elsewhere. One delivered
 * anyway would be done twice — once by whoever was meant to, once by a
 * handler that should never have seen it.
 */
export const nothingParkedWasDelivered = (lattice: ArvoLattice): void => {
  const given = lattice.transcript.delivered.filter(
    ({ event }) => event.domain !== null,
  );
  expect(
    given.map(({ event }) => event.type),
    'a handler was given an event that had left the lattice',
  ).toEqual([]);
};

/**
 * No execution awaits a request its own trail does not hold.
 *
 * The awaited collection describes what this round asked for. A key with
 * no matching emission means the record is describing traffic that never
 * happened, and the answer it waits for will never be recognised.
 */
export const nothingAwaitsWhatWasNeverSent = (lattice: ArvoLattice): void => {
  for (const [executionId, row] of rows(lattice)) {
    const sent = new Set(
      (row.eventIds as Logged[])
        .filter((logged) => logged.direction === 'emitted')
        .map((logged) => logged.id),
    );
    for (const [awaited] of row.inFlightEventMap as [string, unknown][]) {
      expect(
        sent.has(awaited),
        `${executionId} awaits ${awaited}, which it never sent`,
      ).toBe(true);
    }
  }
};

/**
 * Every execution the store holds is the one its own opening event names.
 *
 * The identity is derived rather than minted so that a repeated opening
 * event resolves to the execution already running. A row under a key the
 * derivation does not produce is a fork nobody asked for.
 */
export const everyRecordIsUnderItsOwnIdentity = async (
  lattice: ArvoLattice,
): Promise<void> => {
  for (const [executionId, row] of rows(lattice)) {
    const opening = row.initEvent as { dataschema: string; id: string };
    const derived = await deriveArvoExecutionId(opening as ArvoEvent);
    expect(
      derived,
      `${executionId} holds a record its opening event does not derive to`,
    ).toBe(executionId);
  }
};

/**
 * A terminal execution stays as it ended.
 *
 * Reaching an end is a fact about an execution, and a later round that
 * wrote over it would erase how a workflow actually finished.
 */
export const nothingOutlivesItsEnd = (lattice: ArvoLattice): void => {
  const ended = new Map<string, string>();
  for (const { executionId, row } of lattice.transcript.committed) {
    const was = ended.get(executionId);
    expect(
      was,
      `${executionId} was written again after ending at ${was}`,
    ).toBeUndefined();
    const lifecycle = String(row.lifecycle);
    if (['success', 'error', 'cancelled', 'failure'].includes(lifecycle)) {
      ended.set(executionId, lifecycle);
    }
  }
};

/**
 * Everything above, over one run.
 *
 * @param lattice - The lattice whose transcript is being judged.
 *
 * @example
 * ```typescript
 * await lattice.publish(order).settle();
 * await checkInvariants(lattice);
 * ```
 */
export const checkInvariants = async (lattice: ArvoLattice): Promise<void> => {
  everyRequestAnsweredOnce(lattice);
  nothingLeaksFromAFaultedRound(lattice);
  everyRecordReadsBack(lattice);
  revisionsAdvanceOneAtATime(lattice);
  everyEventStaysInItsWorkflow(lattice);
  everyEventSitsWhereItSaysItDoes(lattice);
  baggageNeverDrifts(lattice);
  nothingParkedWasDelivered(lattice);
  nothingAwaitsWhatWasNeverSent(lattice);
  nothingOutlivesItsEnd(lattice);
  await everyRecordIsUnderItsOwnIdentity(lattice);
};
