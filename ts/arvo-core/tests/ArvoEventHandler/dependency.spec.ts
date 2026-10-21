import { describe, expect, it } from 'vitest';
import { heldDependencies, openedPerExecution } from './dependency.js';
import { initEvent, telemetry } from './fixtures.js';

/**
 * The two fixtures every other spec's dependencies rest on.
 *
 * Nothing checks that a supplied dependency is idempotent — the
 * protocol places that on whoever supplies one, and the handler keeps no
 * record of what it has already called. So the fixtures this suite
 * supplies everywhere have to be shown to hold it, or every spec using
 * one is resting on an assumption.
 */

/** A scope like the one a delivery is opened with. */
const aScope = () => ({
  event: initEvent,
  state: null,
  executionId: 'a'.repeat(64),
  attempt: 0,
  telemetry: telemetry().telemetry,
});

describe('a dependency that holds nothing', () => {
  it('hands over what it was given, as it stands', () => {
    const attributes = { note: 'given' };
    const { dependency } = heldDependencies(attributes);

    dependency.open(aScope());
    expect(dependency.attributes).toBe(attributes);
  });

  it('may be read before it is opened, because it holds nothing', () => {
    const { dependency } = heldDependencies({ note: 'given' });
    expect(() => dependency.attributes).not.toThrow();
  });

  it('survives being opened twice and closed twice', () => {
    const { dependency, calls } = heldDependencies({ note: 'given' });

    dependency.open(aScope());
    dependency.open(aScope());
    dependency.close(aScope());
    dependency.close(aScope());

    expect(calls.opened).toHaveLength(2);
    expect(calls.closed).toHaveLength(2);
    expect(dependency.attributes).toEqual({ note: 'given' });
  });

  it('survives being closed without ever having been opened', () => {
    const { dependency } = heldDependencies({ note: 'given' });
    expect(() => dependency.close(aScope())).not.toThrow();
  });
});

describe('a dependency that holds something', () => {
  it('builds what it holds on open, and is told what it is opening for', () => {
    const scope = aScope();
    const { dependency, calls } = openedPerExecution((openScope) => ({
      executionId: openScope.executionId,
    }));

    dependency.open(scope);

    expect(calls.opened[0]).toBe(scope);
    expect(dependency.attributes).toEqual({ executionId: scope.executionId });
  });

  it('refuses to be read before it is opened', () => {
    const { dependency } = openedPerExecution(() => ({ note: 'built' }));
    expect(() => dependency.attributes).toThrow(
      'these dependencies have not been opened',
    );
  });

  it('builds once however many times it is opened', () => {
    let buildCount = 0;
    const { dependency } = openedPerExecution(() => {
      buildCount += 1;
      return { built: buildCount };
    });

    dependency.open(aScope());
    dependency.open(aScope());

    expect(buildCount).toBe(1);
  });

  it('lets go on close, and may be closed again', () => {
    const { dependency } = openedPerExecution(() => ({ note: 'built' }));

    dependency.open(aScope());
    dependency.close(aScope());
    expect(() => dependency.close(aScope())).not.toThrow();
    expect(() => dependency.attributes).toThrow();
  });

  it('survives being closed without ever having been opened', () => {
    const { dependency } = openedPerExecution(() => ({ note: 'built' }));
    expect(() => dependency.close(aScope())).not.toThrow();
  });

  it('builds again after being closed, so one object serves two executions', () => {
    let buildCount = 0;
    const { dependency } = openedPerExecution(() => {
      buildCount += 1;
      return { built: buildCount };
    });

    dependency.open(aScope());
    dependency.close(aScope());
    dependency.open(aScope());

    expect(buildCount).toBe(2);
    expect(dependency.attributes).toEqual({ built: 2 });
  });
});
