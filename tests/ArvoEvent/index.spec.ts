import { ArvoDataContentType, ArvoEvent, OTelNull, createArvoEvent } from '../../src';
import { parseArvoEventId } from '../../src/ArvoEvent/id';
import { telemetrySdkStart, telemetrySdkStop } from '../utils';

describe('ArvoEvent', () => {
  beforeAll(() => {
    telemetrySdkStart();
  });

  afterAll(() => {
    telemetrySdkStop();
  });

  const baseEvent = {
    source: 'test.producer',
    type: 'cmd.saad.test',
    subject: 'test.json',
    data: { message: 'Hello, World!' },
    to: 'worker',
  };

  it('Should use the "type" field in case "to" is not provided', () => {
    const event = createArvoEvent({
      source: 'test.producer',
      type: 'cmd.saad.test',
      subject: 'test.json',
      data: { message: 'Hello, World!' },
    });

    expect(event.to).toBe(event.type);
  });

  it('should output a warning when non Arvo datacontenttype is used', () => {
    const event = createArvoEvent({
      source: 'test.producer',
      type: 'cmd.saad.test',
      subject: 'test.json',
      datacontenttype: 'application/json',
      data: { message: 'Hello, World!' },
    });

    expect(event).toBeTruthy();
  });

  it('should create a valid ArvoEvent with minimal required fields', () => {
    const event = createArvoEvent(baseEvent);

    expect(event).toBeInstanceOf(ArvoEvent);

    if (event) {
      expect(event.source).toBe('test.producer');
      expect(event.type).toBe('cmd.saad.test');
      expect(event.subject).toBe('test.json');
      expect(event.data).toEqual({ message: 'Hello, World!' });
      expect(event.datacontenttype).toBe(ArvoDataContentType);
      expect(event.specversion).toBe('1.0');
      expect(event.id).toBeTruthy();
      expect(event.time).toBeTruthy();
    }
  });

  it('should use provided developer managed id and time if given', () => {
    const event = createArvoEvent({
      ...baseEvent,
      id: {
        deduplication: 'DEVELOPER_MANAGED',
        value: 'custom-id',
      },
      time: '2023-05-01T12:00:00Z',
    });

    expect(event.id).toBe('custom-id');
    expect(event.time).toBe('2023-05-01T12:00:00Z');
  });

  it('should use provided arvo managed id and time if given', () => {
    const event = createArvoEvent({
      ...baseEvent,
      id: {
        deduplication: 'ARVO_MANAGED',
        value: 'custom-id',
      },
      time: '2023-05-01T12:00:00Z',
    });

    const result = parseArvoEventId(event.id);
    expect(Boolean(result[1])).toBe(false);
    if (result[1]) return;

    expect(result[0].value).toBe('custom-id');
    expect(event.time).toBe('2023-05-01T12:00:00Z');
  });

  it('should handle custom extensions', () => {
    const customExtensions = {
      customfield: 'custom-value',
    };

    const event = createArvoEvent(baseEvent, customExtensions);
    expect(event.extensions.customfield).toBe('custom-value');
  });

  it('should handle Arvo-specific extensions', () => {
    const eventWithArvoExtensions = {
      ...baseEvent,
      to: 'recipient',
      accesscontrol: 'public',
      redirectto: 'redirect-url',
      executionunits: 5,
    };

    const event = createArvoEvent(eventWithArvoExtensions);

    expect(event.to).toBe('recipient');
    expect(event.accesscontrol).toBe('public');
    expect(event.redirectto).toBe('redirect-url');
    expect(event.executionunits).toBe(5);
  });

  it('should handle OpenTelemetry extensions', () => {
    const eventWithOTelExtensions = {
      ...baseEvent,
      traceparent: 'traceparent-value',
      tracestate: 'tracestate-value',
    };

    const event = createArvoEvent(eventWithOTelExtensions);

    expect(event.traceparent).toBe('traceparent-value');
    expect(event.tracestate).toBe('tracestate-value');
  });

  it('should return errors when invalid data is provided', () => {
    const invalidEvent = {
      ...baseEvent,
      data: { invalidField: Symbol('invalid') }, // Symbols are not valid JSON
    };

    let event: ArvoEvent | undefined;
    let error: Error | undefined;
    try {
      event = createArvoEvent(invalidEvent);
    } catch (e) {
      error = e as Error;
    }

    expect(event).toBeFalsy();
    expect(error).toBeTruthy();
  });

  it('should encode URI components for certain fields and allow ArvoEvent extensions to be accessed', () => {
    const eventWithSpecialChars = {
      ...baseEvent,
      source: 'test source with spaces',
      subject: 'test/subject',
      to: 'recipient@example.com',
      redirectto: 'https://example.com/redirect?param=value',
    };

    const event = createArvoEvent({
      ...eventWithSpecialChars,
      accesscontrol: 'userid=1234',
      executionunits: 100,
    });

    expect(event.source).toBe('test%20source%20with%20spaces');
    expect(event.subject).toBe('test/subject');

    expect(event.to).toBe('recipient@example.com');
    expect(event.redirectto).toBe('https://example.com/redirect?param=value');
    expect(event.accesscontrol).toBe('userid=1234');
    expect(event.executionunits).toBe(100);

    expect(event.cloudevent.extensions.executionunits).toBe(100);
  });

  it('should handle parentid extension', () => {
    const eventWithParentId = {
      ...baseEvent,
      parentid: 'parent-event-123',
    };

    const event = createArvoEvent(eventWithParentId);

    expect(event.parentid).toBe('parent-event-123');
  });

  it('should encode parentid URI components', () => {
    const eventWithSpecialParentId = {
      ...baseEvent,
      parentid: 'parent event with spaces',
    };

    const event = createArvoEvent(eventWithSpecialParentId);

    expect(event.parentid).toBe('parent%20event%20with%20spaces');
  });

  it('should handle null parentid', () => {
    const event = createArvoEvent(baseEvent);

    expect(event.parentid).toBe(null);
  });

  it('should include parentid in cloudevent extensions', () => {
    const eventWithParentId = {
      ...baseEvent,
      parentid: 'parent-event-456',
    };

    const event = createArvoEvent(eventWithParentId);

    expect(event.cloudevent.extensions.parentid).toBe('parent-event-456');
  });

  it('should include parentid in toJSON output', () => {
    const eventWithParentId = {
      ...baseEvent,
      parentid: 'parent-event-789',
      domain: 'test',
    };

    const event = createArvoEvent(eventWithParentId);
    const jsonOutput = event.toJSON();

    expect(jsonOutput.parentid).toBe('parent-event-789');
    expect(jsonOutput.domain).toBe('test');
    expect(jsonOutput.domain).toBe(event.domain);
  });

  it('should include parentid in OpenTelemetry attributes', () => {
    const eventWithParentId = {
      ...baseEvent,
      parentid: 'parent-event-otel',
    };

    const event = createArvoEvent(eventWithParentId);
    const otelAttributes = event.otelAttributes;

    expect(otelAttributes['cloudevents.arvo.event_parentid']).toBe('parent-event-otel');
    expect(event.domain).toBe(null);
    expect(event.otelAttributes['cloudevents.arvo.event_domain']).toBe(OTelNull);
  });

  it('should handle parentid with other Arvo extensions', () => {
    const eventWithMultipleExtensions = {
      ...baseEvent,
      parentid: 'parent-event-multi',
      to: 'recipient',
      accesscontrol: 'public',
      redirectto: 'redirect-url',
      executionunits: 5,
      domain: 'test.test',
    };

    const event = createArvoEvent(eventWithMultipleExtensions);

    expect(event.parentid).toBe('parent-event-multi');
    expect(event.to).toBe('recipient');
    expect(event.accesscontrol).toBe('public');
    expect(event.redirectto).toBe('redirect-url');
    expect(event.executionunits).toBe(5);
    expect(event.domain).toBe('test.test');
    expect(event.otelAttributes['cloudevents.arvo.event_domain']).toBe('test.test');
  });

  it('should throw error on faulty domain', () => {
    const eventWithMultipleExtensions = {
      ...baseEvent,
      parentid: 'parent-event-multi',
      to: 'recipient',
      accesscontrol: 'public',
      redirectto: 'redirect-url',
      executionunits: 5,
      domain: 'test.test.TEST',
    };

    let error: Error | null = null;
    try {
      createArvoEvent(eventWithMultipleExtensions);
    } catch (e) {
      error = e as Error;
    }

    expect(error?.message?.includes('Domain must contain only lowercase letters, numbers, and dots')).toBe(true);
  });

  it('should throw error on empty string of domain', () => {
    const eventWithMultipleExtensions = {
      ...baseEvent,
      parentid: 'parent-event-multi',
      to: 'recipient',
      accesscontrol: 'public',
      redirectto: 'redirect-url',
      executionunits: 5,
      domain: '',
    };

    let error: Error | null = null;
    try {
      createArvoEvent(eventWithMultipleExtensions);
    } catch (e) {
      error = e as Error;
    }
    expect(error?.message?.includes('Domain must be non-empty string')).toBe(true);
  });
});
