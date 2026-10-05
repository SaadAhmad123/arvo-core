/**
 * How a test reads a signal back out of the backend that received it.
 *
 * Every assertion about telemetry in this suite goes through here, so
 * that a signal is only ever claimed to exist once something outside
 * the process has confirmed it. Asserting on what was emitted proves
 * the call was made; asserting on what came back proves the pipeline
 * carried it, and only the second one is worth writing.
 *
 * Each read waits, because none of these backends ingest synchronously.
 */

const TEMPO = process.env.TEMPO_URL ?? 'http://localhost:3200';
const PROMETHEUS = process.env.PROMETHEUS_URL ?? 'http://localhost:9090';
const LOKI = process.env.LOKI_URL ?? 'http://localhost:3100';

/** How long a read waits before saying what it never saw. */
export const DEFAULT_PATIENCE = 30_000;

/**
 * Waits for something to become true, or gives up saying what it wanted.
 *
 * @param what - What was being waited for, read out in the failure.
 * @param look - One attempt, answering null while the answer is absent.
 * @param within - How long to keep attempting.
 */
export const until = async <TFound>(
  what: string,
  look: () => Promise<TFound | null>,
  within = DEFAULT_PATIENCE,
): Promise<TFound> => {
  const giveUpAt = Date.now() + within;
  let last: unknown = null;

  while (Date.now() < giveUpAt) {
    try {
      const found = await look();
      if (found !== null) return found;
    } catch (raised) {
      last = raised;
    }
    await new Promise((settle) => setTimeout(settle, 500));
  }

  throw new Error(
    `${what} never arrived within ${within}ms${last === null ? '' : `: ${String(last)}`}`,
  );
};

/** What Tempo returns for one trace: batches of spans, as it stores them. */
type TempoTrace = { batches?: unknown[] };

/** The trace Tempo holds under this id, once it holds one. */
export const traceFromTempo = async (
  traceId: string,
  within = DEFAULT_PATIENCE,
): Promise<TempoTrace> =>
  until(
    `the trace ${traceId} in Tempo`,
    async () => {
      const answered = await fetch(`${TEMPO}/api/traces/${traceId}`);
      if (!answered.ok) return null;
      const held = (await answered.json()) as TempoTrace;
      return (held.batches?.length ?? 0) > 0 ? held : null;
    },
    within,
  );

/** What Prometheus answers for one query, once it answers anything. */
export const seriesFromPrometheus = async (
  query: string,
  within = DEFAULT_PATIENCE,
): Promise<unknown[]> =>
  until(
    `the series ${query} in Prometheus`,
    async () => {
      const answered = await fetch(
        `${PROMETHEUS}/api/v1/query?query=${encodeURIComponent(query)}`,
      );
      if (!answered.ok) return null;
      const held = (await answered.json()) as { data?: { result?: unknown[] } };
      const found = held.data?.result ?? [];
      return found.length > 0 ? found : null;
    },
    within,
  );

/** How far back a log read looks, which bounds Loki's query rather than the wait. */
const LOG_WINDOW_MINUTES = 10;

/** The log streams Loki holds for one query, once it holds any. */
export const streamsFromLoki = async (
  query: string,
  within = DEFAULT_PATIENCE,
): Promise<unknown[]> =>
  until(
    `the lines ${query} in Loki`,
    async () => {
      const since = Date.now() - LOG_WINDOW_MINUTES * 60 * 1000;
      const answered = await fetch(
        `${LOKI}/loki/api/v1/query_range?query=${encodeURIComponent(query)}&start=${since}000000`,
      );
      if (!answered.ok) return null;
      const held = (await answered.json()) as { data?: { result?: unknown[] } };
      const found = held.data?.result ?? [];
      return found.length > 0 ? found : null;
    },
    within,
  );
