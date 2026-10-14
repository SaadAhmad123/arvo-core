import type { Pool } from 'pg';

/**
 * Empties the record store, so a replay runs against nothing of the run
 * it is replaying.
 *
 * The outbox goes with the records it belongs to: the foreign key
 * cascades, which is obligation 1 as a constraint — there is no way to
 * keep an event whose record is gone.
 *
 * A record is immutable by trigger, and the trigger refuses deletes as
 * well as updates. It is disabled for exactly this statement and
 * restored afterwards, because the alternative is a store no test can
 * reset and the alternative to that is a weaker constraint in
 * production. Nothing outside a test ever calls this.
 *
 * @param pool - Where the records are.
 */
export const clearRecords = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'ALTER TABLE execution_record DISABLE TRIGGER execution_record_immutable',
    );
    await client.query('DELETE FROM execution_record');
    await client.query(
      'ALTER TABLE execution_record ENABLE TRIGGER execution_record_immutable',
    );
    await client.query('COMMIT');
  } catch (raised) {
    await client.query('ROLLBACK');
    throw raised;
  } finally {
    client.release();
  }
};

/**
 * Forgets every reservation of one item and puts its stock back.
 *
 * The handlers' own data is as much part of what a run read as the
 * record store is, so a replay that left it as the run finished would be
 * reading different inputs and proving nothing. Forgetting the
 * reservations is the other half: an idempotency key already claimed
 * would make a replay recover its reservation rather than make it.
 *
 * @param pool - Where the handlers' data is.
 * @param sku - The item concerned.
 * @param held - What it held before the run.
 */
export const restoreStock = async (
  pool: Pool,
  sku: string,
  held: number,
): Promise<void> => {
  await pool.query('DELETE FROM reservation WHERE sku = $1', [sku]);
  await pool.query('UPDATE catalogue SET held = $2 WHERE sku = $1', [
    sku,
    held,
  ]);
};
