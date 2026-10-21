import type { Counter, Histogram, Meter } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { ArvoExecutionContextMeter } from '../../../../src/ArvoEventHandler/context/telemetry/metric.js';

/** Everything a meter was asked for, and everything recorded on it. */
const spyMeter = () => {
  const createdInstruments: { kind: string; name: string; unit?: string }[] =
    [];
  const measurements: { name: string; value: number; attributes?: unknown }[] =
    [];
  const meter = {
    createCounter: (instrumentName: string, options?: { unit?: string }) => {
      createdInstruments.push({
        kind: 'counter',
        name: instrumentName,
        unit: options?.unit,
      });
      return {
        add: (amount: number, attributes?: unknown) =>
          measurements.push({
            name: instrumentName,
            value: amount,
            attributes,
          }),
      } as Counter;
    },
    createHistogram: (instrumentName: string, options?: { unit?: string }) => {
      createdInstruments.push({
        kind: 'histogram',
        name: instrumentName,
        unit: options?.unit,
      });
      return {
        record: (amount: number, attributes?: unknown) =>
          measurements.push({
            name: instrumentName,
            value: amount,
            attributes,
          }),
      } as Histogram;
    },
  } as unknown as Meter;
  return { meter, createdInstruments, measurements };
};

describe("one execution's metering", () => {
  it('carries the meter it was given', () => {
    const { meter } = spyMeter();
    expect(new ArvoExecutionContextMeter({ meter }).meter).toBe(meter);
  });

  describe('a counter', () => {
    it('is created on the meter, under a prefixed name', () => {
      const meterCalls = spyMeter();
      new ArvoExecutionContextMeter({ meter: meterCalls.meter }).counter(
        'charges',
      );
      expect(meterCalls.createdInstruments).toEqual([
        { kind: 'counter', name: 'arvo.charges', unit: undefined },
      ]);
    });

    it('carries the unit where one was given', () => {
      const meterCalls = spyMeter();
      new ArvoExecutionContextMeter({ meter: meterCalls.meter }).counter(
        'bytes',
        'By',
      );
      expect(meterCalls.createdInstruments[0]?.unit).toBe('By');
    });

    it('is created once and reused, two with one name being a mistake', () => {
      const meterCalls = spyMeter();
      const metering = new ArvoExecutionContextMeter({
        meter: meterCalls.meter,
      });
      const counter = metering.counter('charges');
      expect(metering.counter('charges')).toBe(counter);
      expect(meterCalls.createdInstruments).toHaveLength(1);
    });

    it('counts one occurrence through the shorthand', () => {
      const meterCalls = spyMeter();
      new ArvoExecutionContextMeter({ meter: meterCalls.meter }).count(
        'charges',
        {
          outcome: 'ok',
        },
      );
      expect(meterCalls.measurements).toEqual([
        { name: 'arvo.charges', value: 1, attributes: { outcome: 'ok' } },
      ]);
    });
  });

  describe('a histogram', () => {
    it('is created on the meter, under a prefixed name', () => {
      const meterCalls = spyMeter();
      new ArvoExecutionContextMeter({ meter: meterCalls.meter }).histogram(
        'duration',
        'ms',
      );
      expect(meterCalls.createdInstruments).toEqual([
        { kind: 'histogram', name: 'arvo.duration', unit: 'ms' },
      ]);
    });

    it('is created once and reused', () => {
      const meterCalls = spyMeter();
      const metering = new ArvoExecutionContextMeter({
        meter: meterCalls.meter,
      });
      const histogram = metering.histogram('duration');
      expect(metering.histogram('duration')).toBe(histogram);
      expect(meterCalls.createdInstruments).toHaveLength(1);
    });

    it('records one measurement through the shorthand', () => {
      const meterCalls = spyMeter();
      new ArvoExecutionContextMeter({ meter: meterCalls.meter }).record(
        'duration',
        42,
      );
      expect(meterCalls.measurements).toEqual([
        { name: 'arvo.duration', value: 42, attributes: undefined },
      ]);
    });
  });

  describe('where nothing is metering', () => {
    const nullMetering = () => new ArvoExecutionContextMeter({ meter: null });

    it('still gives back a counter, so an executor needs no guard', () => {
      expect(() => nullMetering().count('charges')).not.toThrow();
    });

    it('still gives back a histogram', () => {
      expect(() => nullMetering().record('duration', 42)).not.toThrow();
    });

    it('reuses the one it gave, as a real meter would', () => {
      const nullMeter = nullMetering();
      expect(nullMeter.counter('charges')).toBe(nullMeter.counter('charges'));
    });

    it('says it has no meter', () => {
      expect(nullMetering().meter).toBeNull();
    });
  });
});
