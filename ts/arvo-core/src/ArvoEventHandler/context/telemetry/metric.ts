import type { Attributes, Counter, Histogram, Meter } from '@opentelemetry/api';
import { ARVO_TELEMETRY_PREFIX } from './prefix.js';
import { reading, recording } from './recording.js';

/** What a counter is where nothing is metering. */
const NO_OP_COUNTER: Counter = { add: () => undefined };

/** What a histogram is where nothing is metering. */
const NO_OP_HISTOGRAM: Histogram = { record: () => undefined };

import type { ArvoExecutionContextMeterParam } from './types.js';

/**
 * One execution's metering.
 *
 * Instruments are created once per name and reused, because creating two
 * with one name is a mistake every metrics backend reports differently.
 * Every name is prefixed, so one deployment's metrics stay together.
 *
 * Every instrument is a no-op where no meter was given, so an executor
 * recording a measurement never has to ask whether anything is metering.
 * A meter that refuses one is the same: the measurement is lost and the
 * execution is not.
 *
 * @example
 * ```typescript
 * const metric = new ArvoExecutionContextMeter({
 *   meter: metrics.getMeter('com_order_create', '1.0.0'),
 * });
 *
 * metric.counter('charges').add(1, { outcome: 'ok' });
 * metric.histogram('gateway.duration', 'ms').record(elapsed);
 * ```
 */
export class ArvoExecutionContextMeter {
  /** The meter instruments are created on, or `null` where none metres. */
  readonly meter: Meter | null;

  readonly #counters = new Map<string, Counter>();
  readonly #histograms = new Map<string, Histogram>();

  /** @param param - The meter to create instruments on. */
  constructor(param: ArvoExecutionContextMeterParam) {
    this.meter = param.meter;
  }

  /**
   * A counter, for something that only goes up.
   *
   * @param name - What is being counted, prefixed for you.
   * @param unit - What one of them is, where a unit means anything.
   */
  counter(name: string, unit?: string): Counter {
    const key = `${ARVO_TELEMETRY_PREFIX}${name}`;
    const found = this.#counters.get(key);
    if (found !== undefined) return found;
    const made =
      this.meter === null
        ? NO_OP_COUNTER
        : reading(
            () => (this.meter as Meter).createCounter(key, { unit }),
            NO_OP_COUNTER,
          );
    this.#counters.set(key, made);
    return made;
  }

  /**
   * A histogram, for a distribution of measurements.
   *
   * @param name - What is being measured, prefixed for you.
   * @param unit - What one measurement is in.
   */
  histogram(name: string, unit?: string): Histogram {
    const key = `${ARVO_TELEMETRY_PREFIX}${name}`;
    const found = this.#histograms.get(key);
    if (found !== undefined) return found;
    const made =
      this.meter === null
        ? NO_OP_HISTOGRAM
        : reading(
            () => (this.meter as Meter).createHistogram(key, { unit }),
            NO_OP_HISTOGRAM,
          );
    this.#histograms.set(key, made);
    return made;
  }

  /** One measurement recorded on a named histogram. */
  record(name: string, value: number, attributes?: Attributes): void {
    recording(() => this.histogram(name).record(value, attributes));
  }

  /** One occurrence counted on a named counter. */
  count(name: string, attributes?: Attributes): void {
    recording(() => this.counter(name).add(1, attributes));
  }
}
