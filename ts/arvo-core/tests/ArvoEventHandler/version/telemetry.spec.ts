import { SpanStatusCode } from '@opentelemetry/api';
import { describe, expect, it, vi } from 'vitest';
import {
  describeExecution,
  markCollection,
  markExecutorRan,
  markOutcome,
  markStage,
  markSwallowed,
} from '../../../src/ArvoEventHandler/version/telemetry.js';
import { initEvent, orderVersion, telemetry } from '../fixtures.js';
import { buildState } from '../state/fixtures.js';

/** A telemetry object whose span and meter record what they were told. */
const recordingTelemetry = () => {
  const telemetryFixture = telemetry();
  return {
    ...telemetryFixture,
    attributes: vi.spyOn(telemetryFixture.span, 'setAttributes'),
    events: vi.spyOn(telemetryFixture.span, 'addEvent'),
    status: vi.spyOn(telemetryFixture.span, 'setStatus'),
    counted: vi.spyOn(telemetryFixture.telemetry.metric, 'count'),
    measured: vi.spyOn(telemetryFixture.telemetry.metric, 'record'),
  };
};

describe('what the span says this execution is', () => {
  it('names the execution a reader would go looking for', () => {
    const recording = recordingTelemetry();
    describeExecution(recording.telemetry, {
      state: buildState(),
      entry: 'followup',
      attempt: 2,
    });

    expect(recording.attributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'arvo.subject': initEvent.subject,
        'arvo.execution.id': buildState().executionId,
        'arvo.contract.type': orderVersion.type,
        'arvo.contract.version': '1.0.0',
        'arvo.entry': 'followup',
        'arvo.attempt': 2,
        'arvo.depth': 3,
      }),
    );
  });
});

describe('what the span says this execution did', () => {
  it('marks a stage it reached', () => {
    const recording = recordingTelemetry();
    markStage(recording.telemetry, 'executor_entered');
    expect(recording.events).toHaveBeenCalledWith(
      'arvo.stage.executor_entered',
      undefined,
    );
  });

  it('marks one with whatever is worth knowing about it', () => {
    const recording = recordingTelemetry();
    markStage(recording.telemetry, 'returns_judged', { 'batch.size': 2 });
    expect(recording.events).toHaveBeenCalledWith('arvo.stage.returns_judged', {
      'batch.size': 2,
    });
  });

  it('times the executor alone, apart from the protocol around it', () => {
    const recording = recordingTelemetry();
    markExecutorRan(recording.telemetry, orderVersion, 42);
    expect(recording.measured).toHaveBeenCalledWith('executor.duration', 42, {
      'contract.type': orderVersion.type,
      'contract.version': '1.0.0',
    });
  });
});

describe('what the span says this execution came to', () => {
  it('counts an execution that produced something, and says the span is ok', () => {
    const recording = recordingTelemetry();
    markOutcome(recording.telemetry, {
      outcome: 'produced',
      self: orderVersion,
      emitted: 2,
      lifecycle: 'success',
    });

    expect(recording.counted).toHaveBeenCalledWith('executions', {
      outcome: 'produced',
      lifecycle: 'success',
      'contract.type': orderVersion.type,
      'contract.version': '1.0.0',
    });
    expect(recording.status).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
  });

  it('says how many events are leaving with it', () => {
    const recording = recordingTelemetry();
    markOutcome(recording.telemetry, {
      outcome: 'produced',
      self: orderVersion,
      emitted: 2,
      lifecycle: 'waiting',
    });
    expect(recording.attributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'arvo.emitted': 2,
        'arvo.lifecycle': 'waiting',
      }),
    );
  });

  it('counts one discarded as a duplicate, which is not a failure', () => {
    const recording = recordingTelemetry();
    markOutcome(recording.telemetry, {
      outcome: 'discarded',
      self: orderVersion,
    });
    expect(recording.counted).toHaveBeenCalledWith('executions', {
      outcome: 'discarded',
      lifecycle: 'none',
      'contract.type': orderVersion.type,
      'contract.version': '1.0.0',
    });
    expect(recording.status).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
  });

  it('logs what it came to, a log outliving a sampling decision', () => {
    const recording = recordingTelemetry();
    markOutcome(recording.telemetry, {
      outcome: 'produced',
      self: orderVersion,
      emitted: 1,
      lifecycle: 'success',
    });
    expect(recording.emitted).toHaveLength(1);
    expect(recording.emitted[0]?.body).toContain('success');
  });
});

describe('what the span says about a failure nothing acts on', () => {
  /**
   * A failure that is recorded and then carried on from. Releasing a
   * dependency is the case this exists for: it happens after the work
   * is done, and failing to do it changes nothing a caller is told —
   * so the span is the only place it is ever visible.
   */
  it('records what was swallowed and why', () => {
    const recording = recordingTelemetry();
    markSwallowed(
      recording.telemetry,
      'dependencies_not_closed',
      new Error('the pool had already gone'),
    );

    expect(recording.events).toHaveBeenCalledWith(
      'arvo.swallowed.dependencies_not_closed',
      { message: 'the pool had already gone' },
    );
  });

  it('records something raised that is not an error at all', () => {
    const recording = recordingTelemetry();
    markSwallowed(
      recording.telemetry,
      'dependencies_not_closed',
      'just a string',
    );

    expect(recording.events).toHaveBeenCalledWith(
      'arvo.swallowed.dependencies_not_closed',
      { message: 'just a string' },
    );
  });
});

describe('what the span says about the collection', () => {
  /**
   * ADR-006 asks for collection size among the protocol-level metrics
   * an implementation publishes. What makes it worth publishing is the
   * distribution — how wide do collections get — so it is a histogram
   * rather than a counter, and one observation per entry rather than one
   * per answer, which would record a collection of five hundred five
   * hundred times.
   */
  it('records how many things the execution is collecting', () => {
    const recording = recordingTelemetry();
    markCollection(recording.telemetry, orderVersion, 3);

    expect(recording.measured).toHaveBeenCalledWith(
      'collection.size',
      3,
      expect.objectContaining({
        'contract.type': orderVersion.type,
        'contract.version': '1.0.0',
      }),
    );
  });

  it('records a collection of none, an execution awaiting nothing being a real size', () => {
    const recording = recordingTelemetry();
    markCollection(recording.telemetry, orderVersion, 0);

    expect(recording.measured).toHaveBeenCalledWith(
      'collection.size',
      0,
      expect.anything(),
    );
  });
});
