import { statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { waitMs } from '../../../src/load/harness/builders.js';
import { recordMeasurement } from '../../../src/load/harness/results.js';
import type { LoadSubject } from '../../../src/load/harness/subjects.js';
import { runOrders } from './lattice-check.js';

/** The size of a file, or nothing where it is not there. */
const fileSizeMb = (filename: string): number => {
  try {
    return statSync(filename).size / 1024 / 1024;
  } catch {
    return 0;
  }
};

/** How fast a series of samples rises over its own span, as a share of its mean. */
const riseShare = (samples: readonly number[]): number => {
  if (samples.length < 3) return 0;
  const sampleCount = samples.length;
  const meanPosition = (sampleCount - 1) / 2;
  const meanValue =
    samples.reduce((total, sample) => total + sample, 0) / sampleCount;
  if (meanValue === 0) return 0;
  let covariance = 0;
  let variance = 0;
  for (const [position, sample] of samples.entries()) {
    covariance += (position - meanPosition) * (sample - meanValue);
    variance += (position - meanPosition) ** 2;
  }
  return ((covariance / variance) * (sampleCount - 1)) / meanValue;
};

/** The timers this process holds. */
const activeTimerCount = () =>
  process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout')
    .length;

/** Ordinary traffic, for a long time, watching for what keeps growing. */
export const describeSoak = (subject: LoadSubject): void => {
  describe(`${subject.name}: resources over time`, () => {
    it('levels off in memory and on disk under steady traffic, and leaves nothing behind once closed', async () => {
      const soakMinutes = Number(process.env.LOAD_SOAK_MINUTES ?? '60');
      const soakEndsAt = Date.now() + soakMinutes * 60 * 1000;
      const sampleEveryMs = Math.max(5000, (soakMinutes * 60 * 1000) / 40);
      const timersBefore = activeTimerCount();
      const opened = await subject.open({
        inmemory: {
          retentionMs: { seenEvents: 30_000, terminalStates: 60_000 },
        },
        sqlite: { retentionMs: { seenEvents: 30_000, terminalStates: 60_000 } },
      });
      const samples: {
        memoryMb: number;
        heapMb: number;
        fileMb: number;
        walMb: number;
        handles: number;
      }[] = [];
      let nextSampleAt = Date.now();
      let ordersAnswered = 0;
      try {
        while (Date.now() < soakEndsAt) {
          const outcome = await runOrders({
            subject: opened,
            orderCount: 10,
            width: 10,
            depth: 2,
            workerCount: 8,
          });
          ordersAnswered += outcome.answeredOrders;
          if (opened.deleteExpired !== null) opened.deleteExpired();
          if (Date.now() >= nextSampleAt) {
            const memory = process.memoryUsage();
            samples.push({
              memoryMb: memory.rss / 1024 / 1024,
              heapMb: memory.heapUsed / 1024 / 1024,
              fileMb:
                opened.filename === null ? 0 : fileSizeMb(opened.filename),
              walMb:
                opened.filename === null
                  ? 0
                  : fileSizeMb(`${opened.filename}-wal`),
              handles: process.getActiveResourcesInfo().length,
            });
            nextSampleAt += sampleEveryMs;
          }
          await waitMs(50);
        }
      } finally {
        await opened.close();
      }
      await waitMs(100);
      recordMeasurement({
        check: 'soak',
        name: 'orders answered',
        value: ordersAnswered,
        unit: 'orders',
      });
      for (const [sampleNumber, sample] of samples.entries()) {
        recordMeasurement({
          check: 'soak',
          name: `sample ${String(sampleNumber).padStart(2, '0')} memory`,
          value: sample.memoryMb,
          unit: 'MB',
        });
        if (sample.fileMb > 0) {
          recordMeasurement({
            check: 'soak',
            name: `sample ${String(sampleNumber).padStart(2, '0')} file`,
            value: sample.fileMb + sample.walMb,
            unit: 'MB',
          });
        }
      }
      // what still rises through the last quarter is still growing
      const lastQuarter = samples.slice(Math.floor((samples.length * 3) / 4));
      const heapRise = riseShare(lastQuarter.map((sample) => sample.heapMb));
      const fileRise = riseShare(
        lastQuarter.map((sample) => sample.fileMb + sample.walMb),
      );
      const handleRise = riseShare(lastQuarter.map((sample) => sample.handles));
      recordMeasurement({
        check: 'soak',
        name: 'heap rise in the last quarter',
        value: heapRise * 100,
        unit: '%',
      });
      recordMeasurement({
        check: 'soak',
        name: 'file rise in the last quarter',
        value: fileRise * 100,
        unit: '%',
      });
      expect(samples.length).toBeGreaterThanOrEqual(4);
      expect(heapRise, JSON.stringify(lastQuarter)).toBeLessThan(0.25);
      expect(fileRise, JSON.stringify(lastQuarter)).toBeLessThan(0.25);
      expect(handleRise, JSON.stringify(lastQuarter)).toBeLessThan(0.25);
      expect(activeTimerCount()).toBe(timersBefore);
    });
  });
};
