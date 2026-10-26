/** SQLite's clock, read once, refusing a statement that answers no time. */
export const readSqliteNow = (selectNow: {
  get(): { readonly now: string } | undefined;
}): string => {
  const clockRow = selectNow.get();
  if (clockRow === undefined) {
    throw new Error(
      'ArvoSqliteOutbox asked SQLite for the current time and got no answer; nothing was committed.',
    );
  }
  return clockRow.now;
};
