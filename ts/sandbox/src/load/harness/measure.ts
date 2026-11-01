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

/** Samples of how long one kind of operation took, in milliseconds. */
export class LatencySamples {
  readonly #samplesMs: number[] = [];

  /** Times one call, answering what it answered. */
  async time<Answer>(call: () => Answer): Promise<Awaited<Answer>> {
    const startedAt = process.hrtime.bigint();
    try {
      return await call();
    } finally {
      this.#samplesMs.push(Number(process.hrtime.bigint() - startedAt) / 1e6);
    }
  }

  /** Adds one sample taken elsewhere. */
  add(sampleMs: number): void {
    this.#samplesMs.push(sampleMs);
  }

  /** How many calls were timed. */
  get count(): number {
    return this.#samplesMs.length;
  }

  /** The value below which `share` of samples fall. */
  percentile(share: number): number {
    if (this.#samplesMs.length === 0) return 0;
    const sorted = [...this.#samplesMs].sort((first, second) => first - second);
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
