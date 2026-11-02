import {
  type IntervalHistogram,
  monitorEventLoopDelay,
  PerformanceObserver,
} from 'node:perf_hooks';
import { recordMeasurement } from './results.js';

/**
 * Timing, for the report: how long operations took, how long the thread
 * was blocked, and how long garbage collection paused it.
 */

/** The most samples kept for one kind of operation, however many calls are timed. */
const KEPT_SAMPLE_COUNT = 10_000;

/**
 * Samples of how long one kind of operation took, in milliseconds. Past a
 * fixed number it keeps a uniform random sample, so timing a soak's millions
 * of calls holds the same memory as timing a hundred; the count and the
 * slowest are kept exactly.
 */
export class LatencySamples {
  readonly #keptSamplesMs: number[] = [];
  #count = 0;
  #slowestMs = 0;

  /** Times one call, answering what it answered. */
  async time<Answer>(call: () => Answer): Promise<Awaited<Answer>> {
    const startedAt = process.hrtime.bigint();
    try {
      return await call();
    } finally {
      this.add(Number(process.hrtime.bigint() - startedAt) / 1e6);
    }
  }

  /** Adds one sample taken elsewhere. */
  add(sampleMs: number): void {
    this.#count += 1;
    if (sampleMs > this.#slowestMs) this.#slowestMs = sampleMs;
    if (this.#keptSamplesMs.length < KEPT_SAMPLE_COUNT) {
      this.#keptSamplesMs.push(sampleMs);
      return;
    }
    // each of the samples so far stays kept with the same chance
    const replacedPosition = Math.floor(Math.random() * this.#count);
    if (replacedPosition < KEPT_SAMPLE_COUNT) {
      this.#keptSamplesMs[replacedPosition] = sampleMs;
    }
  }

  /** How many calls were timed. */
  get count(): number {
    return this.#count;
  }

  /** The value below which `share` of samples fall; the slowest exactly at one. */
  percentile(share: number): number {
    if (this.#count === 0) return 0;
    if (share >= 1) return this.#slowestMs;
    const sorted = [...this.#keptSamplesMs].sort(
      (first, second) => first - second,
    );
    return (
      sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ??
      0
    );
  }

  /** Writes the typical, slowest-one-percent and slowest time to the report. */
  report(check: string, name: string): void {
    if (this.count === 0) return;
    recordMeasurement({
      check,
      name: `${name} p50`,
      value: this.percentile(0.5),
      unit: 'ms',
    });
    recordMeasurement({
      check,
      name: `${name} p99`,
      value: this.percentile(0.99),
      unit: 'ms',
    });
    recordMeasurement({
      check,
      name: `${name} max`,
      value: this.percentile(1),
      unit: 'ms',
    });
  }
}

/** Watches how long the thread was blocked and how long collection paused it, until stopped. */
export const watchThread = () => {
  const loopDelay: IntervalHistogram = monitorEventLoopDelay({
    resolution: 10,
  });
  loopDelay.enable();
  const pauses = new LatencySamples();
  const gcObserver = new PerformanceObserver((entryList) => {
    for (const entry of entryList.getEntries()) pauses.add(entry.duration);
  });
  gcObserver.observe({ entryTypes: ['gc'] });
  return {
    /** Stops watching and writes what was seen to the report. */
    report: (check: string): void => {
      loopDelay.disable();
      gcObserver.disconnect();
      recordMeasurement({
        check,
        name: 'thread blocked p99',
        value: loopDelay.percentile(99) / 1e6,
        unit: 'ms',
      });
      recordMeasurement({
        check,
        name: 'thread blocked max',
        value: loopDelay.max / 1e6,
        unit: 'ms',
      });
      recordMeasurement({
        check,
        name: 'gc pauses',
        value: pauses.count,
        unit: 'pauses',
      });
      if (pauses.count > 0) {
        recordMeasurement({
          check,
          name: 'gc pause max',
          value: pauses.percentile(1),
          unit: 'ms',
        });
      }
    },
  };
};
