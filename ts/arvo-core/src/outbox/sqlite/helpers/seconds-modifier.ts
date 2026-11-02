/** A SQLite date modifier moving a time back by `durationMs`. */
export const secondsAgo = (durationMs: number): string =>
  `-${durationMs / 1000} seconds`;

/** A SQLite date modifier moving a time forward by `durationMs`. */
export const secondsLater = (durationMs: number): string =>
  `+${durationMs / 1000} seconds`;
