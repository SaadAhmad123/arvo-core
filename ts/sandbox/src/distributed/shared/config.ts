import { z } from 'zod';

/**
 * Everything a worker needs to know, read from the environment and
 * judged before anything starts.
 *
 * A process that cannot be configured refuses to run rather than
 * running half-configured, because a worker that starts and then
 * cannot reach its store has already told a cluster it is ready.
 */

const configSchema = z.object({
  /** Where the Temporal cluster is. */
  temporalAddress: z.string().min(1),
  /** The namespace this run's workflows live in. */
  temporalNamespace: z.string().min(1),

  /** Where the execution records are kept. */
  recordsUrl: z.string().min(1),
  /** How many connections one worker may hold, so a leak shows as exhaustion. */
  recordsPoolSize: z.coerce.number().int().positive(),

  /** Where every signal is sent. One endpoint, whatever is behind it. */
  otlpEndpoint: z.string().min(1),

  /** What this process calls itself on every span, metric and log. */
  serviceName: z.string().min(1),
  /** Which build it is, so two of them can be told apart in a trace. */
  serviceVersion: z.string().min(1),

  /**
   * How many executions one worker runs at once.
   *
   * Bounded deliberately: a five-hundred-wide fan-out must make a run
   * slower rather than making it fall over.
   */
  concurrency: z.coerce.number().int().positive(),

  /** Where a worker answers whether it is alive and whether it can take work. */
  healthPort: z.coerce.number().int().positive(),
});

/** Everything a worker needs to know. */
export type DistributedConfig = z.infer<typeof configSchema>;

/** What each setting is where the environment says nothing. */
const DEFAULTS = {
  TEMPORAL_ADDRESS: 'localhost:7233',
  TEMPORAL_NAMESPACE: 'arvo',
  RECORDS_URL: 'postgresql://arvo:arvo@localhost:5433/arvo_records',
  RECORDS_POOL_SIZE: '16',
  OTLP_ENDPOINT: 'http://localhost:4317',
  SERVICE_VERSION: '0.0.0-sandbox',
  CONCURRENCY: '64',
  HEALTH_PORT: '9464',
} as const;

/**
 * This process's configuration, or a refusal to start.
 *
 * @param serviceName - What this process calls itself, which is the one
 * thing it cannot be told by its environment without two of them
 * becoming indistinguishable in a trace.
 * @throws Where anything is missing or outside what it accepts, naming
 * every setting at fault rather than the first.
 */
export const readConfig = (serviceName: string): DistributedConfig => {
  const read = configSchema.safeParse({
    temporalAddress: process.env.TEMPORAL_ADDRESS ?? DEFAULTS.TEMPORAL_ADDRESS,
    temporalNamespace:
      process.env.TEMPORAL_NAMESPACE ?? DEFAULTS.TEMPORAL_NAMESPACE,
    recordsUrl: process.env.RECORDS_URL ?? DEFAULTS.RECORDS_URL,
    recordsPoolSize:
      process.env.RECORDS_POOL_SIZE ?? DEFAULTS.RECORDS_POOL_SIZE,
    otlpEndpoint: process.env.OTLP_ENDPOINT ?? DEFAULTS.OTLP_ENDPOINT,
    serviceName,
    serviceVersion: process.env.SERVICE_VERSION ?? DEFAULTS.SERVICE_VERSION,
    concurrency: process.env.CONCURRENCY ?? DEFAULTS.CONCURRENCY,
    healthPort: process.env.HEALTH_PORT ?? DEFAULTS.HEALTH_PORT,
  });

  if (read.success) return read.data;

  const wrong = read.error.issues
    .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`this process cannot be configured:\n${wrong}`);
};
