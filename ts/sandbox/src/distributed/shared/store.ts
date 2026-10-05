import type { ArvoEvent } from 'arvo-core';
import { ArvoEventSerializer } from 'arvo-core';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

/**
 * The record store and the outbox beside it, which is where two of
 * ADR-006's obligations are actually met.
 *
 * Obligation 1 says the events a handler produced and the record it
 * produced them with must be preserved together, and that the events
 * must reach their destinations once the record is committed. That is
 * one transaction writing both, and a publisher that reads the events
 * back out afterwards — never events held in memory and hoped for.
 *
 * Obligation 5 says writes to one record must be serialized, and that a
 * mechanism may commit at revision zero only where no record exists.
 * Neither of those is enforced here. Both are constraints in the
 * schema, and this only reports which one a writer met, because a rule
 * every writer has to remember to apply is a rule one of them will not.
 *
 * What this deliberately does **not** do is understand a record. A read
 * answers with whatever is stored, unparsed and unjudged, because
 * obligation 2 gives that judgement to the handler: a row that is not a
 * record must be refused by the handler rather than withheld by the
 * mechanism. The only fields read here are the ones a record is
 * addressed and ordered by, and they are read to write them into
 * columns rather than to decide anything.
 */

/** How an event is written into the outbox, and read back out of it. */
const WIRE = new ArvoEventSerializer({ type: 'arvoevent' });

/**
 * The fields a record is addressed and ordered by.
 *
 * Read on the way in only, to put them in columns the store can index
 * and constrain. ADR-007 fixes every one of them, so a record missing
 * one was not written by a handler.
 */
const recordAddressing = z.object({
  executionId: z.string().min(1),
  casVersion: z.number().int().nonnegative(),
  subject: z.string().min(1),
  source: z.string().min(1),
  version: z.string().min(1),
  lifecycle: z.string().min(1),
});

/** What the database says when a writer loses a race it was in. */
const OUTCOMES = {
  /** Another writer reached this revision first. The primary key's own. */
  revisionTaken: '23505',
  /** This revision does not follow the one before it. */
  revisionOutOfSequence: 'AR001',
  /** Something tried to alter a revision already written. */
  revisionAltered: 'AR002',
} as const;

/** Why a commit did not happen, where the store refused it. */
export type CommitRefusal =
  | 'revision_taken'
  | 'revision_out_of_sequence'
  | 'revision_altered';

/**
 * What one commit did.
 *
 * Discriminated rather than thrown, because losing a race is ordinary:
 * the loser re-reads and converges, which is a different thing from the
 * store being unreachable. That still throws.
 */
export type CommitOutcome =
  | {
      readonly committed: true;
      readonly executionId: string;
      readonly casVersion: number;
      /** The events, as written. Publishing these publishes what was committed. */
      readonly events: readonly CommittedEvent[];
    }
  | { readonly committed: false; readonly because: CommitRefusal };

/** One event as the outbox holds it, which is as it was committed. */
export type CommittedEvent = {
  readonly eventId: string;
  readonly executionId: string;
  readonly casVersion: number;
  readonly subject: string;
  readonly eventType: string;
  readonly addressedTo: string | null;
  readonly domain: string | null;
  /** The event itself, byte for byte as it was committed. */
  readonly payload: string;
};

/** What the record store offers whatever is running a handler. */
export type RecordStore = {
  /**
   * The latest revision of one execution, exactly as stored.
   *
   * This is what a mechanism hands the handler as its state function.
   * It reads on every call and answers with the document and nothing
   * else: no classifying, no deriving, no filtering, and no validating.
   */
  readRecord(executionId: string): Promise<Record<string, unknown> | null>;

  /**
   * One record and the events produced with it, committed together.
   *
   * Either both are in the database or neither is. Nothing is published
   * from here: a publisher reads the outbox afterwards, which is what
   * makes recovery send what was committed rather than running the
   * execution again to produce it.
   */
  commit(param: {
    record: Record<string, unknown>;
    events: readonly ArvoEvent[];
  }): Promise<CommitOutcome>;

  /**
   * Every event committed with the record that one triggering event
   * produced, exactly as the outbox holds them.
   *
   * This is the recovery read. A delivery repeated after its commit
   * finds the execution already answered, and what it has to publish is
   * what the first one committed rather than anything it could produce
   * again — so the second attempt reads the bytes rather than
   * re-deriving them.
   *
   * @param executionId - The execution concerned.
   * @param triggeringEventId - The event whose execution committed them.
   */
  committedFor(
    executionId: string,
    triggeringEventId: string,
  ): Promise<readonly CommittedEvent[]>;

  /**
   * Marks these events published, having been sent by something other
   * than {@link drainOutbox}.
   *
   * A mechanism durable enough to send them itself — a workflow, whose
   * decisions survive the worker that made them — publishes and then
   * says so. The drain is then only for what such a mechanism never got
   * round to.
   */
  markPublished(eventIds: readonly string[]): Promise<number>;

  /**
   * Hands every committed-but-unpublished event to `send`, oldest
   * first, and marks as published only what `send` accepted.
   *
   * Claimed with a row lock that other publishers skip, so several
   * workers draining at once divide the work rather than duplicating
   * it. An event `send` throws on stays unpublished and is offered
   * again, which is why a receiver must discard a repeat rather than
   * process it twice.
   *
   * @param send - How to send one event.
   * @param param - How many to claim, and how long to leave an event to
   * whoever committed it before taking it over. A grace period of zero
   * claims everything outstanding, which is what a test recovering from
   * a killed worker wants and what a running system does not.
   * @returns How many events were published.
   */
  drainOutbox(
    send: (one: CommittedEvent) => Promise<void>,
    param?: { atMost?: number; afterMs?: number },
  ): Promise<number>;
};

/** How an outbox row is read back, named as the type names it. */
const OUTBOX_COLUMNS = `event_id      AS "eventId",
          execution_id  AS "executionId",
          cas_version   AS "casVersion",
          subject,
          event_type    AS "eventType",
          addressed_to  AS "addressedTo",
          domain,
          payload`;

/** The values one outbox row is written from. */
const outboxRowFor = (
  event: ArvoEvent,
  payload: string,
  addressingFields: z.infer<typeof recordAddressing>,
) => [
  event.id,
  addressingFields.executionId,
  addressingFields.casVersion,
  event.to,
  event.subject,
  event.type,
  event.domain,
  payload,
];

/** Which of the store's refusals an error is, or nothing if it is none of them. */
const refusalFor = (failure: unknown): CommitRefusal | null => {
  const code = (failure as { code?: unknown }).code;
  if (code === OUTCOMES.revisionTaken) return 'revision_taken';
  if (code === OUTCOMES.revisionOutOfSequence)
    return 'revision_out_of_sequence';
  if (code === OUTCOMES.revisionAltered) return 'revision_altered';
  return null;
};

/** How many events one drain claims at a time, where a caller says nothing. */
const DRAIN_BATCH = 64;

/**
 * The record store, against the database that holds it.
 *
 * @param pool - Where connections come from, bounded by configuration so
 * a leak shows up as exhaustion rather than as a slow worker.
 */
export const storeFor = (pool: Pool): RecordStore => ({
  readRecord: async (executionId) => {
    const latest = await pool.query<{ document: Record<string, unknown> }>(
      `SELECT document FROM execution_record
       WHERE execution_id = $1
       ORDER BY cas_version DESC
       LIMIT 1`,
      [executionId],
    );
    return latest.rows[0]?.document ?? null;
  },

  commit: async ({ record, events }) => {
    // The columns, not the record: what is stored is the document the
    // handler wrote, whole and uninterpreted.
    const addressingFields = recordAddressing.parse(record);

    // Written before the transaction opens, so a transaction is never
    // held open across work that could fail for its own reasons.
    const payloads = await Promise.all(
      events.map(async (event) => ({
        event,
        payload: await WIRE.serialize(event),
      })),
    );

    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO execution_record
           (execution_id, cas_version, subject, source, version, lifecycle, document)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          addressingFields.executionId,
          addressingFields.casVersion,
          addressingFields.subject,
          addressingFields.source,
          addressingFields.version,
          addressingFields.lifecycle,
          record,
        ],
      );

      for (const { event, payload } of payloads) {
        await client.query(
          `INSERT INTO outbox
             (event_id, execution_id, cas_version, addressed_to, subject,
              event_type, domain, payload)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           -- An event's id is globally unique, so the same event
           -- committed twice is a repeat rather than a second event.
           ON CONFLICT (event_id) DO NOTHING`,
          outboxRowFor(event, payload, addressingFields),
        );
      }

      await client.query('COMMIT');
      return {
        committed: true,
        executionId: addressingFields.executionId,
        casVersion: addressingFields.casVersion,
        events: payloads.map(({ event, payload }) => ({
          eventId: event.id,
          executionId: addressingFields.executionId,
          casVersion: addressingFields.casVersion,
          subject: event.subject,
          eventType: event.type,
          addressedTo: event.to,
          domain: event.domain,
          payload,
        })),
      };
    } catch (raised) {
      await client.query('ROLLBACK');
      const refusal = refusalFor(raised);
      if (refusal === null) throw raised;
      return { committed: false, because: refusal };
    } finally {
      client.release();
    }
  },

  committedFor: async (executionId, triggeringEventId) => {
    const committed = await pool.query<CommittedEvent>(
      `SELECT ${OUTBOX_COLUMNS}
       FROM outbox
       WHERE execution_id = $1
         AND cas_version IN (
           SELECT cas_version FROM execution_record
           WHERE execution_id = $1
             AND document -> 'triggeringEvent' ->> 'id' = $2
         )
       ORDER BY committed_at`,
      [executionId, triggeringEventId],
    );
    return committed.rows;
  },

  markPublished: async (eventIds) => {
    if (eventIds.length === 0) return 0;
    const marked = await pool.query(
      `UPDATE outbox SET published_at = now()
       WHERE event_id = ANY($1::text[]) AND published_at IS NULL`,
      [[...eventIds]],
    );
    return marked.rowCount ?? 0;
  },

  drainOutbox: async (send, { atMost = DRAIN_BATCH, afterMs = 0 } = {}) => {
    const client: PoolClient = await pool.connect();
    let published = 0;

    try {
      await client.query('BEGIN');

      const claimed = await client.query<CommittedEvent>(
        `SELECT ${OUTBOX_COLUMNS}
         FROM outbox
         WHERE published_at IS NULL
           -- left to whoever committed it for this long first, so the
           -- ordinary path publishes its own events and this one picks
           -- up only what was abandoned mid-send
           AND committed_at < now() - ($2::bigint * interval '1 millisecond')
         ORDER BY committed_at
         LIMIT $1
         -- Other publishers pass over what this one holds, so draining
         -- from several workers divides the work rather than repeating
         -- it.
         FOR UPDATE SKIP LOCKED`,
        [atMost, afterMs],
      );

      for (const claimedEvent of claimed.rows) {
        // Sent inside the claim, so a publisher that dies mid-send
        // releases the row still unpublished and the event is offered
        // again. At-least-once, which is what the receiver's discard is
        // for.
        await send(claimedEvent);
        await client.query(
          'UPDATE outbox SET published_at = now() WHERE event_id = $1',
          [claimedEvent.eventId],
        );
        published += 1;
      }

      await client.query('COMMIT');
      return published;
    } catch (raised) {
      await client.query('ROLLBACK');
      throw raised;
    } finally {
      client.release();
    }
  },
});
