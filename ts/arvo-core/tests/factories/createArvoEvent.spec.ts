import { describe, expect, it } from 'vitest';
import { ArvoEventValidationError } from '../../src/ArvoEvent/errors.js';
import {
  createArvoEvent,
  tryCreateArvoEvent,
} from '../../src/factories/createArvoEvent.js';

/** The four fields nothing but a caller can supply. */
const requiredFields = {
  type: 'com_order_create',
  source: 'com.test.suite',
  dataschema: '#/com/order/create/1.0.0',
  data: { items: ['book'] },
};

describe('an event from its fields', () => {
  it('builds from the four required fields alone', () => {
    const event = createArvoEvent(requiredFields);
    expect(event.type).toBe('com_order_create');
    expect(event.source).toBe('com.test.suite');
    expect(event.dataschema).toBe('#/com/order/create/1.0.0');
    expect(event.data).toEqual({ items: ['book'] });
  });

  it('starts each event in an execution of its own', () => {
    expect(createArvoEvent(requiredFields).subject).not.toBe(
      createArvoEvent(requiredFields).subject,
    );
  });

  it('keeps a supplied subject', () => {
    expect(
      createArvoEvent({ ...requiredFields, subject: 'order-42' }).subject,
    ).toBe('order-42');
  });

  it('generates one where a subject is given as undefined', () => {
    // A caller building the param object computes some fields, so a key
    // present and undefined is how "I have no subject" arrives. It means the
    // same as omitting it, rather than defeating the default.
    expect(
      createArvoEvent({ ...requiredFields, subject: undefined }).subject,
    ).toBeTypeOf('string');
    expect(
      createArvoEvent({ ...requiredFields, subject: undefined }).subject,
    ).not.toBe(
      createArvoEvent({ ...requiredFields, subject: undefined }).subject,
    );
  });

  it('defaults every other field as the constructor does', () => {
    const event = createArvoEvent(requiredFields);
    expect(event.executionid).toBe(event.subject);
    expect(event.depth).toBe(0);
    expect(event.parentid).toBeNull();
    expect(event.to).toBeNull();
    expect(event.domain).toBeNull();
    expect(event.baggage).toEqual({});
  });

  it('reports a missing required field', () => {
    const createResult = tryCreateArvoEvent({
      ...requiredFields,
      source: undefined,
    } as unknown as typeof requiredFields);
    expect(createResult.ok).toBe(false);
    if (createResult.ok) return;
    expect(
      createResult.error.issues.some((issue) => issue.path === 'source'),
    ).toBe(true);
  });

  it('reports a structural rule the same way the constructor would', () => {
    const createResult = tryCreateArvoEvent({ ...requiredFields, to: '' });
    expect(createResult.ok).toBe(false);
    if (createResult.ok) return;
    expect(createResult.error).toBeInstanceOf(ArvoEventValidationError);
    expect(createResult.error.issues[0]?.path).toBe('to');
  });

  it('lets an unexpected failure through rather than reporting it', () => {
    // The error channel claims a specific kind of failure. A hostile input
    // makes the spread itself throw, which is not an invalid event, so it
    // goes up as it arrived rather than being dressed as one.
    const hostileFields = new Proxy(requiredFields, {
      ownKeys() {
        throw new TypeError('boom');
      },
    });

    expect(() => tryCreateArvoEvent(hostileFields)).toThrow(TypeError);
    expect(() => tryCreateArvoEvent(hostileFields)).not.toThrow(
      ArvoEventValidationError,
    );
  });

  it('throws from the throwing form what the other reports', () => {
    const createResult = tryCreateArvoEvent({ ...requiredFields, to: '' });
    if (createResult.ok) throw new Error('expected a failure');
    expect(() => createArvoEvent({ ...requiredFields, to: '' })).toThrow(
      createResult.error.message,
    );
  });
});
