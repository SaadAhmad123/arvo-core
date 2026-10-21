import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../src/ArvoContract/index.js';
import { ArvoEvent } from '../../src/ArvoEvent/index.js';

const contract = new ArvoContract({
  type: 'com_order_create',
  versions: {
    '1.0.0': {
      input: z.object({ items: z.array(z.string()) }),
      outputs: { com_order_created: z.object({ order_id: z.string() }) },
    },
    '1.1.0': {
      input: z.object({ items: z.array(z.string()), tier: z.string() }),
      outputs: {},
    },
  },
});

/** A contract whose identifier shares nothing with its type. */
const explicitUriContract = new ArvoContract({
  type: 'com_user_register',
  uri: '#/services/identity/user/registration',
  versions: {
    '1.0.0': { input: z.object({ email: z.string() }), outputs: {} },
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
    const assertedEvent = contract.assert(
      event(
        'com_order_create',
        { items: ['a'], tier: 'express' },
        '#/com/order/create/1.1.0',
      ),
    );
    expect(assertedEvent.version).toBe('1.1.0');
    expect(assertedEvent.scope).toBe('input');
  });

  it('names the version it selected, not the others', () => {
    const assertedEvent = contract.assert(
      event('com_order_create', { items: [] }, '#/com/order/create/1.0.0'),
    );
    expect(assertedEvent.version).toBe('1.0.0');
  });

  it('rejects an event from another contract', () => {
    const assertion = contract.tryAssert(
      event('com_order_create', { items: [] }, '#/com/other/thing/1.0.0'),
    );
    expect(assertion.ok).toBe(false);
    if (assertion.ok) return;
    expect(assertion.error.issues[0]?.path).toBe('event.dataschema.uri');
  });

  it('rejects a version it does not declare, naming the ones it does', () => {
    const assertion = contract.tryAssert(
      event('com_order_create', { items: [] }, '#/com/order/create/2.0.0'),
    );
    expect(assertion.ok).toBe(false);
    if (assertion.ok) return;
    const issue = assertion.error.issues[0];
    expect(issue?.path).toBe('event.dataschema.version');
    expect(issue?.received).toBe('2.0.0');
    expect(issue?.message).toContain('1.0.0');
    expect(issue?.message).toContain('1.1.0');
    expect(issue?.isBlocking).toBe(true);
  });
});

describe('reading a dataschema', () => {
  it('rejects one with no separator', () => {
    const assertion = contract.tryAssert(
      event('com_order_create', { items: [] }, 'noseparator'),
    );
    expect(assertion.ok).toBe(false);
    if (assertion.ok) return;
    expect(assertion.error.issues[0]?.path).toBe('event.dataschema');
    expect(assertion.error.issues[0]?.received).toBe('noseparator');
  });

  it('rejects one whose version half is empty', () => {
    const assertion = contract.tryAssert(
      event('com_order_create', { items: [] }, '#/com/order/create/'),
    );
    expect(assertion.ok).toBe(false);
    if (assertion.ok) return;
    expect(assertion.error.issues[0]?.path).toBe('event.dataschema');
  });

  it('rejects one whose identifier half is empty', () => {
    const assertion = contract.tryAssert(
      event('com_order_create', { items: [] }, '/1.0.0'),
    );
    expect(assertion.ok).toBe(false);
    if (assertion.ok) return;
    expect(assertion.error.issues[0]?.path).toBe('event.dataschema');
  });

  it('treats a version-shaped word as an undeclared version, not a bad shape', () => {
    const assertion = contract.tryAssert(
      event('com_order_create', { items: [] }, '#/com/order/create/latest'),
    );
    expect(assertion.ok).toBe(false);
    if (assertion.ok) return;
    expect(assertion.error.issues[0]?.path).toBe('event.dataschema.version');
    expect(assertion.error.issues[0]?.received).toBe('latest');
  });

  it('cannot be handed a range at all, an event refusing to carry one', () => {
    expect(() =>
      event('com_order_create', { items: [] }, '#/com/order/create/^1.0.0'),
    ).toThrow(/URI-reference/);
  });

  it('reads an identifier containing separators whole', () => {
    const assertedEvent = explicitUriContract.assert(
      event(
        'com_user_register',
        { email: 'a@b.c' },
        '#/services/identity/user/registration/1.0.0',
      ),
    );
    expect(assertedEvent.version).toBe('1.0.0');
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

  it.each(cases)('agrees on %s', (_name, candidateEvent) => {
    const contractAssertion = contract.tryAssert(candidateEvent);
    const versionAssertion =
      contract.versions['1.0.0'].tryAssert(candidateEvent);
    expect(contractAssertion.ok).toBe(versionAssertion.ok);
    if (contractAssertion.ok && versionAssertion.ok) {
      expect(contractAssertion.value.scope).toBe(versionAssertion.value.scope);
      expect(contractAssertion.value.version).toBe(
        versionAssertion.value.version,
      );
    }
  });

  it('never disagrees with the event it carries', () => {
    const assertedEvent = contract.assert(
      event(
        'com_order_create',
        { items: [], tier: 'x' },
        '#/com/order/create/1.1.0',
      ),
    );
    expect(assertedEvent.event.dataschema).toBe(
      `${contract.uri}/${assertedEvent.version}`,
    );
  });
});
