import { createArvoEvent, ArvoEvent, ArvoDataContentType } from '../../src';
import { telemetrySdk } from './utils';

describe(`
  An ArvoEvent extends CloudEvent, enhancing scalability for event-driven systems. It supports both choreography 
  and command-driven orchestration models while maintaining seamless integration with the CloudEvent standard, 
  ensuring portability across environments and vendors.    
`, () => {
  beforeAll(() => {
    telemetrySdk.start();
  });

  afterAll(() => {
    telemetrySdk.shutdown();
  });

  const baseEvent = {
    source: 'test.producer',
    type: 'cmd.saad.test',
    subject: 'test.json',
    data: { message: 'Hello, World!' },
    to: 'worker',
  };

  it('should throw an error when to is not provided for an Arvo event', () => {
    const result = createArvoEvent({
      source: 'test.producer',
      type: 'cmd.saad.test',
      subject: 'test.json',
      data: { message: 'Hello, World!' },
    });

    expect(result.event).toBe(null);
    expect(result.errors.length).toBe(1);
    expect(result.warnings.length).toBe(0);
  });

  it('should output a warning when non Arvo datacontenttype is used', () => {
    const result = createArvoEvent({
      source: 'test.producer',
      type: 'cmd.saad.test',
      subject: 'test.json',
      datacontenttype: 'application/json',
      data: { message: 'Hello, World!' },
    });

    expect(result.event).toBeTruthy();
    expect(result.errors.length).toBe(0);
    expect(result.warnings.length).toBe(1);
  });

  it('should not allow any Non-JSON datacontenttypes', () => {
    const result = createArvoEvent({
      source: 'test.producer',
      type: 'cmd.saad.test',
      subject: 'test.json',
      datacontenttype: 'text/plain',
      data: { message: 'Hello, World!' },
    });

    expect(result.event).toBe(null);
    expect(result.errors.length).toBe(1);
    expect(result.warnings.length).toBe(1);
  });

  it('should create a valid ArvoEvent with minimal required fields', () => {
    const result = createArvoEvent(baseEvent);

    expect(result.event).toBeInstanceOf(ArvoEvent);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);

    if (result.event) {
      expect(result.event.source).toBe('test.producer');
      expect(result.event.type).toBe('cmd.saad.test');
      expect(result.event.subject).toBe('test.json');
      expect(result.event.data).toEqual({ message: 'Hello, World!' });
      expect(result.event.datacontenttype).toBe(ArvoDataContentType);
      expect(result.event.specversion).toBe('1.0');
      expect(result.event.id).toBeTruthy();
      expect(result.event.time).toBeTruthy();
    }
  });

  it('should use provided id and time if given', () => {
    const eventWithIdAndTime = {
      ...baseEvent,
      id: 'custom-id',
      time: '2023-05-01T12:00:00Z',
    };

    const result = createArvoEvent(eventWithIdAndTime);

    expect(result.event?.id).toBe('custom-id');
    expect(result.event?.time).toBe('2023-05-01T12:00:00Z');
  });

  it('should add a warning when non-Arvo datacontenttype is provided', () => {
    const eventWithCustomDataContentType = {
      ...baseEvent,
      datacontenttype: 'application/json',
    };

    const result = createArvoEvent(eventWithCustomDataContentType);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(
      'Warning! The provided datacontenttype',
    );
  });

  it('should handle custom extensions', () => {
    const customExtensions = {
      customfield: 'custom-value',
    };

    const result = createArvoEvent(baseEvent, customExtensions);
    expect(result.event?.extensions.customfield).toBe('custom-value');
  });

  it('should handle Arvo-specific extensions', () => {
    const eventWithArvoExtensions = {
      ...baseEvent,
      to: 'recipient',
      accesscontrol: 'public',
      redirectto: 'redirect-url',
      executionunits: 5,
    };

    const result = createArvoEvent(eventWithArvoExtensions);

    expect(result.event?.extensions.to).toBe('recipient');
    expect(result.event?.extensions.accesscontrol).toBe('public');
    expect(result.event?.extensions.redirectto).toBe('redirect-url');
    expect(result.event?.extensions.executionunits).toBe(5);
  });

  it('should handle OpenTelemetry extensions', () => {
    const eventWithOTelExtensions = {
      ...baseEvent,
      traceparent: 'traceparent-value',
      tracestate: 'tracestate-value',
    };

    const result = createArvoEvent(eventWithOTelExtensions);

    expect(result.event?.extensions.traceparent).toBe('traceparent-value');
    expect(result.event?.extensions.tracestate).toBe('tracestate-value');
  });

  it('should return errors when invalid data is provided', () => {
    const invalidEvent = {
      ...baseEvent,
      data: { invalidField: Symbol('invalid') }, // Symbols are not valid JSON
    };

    const result = createArvoEvent(invalidEvent);

    expect(result.event).toBeNull();
    expect(result.errors).toHaveLength(1);
  });

  it('should encode URI components for certain fields', () => {
    const eventWithSpecialChars = {
      ...baseEvent,
      source: 'test source with spaces',
      subject: 'test/subject',
      to: 'recipient@example.com',
      redirectto: 'https://example.com/redirect?param=value',
    };

    const result = createArvoEvent(eventWithSpecialChars);

    expect(result.event?.source).toBe('test%20source%20with%20spaces');
    expect(result.event?.subject).toBe('test/subject');
    expect(result.event?.extensions.to).toBe('recipient@example.com');
    expect(result.event?.extensions.redirectto).toBe(
      'https://example.com/redirect?param=value',
    );
  });
});
