import Database from 'better-sqlite3';

/**
 * Reaching into a SQLite outbox's file through a connection of the check's
 * own, as another writer would: to age what it holds, or count it.
 */

/** Runs `write` on a connection of its own to the file, closed after. */
export const writeAsAnotherConnection = <Answer>(
  filename: string,
  write: (otherConnection: Database.Database) => Answer,
): Answer => {
  const otherConnection = new Database(filename, { timeout: 10_000 });
  try {
    return write(otherConnection);
  } finally {
    otherConnection.close();
  }
};

/** Moves every seen event's `seen_at`, and every state's last commit, back to long ago. */
export const ageEverything = (filename: string): void =>
  writeAsAnotherConnection(filename, (otherConnection) => {
    otherConnection.exec(
      "update arvo_outbox_event set seen_at = '2000-01-01T00:00:00.000Z' where seen = 1",
    );
    otherConnection.exec(
      "update arvo_outbox_state set committed_at = '2000-01-01T00:00:00.000Z'",
    );
  });

/** How many events and states the file holds. */
export const countRows = (filename: string) =>
  writeAsAnotherConnection(filename, (otherConnection) => ({
    events: Number(
      otherConnection
        .prepare('select count(*) as rowCount from arvo_outbox_event')
        .pluck()
        .get(),
    ),
    states: Number(
      otherConnection
        .prepare('select count(*) as rowCount from arvo_outbox_state')
        .pluck()
        .get(),
    ),
  }));
