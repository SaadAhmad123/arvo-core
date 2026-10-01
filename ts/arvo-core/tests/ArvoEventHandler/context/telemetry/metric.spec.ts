import type { Counter, Histogram, Meter } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { ArvoExecutionContextMeter } from '../../../../src/ArvoEventHandler/context/telemetry/metric.js';

/** Everything a meter was asked for, and everything recorded on it. */
const spy = () => {
  const created: { kind: string; name: string; unit?: string }[] = [];
  const recorded: { name: string; value: number; attributes?: unknown }[] = [];
  const meter = {
    createCounter: (name: string, options?: { unit?: string }) => {
      created.push({ kind: 'counter', name, unit: options?.unit });
      return {
        add: (value: number, attributes?: unknown) =>
          recorded.push({ name, value, attributes }),
      } as Counter;
    },
    createHistogram: (name: string, options?: { unit?: string }) => {
      created.push({ kind: 'histogram', name, unit: options?.unit });
      return {
        record: (value: number, attributes?: unknown) =>
          recorded.push({ name, value, attributes }),
      } as Histogram;
    },
  } as unknown as Meter;
  return { meter, created, recorded };
};

describe("one delivery's metering", () => {
  it('carries the meter it was given', () => {
    const { meter } = spy();
    expect(new ArvoExecutionContextMeter({ meter }).meter).toBe(meter);
  });

  describe('a counter', () => {
    it('is created on the meter, under a prefixed name', () => {
      const watched = spy();
      new ArvoExecutionContextMeter({ meter: watched.meter }).counter(
        'charges',
      );
      expect(watched.created).toEqual([
        { kind: 'counter', name: 'arvo.charges', unit: undefined },
      ]);
    });

    it('carries the unit where one was given', () => {
      const watched = spy();
      new ArvoExecutionContextMeter({ meter: watched.meter }).counter(
        'bytes',
        'By',
      );
      expect(watched.created[0]?.unit).toBe('By');
    });

    it('is created once and reused, two with one name being a mistake', () => {
      const watched = spy();
      const metering = new ArvoExecutionContextMeter({ meter: watched.meter });
      const once = metering.counter('charges');
      expect(metering.counter('charges')).toBe(once);
      expect(watched.created).toHaveLength(1);
    });

    it('counts one occurrence through the shorthand', () => {
      const watched = spy();
      new ArvoExecutionContextMeter({ meter: watched.meter }).count('charges', {
        outcome: 'ok',
      });
      expect(watched.recorded).toEqual([
        { name: 'arvo.charges', value: 1, attributes: { outcome: 'ok' } },
      ]);
    });
  });

  describe('a histogram', () => {
    it('is created on the meter, under a prefixed name', () => {
      const watched = spy();
      new ArvoExecutionContextMeter({ meter: watched.meter }).histogram(
        'duration',
        'ms',
      );
      expect(watched.created).toEqual([
        { kind: 'histogram', name: 'arvo.duration', unit: 'ms' },
      ]);
    });

    it('is created once and reused', () => {
      const watched = spy();
      const metering = new ArvoExecutionContextMeter({ meter: watched.meter });
      const once = metering.histogram('duration');
      expect(metering.histogram('duration')).toBe(once);
      expect(watched.created).toHaveLength(1);
    });

    it('records one measurement through the shorthand', () => {
      const watched = spy();
      new ArvoExecutionContextMeter({ meter: watched.meter }).record(
        'duration',
        42,
      );
      expect(watched.recorded).toEqual([
        { name: 'arvo.duration', value: 42, attributes: undefined },
      ]);
    });
  });

  describe('where nothing is metering', () => {
    const metering = () => new ArvoExecutionContextMeter({ meter: null });

    it('still gives back a counter, so an executor needs no guard', () => {
      expect(() => metering().count('charges')).not.toThrow();
    });

    it('still gives back a histogram', () => {
      expect(() => metering().record('duration', 42)).not.toThrow();
    });

    it('reuses the one it gave, as a real meter would', () => {
      const none = metering();
      expect(none.counter('charges')).toBe(none.counter('charges'));
    });

    it('says it has no meter', () => {
      expect(metering().meter).toBeNull();
    });
  });
});
