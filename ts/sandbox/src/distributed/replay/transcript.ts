import type { JSONObject } from 'arvo-core';
import type { Pool } from 'pg';
import type { Transcript, TranscriptStep } from './protocol.js';

/**
 * One run, described entirely from what was committed.
 *
 * Nothing here is collected as a run goes. Everything is read back out
 * of the record store and the outbox afterwards, because a transcript
 * assembled in memory is a transcript a replay would be comparing
 * against itself — and the claim being tested is that the record is the
 * memory.
 *
 * Even the event that entered the lattice from outside is recovered
 * this way: every record holds the event that caused it, so the first
 * revision of the first execution carries the event nobody committed.
 */

/** One revision, as its columns and its document stand. */
type RevisionRow = {
  readonly executionId: string;
  readonly casVersion: number;
  readonly document: JSONObject;
};

/** The event that caused a delivery, read off the record it produced. */
const triggeringEventOf = (document: JSONObject): string => {
  const event = document.triggeringEvent;
  if (event === null || typeof event !== 'object') {
    throw new Error(
      'a committed record holds no triggering event, so what was delivered cannot be read back',
    );
  }
  return JSON.stringify(event);
};

/**
 * Every delivery of one workflow that committed, oldest first.
 *
 * Ordered by revision within an execution and by when they were written
 * across executions, which is the order they can be replayed in: a
 * record cannot be read before the revision it follows was written.
 *
 * @param pool - Where the records are.
 * @param subject - The workflow concerned.
 */
export const transcriptOf = async (
  pool: Pool,
  subject: string,
): Promise<Transcript> => {
  const revisions = await pool.query<RevisionRow>(
    `SELECT execution_id     AS "executionId",
            -- a BIGINT reads back as a string, and a revision is
            -- compared and decremented here
            cas_version::int AS "casVersion",
            document
       FROM execution_record
      WHERE subject = $1
      ORDER BY written_at, execution_id, cas_version`,
    [subject],
  );

  const emitted = await pool.query<{
    executionId: string;
    casVersion: number;
    payload: string;
  }>(
    `SELECT execution_id     AS "executionId",
            cas_version::int AS "casVersion",
            payload
       FROM outbox
      WHERE subject = $1
      ORDER BY committed_at, event_id`,
    [subject],
  );

  /** What each revision committed, keyed as the outbox keys it. */
  const emittedAt = new Map<string, string[]>();
  for (const row of emitted.rows) {
    const key = `${row.executionId}:${row.casVersion}`;
    emittedAt.set(key, [...(emittedAt.get(key) ?? []), row.payload]);
  }

  /** What the revision before this one said, which is what it read. */
  const documentAt = new Map<string, JSONObject>();
  for (const row of revisions.rows) {
    documentAt.set(`${row.executionId}:${row.casVersion}`, row.document);
  }

  const steps: TranscriptStep[] = revisions.rows.map((row) => ({
    executionId: row.executionId,
    casVersion: row.casVersion,
    delivered: triggeringEventOf(row.document),
    recordAsRead:
      documentAt.get(`${row.executionId}:${row.casVersion - 1}`) ?? null,
    committed: row.document,
    emitted: emittedAt.get(`${row.executionId}:${row.casVersion}`) ?? [],
  }));

  return { subject, steps };
};
