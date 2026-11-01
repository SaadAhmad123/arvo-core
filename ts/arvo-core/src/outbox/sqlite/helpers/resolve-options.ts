import type { ArvoSqliteOutboxOptions } from '../types.js';

/** How long an outbox built with none given waits for a file another writer holds. */
const DEFAULT_BUSY_TIMEOUT_MS = 5000;

/** How long an outbox built with none given keeps a seen event. */
const DEFAULT_SEEN_EVENTS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** How long an outbox built with none given keeps a terminal state. */
const DEFAULT_TERMINAL_STATES_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Every option of an outbox, none left out. */
export type ArvoSqliteOutboxResolvedOptions = {
  readonly filename: string;
  readonly busyTimeoutMs: number;
  readonly retentionMs: {
    readonly seenEvents: number;
    readonly terminalStates: number;
  };
};

/** Options already checked, with every default applied where one was left out. */
export const resolveOptions = (
  options: ArvoSqliteOutboxOptions,
): ArvoSqliteOutboxResolvedOptions => ({
  filename: options.filename,
  busyTimeoutMs: options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS,
  retentionMs: {
    seenEvents:
      options.retentionMs?.seenEvents ?? DEFAULT_SEEN_EVENTS_RETENTION_MS,
    terminalStates:
      options.retentionMs?.terminalStates ??
      DEFAULT_TERMINAL_STATES_RETENTION_MS,
  },
});
