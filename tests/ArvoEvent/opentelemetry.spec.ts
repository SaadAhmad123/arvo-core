import type { Span, SpanContext } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { traceContextFromSpan } from '../../src/ArvoEvent/opentelemetry.js';

const spanContext = (overrides: Partial<SpanContext> = {}): SpanContext =>
  ({
    traceId: '0af7651916cd43dd8448eb211c80319c',
    spanId: 'b7ad6b7169203331',
    traceFlags: 1,
    ...overrides,
  }) as SpanContext;

describe('traceContextFromSpan', () => {
  describe('accepts either shape', () => {
    it('derives from a SpanContext passed directly', () => {
      expect(traceContextFromSpan(spanContext()).traceparent).toBe(
        '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      );
    });

    it('derives from a Span by calling spanContext()', () => {
      const span = { spanContext: () => spanContext() } as unknown as Span;
      expect(traceContextFromSpan(span).traceparent).toBe(
        '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      );
    });

    it('distinguishes the two by traceId being a string, not by duck-typing spanContext', () => {
      // A Span exposes spanContext(); a SpanContext exposes traceId. An object
      // carrying both must be read as the SpanContext it declares itself to be.
      const ambiguous = {
        ...spanContext({ traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
        spanContext: () =>
          spanContext({ traceId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }),
      } as unknown as SpanContext;
      expect(traceContextFromSpan(ambiguous).traceparent).toContain('aaaa');
    });
  });

  describe('traceFlags rendering', () => {
    it('pads a single hex digit to two', () => {
      expect(
        traceContextFromSpan(spanContext({ traceFlags: 1 })).traceparent,
      ).toMatch(/-01$/);
    });

    it('renders unsampled flags as 00', () => {
      expect(
        traceContextFromSpan(spanContext({ traceFlags: 0 })).traceparent,
      ).toMatch(/-00$/);
    });

    it('renders a two-digit value in hex without padding', () => {
      expect(
        traceContextFromSpan(spanContext({ traceFlags: 255 })).traceparent,
      ).toMatch(/-ff$/);
    });
  });

  describe('tracestate', () => {
    it('serializes a traceState when one is present', () => {
      const context = spanContext({
        traceState: { serialize: () => 'vendor=value' },
      } as Partial<SpanContext>);
      expect(traceContextFromSpan(context).tracestate).toBe('vendor=value');
    });

    it('is null when no traceState is present', () => {
      expect(traceContextFromSpan(spanContext()).tracestate).toBeNull();
    });

    it('is null when serialize returns an empty string, which carries no state', () => {
      const context = spanContext({
        traceState: { serialize: () => '' },
      } as Partial<SpanContext>);
      expect(traceContextFromSpan(context).tracestate).toBe('');
    });
  });
});
