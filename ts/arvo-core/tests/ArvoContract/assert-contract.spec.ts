import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../src/ArvoContract/index.js';
import { ArvoEvent } from '../../src/ArvoEvent/index.js';

const contract = new ArvoContract({
  type: 'com_order_create',
  versions: {
    '1.0.0': {
      accepts: z.object({ items: z.array(z.string()) }),
      emits: { com_order_created: z.object({ order_id: z.string() }) },
    },
    '1.1.0': {
      accepts: z.object({ items: z.array(z.string()), tier: z.string() }),
      emits: {},
    },
  },
});

/** A contract whose identifier shares nothing with its type. */
const explicitUri = new ArvoContract({
  type: 'com_user_register',
  uri: '#/services/identity/user/registration',
  versions: {
    '1.0.0': { accepts: z.object({ email: z.string() }), emits: {} },
  },
});

const event = (
  type: string,
  data: Record<string, unknown>,
  dataschema: string,
) =>
  new ArvoEvent({
    source: 'com.test.suite',
    subject: 'order-1',
    type,
    dataschema,
    data,
  });

describe('a contract routes by the event dataschema', () => {
  it('takes the version from the event', () => {
    const asserted = contract.assert(
      event(
        'com_order_create',
        { items: ['a'], tier: 'express' },
        '#/com/order/create/1.1.0',
      ),
    );
    expect(asserted.version).toBe('1.1.0');
    expect(asserted.scope).toBe('accepts');
  });

  it('names the version it selected, not the others', () => {
    const asserted = contract.assert(
      event('com_order_create', { items: [] }, '#/com/order/create/1.0.0'),
    );
    expect(asserted.version).toBe('1.0.0');
  });

  it('rejects an event from another contract', () => {
    const attempt = contract.tryAssert(
      event('com_order_create', { items: [] }, '#/com/other/thing/1.0.0'),
    );
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error.issues[0]?.path).toBe('event.dataschema.uri');
  });

  it('rejects a version it does not declare, naming the ones it does', () => {
    const attempt = contract.tryAssert(
      event('com_order_create', { items: [] }, '#/com/order/create/2.0.0'),
    );
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    const issue = attempt.error.issues[0];
    expect(issue?.path).toBe('event.dataschema.version');
    expect(issue?.received).toBe('2.0.0');
    expect(issue?.message).toContain('1.0.0');
    expect(issue?.message).toContain('1.1.0');
    expect(issue?.isBlocking).toBe(true);
  });
});

describe('reading a dataschema', () => {
  it('rejects one with no separator', () => {
    const attempt = contract.tryAssert(
      event('com_order_create', { items: [] }, 'noseparator'),
    );
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error.issues[0]?.path).toBe('event.dataschema');
    expect(attempt.error.issues[0]?.received).toBe('noseparator');
  });

  it('rejects one whose version half is empty', () => {
    const attempt = contract.tryAssert(
      event('com_order_create', { items: [] }, '#/com/order/create/'),
    );
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error.issues[0]?.path).toBe('event.dataschema');
  });

  it('rejects one whose identifier half is empty', () => {
    const attempt = contract.tryAssert(
      event('com_order_create', { items: [] }, '/1.0.0'),
    );
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error.issues[0]?.path).toBe('event.dataschema');
  });

  it('treats a version-shaped word as an undeclared version, not a bad shape', () => {
    const attempt = contract.tryAssert(
      event('com_order_create', { items: [] }, '#/com/order/create/latest'),
    );
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error.issues[0]?.path).toBe('event.dataschema.version');
    expect(attempt.error.issues[0]?.received).toBe('latest');
  });

  it('cannot be handed a range at all, an event refusing to carry one', () => {
    expect(() =>
      event('com_order_create', { items: [] }, '#/com/order/create/^1.0.0'),
    ).toThrow(/URI-reference/);
  });

  it('reads an identifier containing separators whole', () => {
    const asserted = explicitUri.assert(
      event(
        'com_user_register',
        { email: 'a@b.c' },
        '#/services/identity/user/registration/1.0.0',
      ),
    );
    expect(asserted.version).toBe('1.0.0');
  });
});

describe('a contract and its version agree', () => {
  const cases: Array<[string, ArvoEvent]> = [
    [
      'a matching request',
      event('com_order_create', { items: ['a'] }, '#/com/order/create/1.0.0'),
    ],
    [
      'a matching emit',
      event(
        'com_order_created',
        { order_id: 'o-1' },
        '#/com/order/create/1.0.0',
      ),
    ],
    [
      'an unmatched type',
      event('com_order_cancelled', {}, '#/com/order/create/1.0.0'),
    ],
    [
      'a bad payload',
      event('com_order_create', { items: [1] }, '#/com/order/create/1.0.0'),
    ],
  ];

  it.each(cases)('agrees on %s', (_name, candidate) => {
    const viaContract = contract.tryAssert(candidate);
    const viaVersion = contract.versions['1.0.0'].tryAssert(candidate);
    expect(viaContract.ok).toBe(viaVersion.ok);
    if (viaContract.ok && viaVersion.ok) {
      expect(viaContract.value.scope).toBe(viaVersion.value.scope);
      expect(viaContract.value.version).toBe(viaVersion.value.version);
    }
  });

  it('never disagrees with the event it carries', () => {
    const asserted = contract.assert(
      event(
        'com_order_create',
        { items: [], tier: 'x' },
        '#/com/order/create/1.1.0',
      ),
    );
    expect(asserted.event.dataschema).toBe(
      `${contract.uri}/${asserted.version}`,
    );
  });
});
