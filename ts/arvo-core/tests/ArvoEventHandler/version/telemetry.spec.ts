import { SpanStatusCode } from '@opentelemetry/api';
import { describe, expect, it, vi } from 'vitest';
import {
  describeExecution,
  markExecutorRan,
  markOutcome,
  markStage,
} from '../../../src/ArvoEventHandler/version/telemetry.js';
import { initEvent, orderVersion, telemetry } from '../fixtures.js';
import { buildState } from '../state/fixtures.js';

/** A telemetry object whose span and meter record what they were told. */
const recorded = () => {
  const built = telemetry();
  return {
    ...built,
    attributes: vi.spyOn(built.span, 'setAttributes'),
    events: vi.spyOn(built.span, 'addEvent'),
    status: vi.spyOn(built.span, 'setStatus'),
    counted: vi.spyOn(built.telemetry.metric, 'count'),
    measured: vi.spyOn(built.telemetry.metric, 'record'),
  };
};

describe('what the span says this execution is', () => {
  it('names the execution a reader would go looking for', () => {
    const written = recorded();
    describeExecution(written.telemetry, {
      state: buildState(),
      entry: 'followup',
      attempt: 2,
    });

    expect(written.attributes).toHaveBeenCalledWith(
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
    const written = recorded();
    markStage(written.telemetry, 'executor_entered');
    expect(written.events).toHaveBeenCalledWith(
      'arvo.stage.executor_entered',
      undefined,
    );
  });

  it('marks one with whatever is worth knowing about it', () => {
    const written = recorded();
    markStage(written.telemetry, 'returns_judged', { 'batch.size': 2 });
    expect(written.events).toHaveBeenCalledWith('arvo.stage.returns_judged', {
      'batch.size': 2,
    });
  });

  it('times the executor alone, apart from the protocol around it', () => {
    const written = recorded();
    markExecutorRan(written.telemetry, orderVersion, 42);
    expect(written.measured).toHaveBeenCalledWith('executor.duration', 42, {
      'contract.type': orderVersion.type,
      'contract.version': '1.0.0',
    });
  });
});

describe('what the span says this execution came to', () => {
  it('counts an execution that produced something, and says the span is ok', () => {
    const written = recorded();
    markOutcome(written.telemetry, {
      outcome: 'produced',
      self: orderVersion,
      emitted: 2,
      lifecycle: 'success',
    });

    expect(written.counted).toHaveBeenCalledWith('executions', {
      outcome: 'produced',
      lifecycle: 'success',
      'contract.type': orderVersion.type,
      'contract.version': '1.0.0',
    });
    expect(written.status).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
  });

  it('says how many events are leaving with it', () => {
    const written = recorded();
    markOutcome(written.telemetry, {
      outcome: 'produced',
      self: orderVersion,
      emitted: 2,
      lifecycle: 'waiting',
    });
    expect(written.attributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'arvo.emitted': 2,
        'arvo.lifecycle': 'waiting',
      }),
    );
  });

  it('counts one discarded as a duplicate, which is not a failure', () => {
    const written = recorded();
    markOutcome(written.telemetry, {
      outcome: 'discarded',
      self: orderVersion,
    });
    expect(written.counted).toHaveBeenCalledWith('executions', {
      outcome: 'discarded',
      lifecycle: 'none',
      'contract.type': orderVersion.type,
      'contract.version': '1.0.0',
    });
    expect(written.status).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
  });

  it('logs what it came to, a log outliving a sampling decision', () => {
    const written = recorded();
    markOutcome(written.telemetry, {
      outcome: 'produced',
      self: orderVersion,
      emitted: 1,
      lifecycle: 'success',
    });
    expect(written.emitted).toHaveLength(1);
    expect(written.emitted[0]?.body).toContain('success');
  });
});
