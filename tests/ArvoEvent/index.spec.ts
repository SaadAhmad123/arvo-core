import { createArvoEvent, ArvoEvent, ArvoDataContentType } from '../../src';
import { telemetrySdkStart, telemetrySdkStop } from '../utils';

describe(`ArvoEvent`, () => {
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

  it('should use provided id and time if given', () => {
    const eventWithIdAndTime = {
      ...baseEvent,
      id: 'custom-id',
      time: '2023-05-01T12:00:00Z',
    };

    const event = createArvoEvent(eventWithIdAndTime);

    expect(event.id).toBe('custom-id');
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
});
