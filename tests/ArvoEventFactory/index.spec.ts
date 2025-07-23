import { z } from 'zod';
import {
  type ArvoEvent,
  ArvoOrchestrationSubject,
  EventDataschemaUtil,
  WildCardArvoSemanticVersion,
  createArvoContract,
  createArvoEventFactory,
} from '../../src';
import { telemetrySdkStart, telemetrySdkStop } from '../utils';

describe('createArvoEventFactory', () => {
  beforeAll(() => {
    telemetrySdkStart();
  });

  afterAll(() => {
    telemetrySdkStop();
  });

  const mockContract = createArvoContract({
    uri: '#/mock/contract',
    type: 'test.input.0',
    versions: {
      '0.0.1': {
        accepts: z.object({ input: z.string() }),
        emits: {
          'test.output.0': z.object({
            output: z.number(),
          }),
          'test.output.1': z.object({
            message: z.string(),
          }),
        },
      },
      '0.0.8': {
        accepts: z.object({ input: z.string() }),
        emits: {
          'test.output.0': z.object({
            output: z.number(),
            saad: z.string(),
          }),
          'test.output.1': z.object({
            message: z.string(),
          }),
        },
      },
    },
  });

  describe('emits', () => {
    it('should create a valid event when data matches the schema', async () => {
      const event = createArvoEventFactory(mockContract.version('0.0.1')).emits({
        type: 'test.output.0',
        source: 'test-source',
        subject: 'test-subject',
        data: { output: 42 },
        to: 'cmd.saad.test',
      });

      expect(event).toBeDefined();
      expect(event.type).toBe('test.output.0');
      expect(event.data).toEqual({ output: 42 });
      expect(event.dataschema).toEqual('#/mock/contract/0.0.1');
      expect(event.subject).toBe('test-subject');

      const event1 = createArvoEventFactory(mockContract.version('0.0.1')).emits({
        type: 'test.output.1',
        source: 'test-source',
        subject: 'test-subject',
        data: { message: 'saad' },
        to: 'cmd.saad.test',
      });

      expect(event1).toBeDefined();
      expect(event1.type).toBe('test.output.1');
      expect(event1.data).toEqual({ message: 'saad' });
      const dataschema = EventDataschemaUtil.parse(event1);
      expect(dataschema?.uri).toBe('#/mock/contract');
      expect(dataschema?.version).toBe('0.0.1');
      expect(event.domain).toBe(null);
    });

    it('should throw an error when data does not match the schema', async () => {
      expect(() =>
        createArvoEventFactory(mockContract.version('0.0.1')).emits({
          type: 'test.output.0',
          source: 'test-source',
          subject: 'test-subject',
          data: { output: 'not a number' as any },
          to: 'cmd.saad.test',
        }),
      ).toThrow('Event data validation failed');
    });

    it('should throw an error for unknown event type', async () => {
      expect(() =>
        createArvoEventFactory(mockContract.version('0.0.1')).emits({
          type: 'unknown.type.0' as any,
          source: 'test-source',
          subject: 'test-subject',
          data: {} as any,
          to: 'cmd.saad.test',
        }),
      ).toThrow('Emit Event data validation failed: No contract available for unknown.type.0');
    });
  });

  describe('accepts', () => {
    it('should create a valid event when data matches the schema', async () => {
      const event = createArvoEventFactory(mockContract.version('0.0.1')).accepts({
        source: 'test-source',
        subject: 'test-subject',
        data: { input: 'test' },
        to: 'cmd.saad.test',
      });

      expect(event).toBeDefined();
      expect(event.type).toBe('test.input.0');
      expect(event.data).toEqual({ input: 'test' });
      expect(event.domain).toBe(null);
    });

    it('should throw an error when data does not match the schema', async () => {
      expect(() =>
        createArvoEventFactory(mockContract.version('0.0.1')).accepts({
          source: 'test-source',
          subject: 'test-subject',
          data: { input: 42 as any },
          to: 'cmd.saad.test',
        }),
      ).toThrow('Event data validation failed');
    });
  });

  describe('systemError', () => {
    it('should create system error message as per the contract', () => {
      const eventFactory = createArvoEventFactory(mockContract.version('0.0.1'));
      const event = eventFactory.systemError({
        source: 'test',
        subject: 'test',
        error: new Error('Some error'),
        to: 'cmd.saad.test',
      });
      expect(event.data.errorName).toBe('Error');
      expect(event.data.errorMessage).toBe('Some error');
      expect(event.data.errorStack).toBeTruthy();
      expect(EventDataschemaUtil.parse(event)?.version).toBe(WildCardArvoSemanticVersion);
      expect(event.domain).toBe(null);
    });
  });

  describe('parentid support', () => {
    it('should handle parentid in accepts method', () => {
      const eventFactory = createArvoEventFactory(mockContract.version('0.0.1'));
      const event = eventFactory.accepts({
        source: 'com.test.test',
        parentid: 'parent-event-123',
        data: {
          input: 'test-input',
        },
      });

      expect(event.parentid).toBe('parent-event-123');
      expect(event.type).toBe('test.input.0');
      expect(event.data).toEqual({ input: 'test-input' });
    });

    it('should handle parentid in emits method', () => {
      const eventFactory = createArvoEventFactory(mockContract.version('0.0.1'));
      const event = eventFactory.emits({
        type: 'test.output.0',
        source: 'com.test.test',
        parentid: 'parent-event-456',
        data: {
          output: 42,
        },
      });

      expect(event.parentid).toBe('parent-event-456');
      expect(event.type).toBe('test.output.0');
      expect(event.data).toEqual({ output: 42 });
    });

    it('should handle parentid in systemError method', () => {
      const eventFactory = createArvoEventFactory(mockContract.version('0.0.1'));
      const event = eventFactory.systemError({
        source: 'com.test.test',
        parentid: 'parent-event-789',
        error: new Error('Test error'),
      });

      expect(event.parentid).toBe('parent-event-789');
      expect(event.data.errorName).toBe('Error');
      expect(event.data.errorMessage).toBe('Test error');
    });

    it('should encode parentid with special characters', () => {
      const eventFactory = createArvoEventFactory(mockContract.version('0.0.1'));
      const event = eventFactory.accepts({
        source: 'com.test.test',
        parentid: 'parent event with spaces',
        data: {
          input: 'test-input',
        },
      });

      expect(event.parentid).toBe('parent%20event%20with%20spaces');
    });

    it('should default parentid to null when not provided', () => {
      const eventFactory = createArvoEventFactory(mockContract.version('0.0.1'));
      const event = eventFactory.accepts({
        source: 'com.test.test',
        data: {
          input: 'test-input',
        },
        domain: 'test.test',
      });

      expect(event.parentid).toBe(null);
      expect(event.domain).toBe('test.test');
    });

    it('should include parentid in OpenTelemetry attributes', () => {
      const eventFactory = createArvoEventFactory(mockContract.version('0.0.1'));
      const event = eventFactory.emits({
        type: 'test.output.1',
        source: 'com.test.test',
        parentid: 'otel-parent-event',
        data: {
          message: 'test message',
        },
      });

      const otelAttributes = event.otelAttributes;
      expect(otelAttributes['cloudevents.arvo.event_parentid']).toBe('otel-parent-event');
    });
  });

  it('should generate subject automatically for accepts event', () => {
    const eventFactory = createArvoEventFactory(mockContract.version('0.0.1'));
    const event = eventFactory.accepts({
      source: 'com.test.test',
      data: {
        input: 'Name',
      },
    });
    const parsedSubject = ArvoOrchestrationSubject.parse(event.subject);
    expect(parsedSubject?.orchestrator?.name).toBe(mockContract.type);
    expect(parsedSubject?.execution?.initiator).toBe('com.test.test');
    expect(parsedSubject?.orchestrator?.version).toBe(mockContract.version('0.0.1').version);
  });

  it('should generate subject automatically for emit event', () => {
    const eventFactory = createArvoEventFactory(mockContract.version('0.0.1'));
    const event = eventFactory.emits({
      type: 'test.output.0',
      source: 'com.test.test',
      data: {
        output: 10,
      },
    });
    const parsedSubject = ArvoOrchestrationSubject.parse(event.subject);
    expect(parsedSubject?.orchestrator?.name).toBe('test.output.0');
    expect(parsedSubject?.execution?.initiator).toBe('com.test.test');
    expect(parsedSubject?.orchestrator?.version).toBe(mockContract.version('0.0.1').version);
  });

  it('should generate subject automatically for system error event', () => {
    const eventFactory = createArvoEventFactory(mockContract.version('0.0.1'));
    const event = eventFactory.systemError({
      source: 'com.test.test',
      error: new Error('Some event'),
    });
    const parsedSubject = ArvoOrchestrationSubject.parse(event.subject);
    expect(parsedSubject?.orchestrator?.name).toBe(mockContract.systemError.type);
    expect(parsedSubject?.execution?.initiator).toBe('com.test.test');
    expect(parsedSubject?.orchestrator?.version).toBe(mockContract.version('0.0.1').version);
  });

  it('should generate domained event on domained mock contract', () => {
    const mockContract = createArvoContract({
      uri: '#/mock/contract',
      type: 'test.input.0',
      domain: 'test.test',
      versions: {
        '0.0.1': {
          accepts: z.object({ input: z.string() }),
          emits: {
            'test.output.0': z.object({
              output: z.number(),
            }),
            'test.output.1': z.object({
              message: z.string(),
            }),
          },
        },
        '0.0.8': {
          accepts: z.object({ input: z.string() }),
          emits: {
            'test.output.0': z.object({
              output: z.number(),
              saad: z.string(),
            }),
            'test.output.1': z.object({
              message: z.string(),
            }),
          },
        },
      },
    });

    let event: ArvoEvent = createArvoEventFactory(mockContract.version('0.0.1')).accepts({
      source: 'com.test.test',
      data: {
        input: 'test',
      },
    });

    expect(event.domain).toBe('test.test');

    event = createArvoEventFactory(mockContract.version('0.0.1')).accepts({
      source: 'com.test.test',
      domain: null,
      data: {
        input: 'test',
      },
    });

    expect(event.domain).toBe(null);

    event = createArvoEventFactory(mockContract.version('0.0.1')).accepts({
      source: 'com.test.test',
      domain: 'test.test.test',
      data: {
        input: 'test',
      },
    });

    expect(event.domain).toBe('test.test.test');

    event = createArvoEventFactory(mockContract.version('0.0.1')).emits({
      type: 'test.output.0',
      source: 'com.test.test',
      domain: 'test.test.test',
      data: {
        output: 23,
      },
    });

    expect(event.domain).toBe('test.test.test');

    event = createArvoEventFactory(mockContract.version('0.0.1')).emits({
      type: 'test.output.0',
      source: 'com.test.test',
      domain: null,
      data: {
        output: 23,
      },
    });

    expect(event.domain).toBe(null);

    event = createArvoEventFactory(mockContract.version('0.0.1')).emits({
      type: 'test.output.0',
      source: 'com.test.test',
      data: {
        output: 23,
      },
    });

    expect(event.domain).toBe('test.test');

    event = createArvoEventFactory(mockContract.version('0.0.1')).systemError({
      source: 'com.test.test',
      error: new Error('error'),
    });

    expect(event.domain).toBe('test.test');

    event = createArvoEventFactory(mockContract.version('0.0.1')).systemError({
      source: 'com.test.test',
      domain: null,
      error: new Error('error'),
    });

    expect(event.domain).toBe(null);

    event = createArvoEventFactory(mockContract.version('0.0.1')).systemError({
      source: 'com.test.test',
      domain: 'test.test.test',
      error: new Error('error'),
    });

    expect(event.domain).toBe('test.test.test');
  });
});
