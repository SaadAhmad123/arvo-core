import { describe, expect, it } from 'vitest';
import {
  deriveArvoExecutionId,
  isArvoExecutionId,
} from '../../../src/ArvoEventHandler/helpers/execution-id.js';
import { cloneArvoEvent } from '../../../src/factories/cloneArvoEvent.js';
import { chargedEvent, initEvent } from '../fixtures.js';

describe('the identifier an init event opens an execution under', () => {
  it('is 64 lowercase hex characters, with no prefix or separator', async () => {
    expect(await deriveArvoExecutionId(initEvent)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is the same every time, so a redelivery resolves to the same execution', async () => {
    const once = await deriveArvoExecutionId(initEvent);
    const again = await deriveArvoExecutionId(initEvent);
    expect(again).toBe(once);
  });

  it('turns only on the id and the dataschema, nothing else about the event', async () => {
    const copy = cloneArvoEvent(initEvent, {
      subject: 'a-different-workflow',
      executionid: 'a-different-workflow',
    });
    expect(await deriveArvoExecutionId(copy)).toBe(
      await deriveArvoExecutionId(initEvent),
    );
  });

  it('differs where the event id differs', async () => {
    const other = cloneArvoEvent(initEvent, { id: 'a-different-event' });
    expect(await deriveArvoExecutionId(other)).not.toBe(
      await deriveArvoExecutionId(initEvent),
    );
  });

  it('differs where the contract or version differs', async () => {
    const other = cloneArvoEvent(initEvent, {
      dataschema: '#/com/order/create/1.1.0',
    });
    expect(await deriveArvoExecutionId(other)).not.toBe(
      await deriveArvoExecutionId(initEvent),
    );
  });

  it('is a known answer, pinned so no implementation drifts from it', async () => {
    // SHA-256 over utf8('#/com/order/create/1.0.0') + 0x00 + utf8('fixed-id'),
    // computed with node:crypto rather than by this code.
    const fixed = cloneArvoEvent(initEvent, {
      id: 'fixed-id',
      dataschema: '#/com/order/create/1.0.0',
    });
    expect(await deriveArvoExecutionId(fixed)).toBe(
      '04cb04d634dac9b7cefdbca70de6cfb5be077b66117c4d21d045b96d5b3c31bd',
    );
  });

  it('cannot be confused by the delimiter, it being a byte neither input holds', async () => {
    // A split that would collide were the two simply concatenated.
    const left = cloneArvoEvent(initEvent, {
      dataschema: '#/com/a/1.0.0',
      id: 'bc',
    });
    const right = cloneArvoEvent(initEvent, {
      dataschema: '#/com/a/1.0.0b',
      id: 'c',
    });
    expect(await deriveArvoExecutionId(left)).not.toBe(
      await deriveArvoExecutionId(right),
    );
  });

  it('derives one for any event, the caller deciding which opens an execution', async () => {
    expect(await deriveArvoExecutionId(chargedEvent)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('recognising one', () => {
  it('accepts what the derivation produces', async () => {
    expect(isArvoExecutionId(await deriveArvoExecutionId(initEvent))).toBe(
      true,
    );
  });

  it.each([
    ['nothing', undefined],
    ['something that is not a string', 1234],
    ['too few characters', 'a'.repeat(63)],
    ['too many', 'a'.repeat(65)],
    ['uppercase hex', 'A'.repeat(64)],
    ['something outside hex', 'g'.repeat(64)],
    ['a prefixed digest', `0x${'a'.repeat(62)}`],
  ])('refuses %s', (_label, value) => {
    expect(isArvoExecutionId(value)).toBe(false);
  });
});
