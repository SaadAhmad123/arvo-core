import { describe, expect, it } from 'vitest';
import {
  refuseMiscategorised,
  refuseMismatchedPresence,
  refuseWithdrawnVersion,
} from '../../src/ArvoEventHandler/gate.js';
import { cloneArvoEvent } from '../../src/factories/cloneArvoEvent.js';
import type { JSONObject } from '../../src/types.js';
import {
  chargedEvent,
  initEvent,
  orderVersion,
  paymentVersion,
} from './fixtures.js';

const openingEntry = {
  entry: 'init',
  version: '1.0.0',
  contract: orderVersion,
} as const;
const answeringEntry = {
  entry: 'followup',
  version: '1.0.0',
  contract: paymentVersion,
} as const;

describe('an event stating what it is', () => {
  it('accepts one opening an execution that states so', () => {
    const event = cloneArvoEvent(initEvent, { category: 'io.arvo.init' });
    expect(refuseMiscategorised(openingEntry, event)).toBeNull();
  });

  it('accepts one answering an execution that states so', () => {
    expect(refuseMiscategorised(answeringEntry, chargedEvent)).toBeNull();
  });

  it('refuses one opening an execution that states it completes one', () => {
    const event = cloneArvoEvent(initEvent, {
      category: 'io.arvo.complete',
      initid: 'a-request-somewhere-else',
    });
    expect(refuseMiscategorised(openingEntry, event)?.faultKind).toBe(
      'category_mismatch',
    );
  });

  it('refuses one answering an execution that states it opens one', () => {
    const event = cloneArvoEvent(chargedEvent, { category: 'io.arvo.init' });
    expect(refuseMiscategorised(answeringEntry, event)?.faultKind).toBe(
      'category_mismatch',
    );
  });

  it('does not consult one stating nothing', () => {
    // a factory builds an opening event without one, there being nothing
    // for it to corroborate
    expect(initEvent.category).toBeNull();
    expect(refuseMiscategorised(openingEntry, initEvent)).toBeNull();
  });

  it('does not consult one stating something it has no meaning for', () => {
    const event = cloneArvoEvent(initEvent, { category: 'something.else' });
    expect(refuseMiscategorised(openingEntry, event)).toBeNull();
  });

  it('says which it should have been, so the disagreement is readable', () => {
    const event = cloneArvoEvent(chargedEvent, { category: 'io.arvo.init' });
    expect(
      refuseMiscategorised(answeringEntry, event)?.violations[0],
    ).toContain('io.arvo.complete');
  });
});

describe('what the store held against what the event claims', () => {
  const storedRow = {} as JSONObject;

  it('accepts an opening event where nothing is stored', () => {
    expect(
      refuseMismatchedPresence(openingEntry, 'an-execution', null),
    ).toBeNull();
  });

  it('refuses an opening event where something is', () => {
    expect(
      refuseMismatchedPresence(openingEntry, 'an-execution', storedRow)
        ?.faultKind,
    ).toBe('record_unexpected');
  });

  it('accepts an answering event where something is stored', () => {
    expect(
      refuseMismatchedPresence(answeringEntry, 'an-execution', storedRow),
    ).toBeNull();
  });

  it('refuses an answering event where nothing is', () => {
    expect(
      refuseMismatchedPresence(answeringEntry, 'an-execution', null)?.faultKind,
    ).toBe('record_expected');
  });

  it('names the execution it looked under', () => {
    expect(
      refuseMismatchedPresence(answeringEntry, 'an-execution', null)?.message,
    ).toContain('an-execution');
  });
});

describe('an execution at a version the handler still runs', () => {
  const declaredVersions = new Set(['1.0.0', '1.1.0']);

  it('is accepted', () => {
    expect(
      refuseWithdrawnVersion(declaredVersions, '1.0.0', 'com_order'),
    ).toBeNull();
  });

  it('is refused where the version has gone', () => {
    expect(
      refuseWithdrawnVersion(declaredVersions, '0.9.0', 'com_order')?.faultKind,
    ).toBe('version_not_declared');
  });

  it('says which versions are left, so the gap is visible', () => {
    const refusal = refuseWithdrawnVersion(
      declaredVersions,
      '0.9.0',
      'com_order',
    );
    expect(refusal?.violations[0]).toContain('1.0.0');
    expect(refusal?.violations[0]).toContain('1.1.0');
  });

  it('names the contract and the version it was stranded at', () => {
    expect(
      refuseWithdrawnVersion(declaredVersions, '0.9.0', 'com_order')?.message,
    ).toContain('com_order@0.9.0');
  });
});
