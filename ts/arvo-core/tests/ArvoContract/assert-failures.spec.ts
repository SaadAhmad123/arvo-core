import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContractAssertionError } from '../../src/ArvoContract/errors.js';
import { ArvoContract } from '../../src/ArvoContract/index.js';
import { ArvoEvent } from '../../src/ArvoEvent/index.js';

const contract = new ArvoContract({
  type: 'com_order_create',
  versions: {
    '1.0.0': {
      accepts: z.object({ items: z.array(z.string()) }),
      emits: { com_order_created: z.object({ order_id: z.string() }) },
    },
    '1.1.0': { accepts: z.object({ items: z.array(z.string()) }), emits: {} },
  },
});

const v1 = contract.versions['1.0.0'];

const event = (
  type: string,
  data: Record<string, unknown>,
  dataschema = v1.dataschema,
) =>
  new ArvoEvent({
    source: 'com.test.suite',
    subject: 'order-1',
    type,
    dataschema,
    data,
  });

/** The issues of a failed assertion, or a failure if it succeeded. */
const issuesOf = (
  attempt: ReturnType<typeof v1.tryAssert>,
): readonly { path: string; isBlocking: boolean }[] => {
  if (attempt.ok) throw new Error('expected the assertion to fail');
  return attempt.error.issues;
};

/** Every prerequisite failure, by the position it must report. */
const prerequisites = {
  expectedType: () =>
    v1.tryAssert(
      event('com_order_create', { items: [] }),
      // @ts-expect-error not a type this version declares
      'com_order_shipped',
    ),
  'event.dataschema': () =>
    v1.tryAssert(event('com_order_create', { items: [] }, 'noseparator')),
  'event.dataschema.uri': () =>
    v1.tryAssert(
      event('com_order_create', { items: [] }, '#/com/other/thing/1.0.0'),
    ),
  'event.dataschema.version': () =>
    v1.tryAssert(
      event('com_order_create', { items: [] }, '#/com/order/create/1.1.0'),
    ),
  'event.type': () => v1.tryAssert(event('com_order_cancelled', {})),
} as const;

const positions = Object.keys(prerequisites) as Array<
  keyof typeof prerequisites
>;

describe('every prerequisite failure reports its own position', () => {
  it.each(positions)('reports %s', (position) => {
    const issues = issuesOf(prerequisites[position]());
    expect(issues[0]?.path).toBe(position);
  });

  it('reports five positions distinct from one another', () => {
    const reported = positions.map(
      (position) => issuesOf(prerequisites[position]())[0]?.path,
    );
    expect(new Set(reported).size).toBe(positions.length);
  });

  it.each(positions)('states that nothing after %s ran', (position) => {
    const issues = issuesOf(prerequisites[position]());
    expect(issues[0]?.isBlocking).toBe(true);
    expect(issues).toHaveLength(1);
  });
});

describe('the order the checks run in', () => {
  it('reports an unanswerable request before anything about the event', () => {
    const issues = issuesOf(
      v1.tryAssert(
        event('com_order_create', { items: [] }, '#/com/other/thing/1.0.0'),
        // @ts-expect-error not a type this version declares
        'com_order_shipped',
      ),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('expectedType');
  });

  it('reports a malformed dataschema before either of its halves', () => {
    const issues = issuesOf(
      v1.tryAssert(event('com_order_cancelled', {}, 'noseparator')),
    );
    expect(issues[0]?.path).toBe('event.dataschema');
  });

  it('reports a foreign identifier before an undeclared version', () => {
    const issues = issuesOf(
      v1.tryAssert(
        event('com_order_create', { items: [] }, '#/com/other/thing/9.9.9'),
      ),
    );
    expect(issues[0]?.path).toBe('event.dataschema.uri');
  });

  it('reports a wrong type before the payload', () => {
    const issues = issuesOf(
      v1.tryAssert(event('com_order_cancelled', { items: [1] })),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('event.type');
  });
});

describe('one error for the whole operation', () => {
  const everySituation = [
    ...positions.map(
      (position) => [position, prerequisites[position]] as const,
    ),
    [
      'event.data',
      () => v1.tryAssert(event('com_order_create', { items: [1] })),
    ] as const,
  ];

  it.each(everySituation)('arrives as one error for %s', (_position, run) => {
    const attempt = run();
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error).toBeInstanceOf(ArvoContractAssertionError);
    expect(attempt.error._tag).toBe('ArvoContractAssertionError');
  });

  it('arrives as the same error from a contract', () => {
    const attempt = contract.tryAssert(
      event('com_order_create', { items: [] }, '#/com/order/create/2.0.0'),
    );
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error).toBeInstanceOf(ArvoContractAssertionError);
  });

  it('never claims the contract is invalid', () => {
    const attempt = v1.tryAssert(
      event('com_order_create', { items: [] }),
      // @ts-expect-error not a type this version declares
      'com_order_shipped',
    );
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error.message).not.toContain('not valid');
    expect(attempt.error.message).toContain('does not satisfy the contract');
  });

  it('separates a bad expectation from a bad event by position alone', () => {
    const mine = issuesOf(
      v1.tryAssert(
        event('com_order_create', { items: [] }),
        // @ts-expect-error not a type this version declares
        'com_order_shipped',
      ),
    );
    const theirs = issuesOf(v1.tryAssert(event('com_order_cancelled', {})));
    expect(mine[0]?.path).toBe('expectedType');
    expect(theirs[0]?.path.startsWith('event.')).toBe(true);
  });

  it('throws that same error from the throwing companion', () => {
    expect(() => v1.assert(event('com_order_cancelled', {}))).toThrow(
      ArvoContractAssertionError,
    );
    expect(() =>
      contract.assert(
        event('com_order_create', { items: [] }, '#/com/order/create/2.0.0'),
      ),
    ).toThrow(ArvoContractAssertionError);
  });
});
