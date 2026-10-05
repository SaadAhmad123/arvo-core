import type { ArvoEvent } from 'arvo-core';
import type { Pool } from 'pg';

/**
 * Where an event goes when nothing running will carry it further.
 *
 * Both mechanisms write here, and for the same three reasons: an event
 * that carries a domain and so left the lattice, one addressed to
 * something no handler implements, and a delivery no further attempt
 * could fix that carried no abandonment of its own.
 *
 * A row here is the opposite of a failure that vanished into a log.
 * ADR-008 asks that a fault nothing will retry land somewhere a person
 * could find it, and a table is the only answer to that which survives
 * the process that wrote it.
 */

/** Why one event is here, which decides what a person does about it. */
export type WhyItNeedsAPerson =
  | 'left_the_lattice'
  | 'addressed_outside'
  | 'nothing_will_retry';

/** One event waiting for a person, as the table holds it. */
export type WaitingForAPerson = {
  readonly eventId: string;
  readonly why: WhyItNeedsAPerson;
  readonly subject: string;
  readonly executionId: string | null;
  readonly eventType: string;
  readonly addressedTo: string | null;
  readonly domain: string | null;
  readonly message: string | null;
  readonly payload: string;
};

/**
 * Leaves one event where a person can find it.
 *
 * The same event twice is one row, keyed on the event's own id, so a
 * redelivery does not ask twice for the same decision.
 *
 * @returns Whether this was the first time it was noticed.
 */
export const needsAPerson = async (
  pool: Pool,
  param: {
    event: ArvoEvent;
    payload: string;
    why: WhyItNeedsAPerson;
    executionId: string | null;
    message: string | null;
  },
): Promise<boolean> => {
  const inserted = await pool.query(
    `INSERT INTO needs_a_person
       (event_id, why, subject, execution_id, event_type, addressed_to,
        domain, message, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (event_id) DO NOTHING`,
    [
      param.event.id,
      param.why,
      param.event.subject,
      param.executionId,
      param.event.type,
      param.event.to,
      param.event.domain,
      param.message,
      param.payload,
    ],
  );
  return inserted.rowCount === 1;
};

/**
 * What is still outstanding, for whoever is answering on a person's
 * behalf.
 *
 * @param why - Which of the three to read, or every one of them.
 */
export const outstandingForAPerson = async (
  pool: Pool,
  why?: WhyItNeedsAPerson,
): Promise<readonly WaitingForAPerson[]> => {
  const outstanding = await pool.query<WaitingForAPerson>(
    `SELECT event_id     AS "eventId",
            why,
            subject,
            execution_id AS "executionId",
            event_type   AS "eventType",
            addressed_to AS "addressedTo",
            domain,
            message,
            payload
     FROM needs_a_person
     WHERE answered_at IS NULL
       AND ($1::text IS NULL OR why = $1)
     ORDER BY noticed_at`,
    [why ?? null],
  );
  return outstanding.rows;
};

/** Marks one as dealt with, so it stops being outstanding. */
export const answeredByAPerson = async (
  pool: Pool,
  eventId: string,
): Promise<void> => {
  await pool.query(
    'UPDATE needs_a_person SET answered_at = now() WHERE event_id = $1',
    [eventId],
  );
};
