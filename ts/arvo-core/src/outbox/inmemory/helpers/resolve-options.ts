import type {
  ArvoMemoryOutboxBuffer,
  ArvoMemoryOutboxOptions,
} from '../types.js';

/** Each buffer of an outbox built with none given. */
const DEFAULT_BUFFER: ArvoMemoryOutboxBuffer = Object.freeze({
  size: 10_000,
  tolerance: 0.2,
});

/** How long an outbox built with none given keeps a seen event. */
const DEFAULT_SEEN_EVENTS_RETENTION_MS = 5 * 60 * 1000;

/** How long an outbox built with none given keeps a terminal state. */
const DEFAULT_TERMINAL_STATES_RETENTION_MS = 60 * 60 * 1000;

/** The shortest time between two sweeps. */
const SHORTEST_SWEEP_INTERVAL_MS = 1000;

/** How many sweeps run within the shorter retention. */
const SWEEPS_PER_RETENTION = 10;

/** Every option of an outbox, none left out. */
export type ArvoMemoryOutboxResolvedOptions = {
  readonly clock: () => Date;
  readonly buffers: {
    readonly events: ArvoMemoryOutboxBuffer;
    readonly states: ArvoMemoryOutboxBuffer;
  };
  readonly retentionMs: {
    readonly seenEvents: number;
    readonly terminalStates: number;
  };
  /** How long between two sweeps, worked out from the shorter retention. */
  readonly sweepIntervalMs: number;
};

/**
 * Options already checked, with every default applied where one was left
 * out, and the sweep interval worked out from the retentions.
 */
export const resolveOptions = (
  options: ArvoMemoryOutboxOptions,
): ArvoMemoryOutboxResolvedOptions => {
  const seenEvents =
    options.retentionMs?.seenEvents ?? DEFAULT_SEEN_EVENTS_RETENTION_MS;
  const terminalStates =
    options.retentionMs?.terminalStates ?? DEFAULT_TERMINAL_STATES_RETENTION_MS;
  return {
    clock: options.clock ?? (() => new Date()),
    buffers: {
      events: options.buffers?.events ?? DEFAULT_BUFFER,
      states: options.buffers?.states ?? DEFAULT_BUFFER,
    },
    retentionMs: { seenEvents, terminalStates },
    sweepIntervalMs: Math.max(
      SHORTEST_SWEEP_INTERVAL_MS,
      Math.min(seenEvents, terminalStates) / SWEEPS_PER_RETENTION,
    ),
  };
};
