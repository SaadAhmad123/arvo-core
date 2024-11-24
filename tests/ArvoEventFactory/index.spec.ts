import {
  ArvoOrchestrationSubject,
  createArvoContract,
  createArvoEventFactory,
  parseEventDataSchema,
} from '../../src';
import { z } from 'zod';
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
    },
  });

  describe('emits', () => {
    it('should create a valid event when data matches the schema', async () => {
      const event = createArvoEventFactory(mockContract).emits({
        version: '0.0.1',
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

      const event1 = createArvoEventFactory(mockContract).emits({
        version: '0.0.1',
        type: 'test.output.1',
        source: 'test-source',
        subject: 'test-subject',
        data: { message: 'saad' },
        to: 'cmd.saad.test',
      });

      expect(event1).toBeDefined();
      expect(event1.type).toBe('test.output.1');
      expect(event1.data).toEqual({ message: 'saad' });
      const dataschema = parseEventDataSchema(event1);
      expect(dataschema?.uri).toBe('#/mock/contract');
      expect(dataschema?.version).toBe('0.0.1');
    });

    it('should throw an error when data does not match the schema', async () => {
      expect(() =>
        createArvoEventFactory(mockContract).emits({
          version: '0.0.1',
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
        createArvoEventFactory(mockContract).emits({
          version: '0.0.1',
          type: 'unknown.type.0' as any,
          source: 'test-source',
          subject: 'test-subject',
          data: {} as any,
          to: 'cmd.saad.test',
        }),
      ).toThrow("Emit type \"unknown.type.0\" for version \"0.0.1\" not found in contract \"#/mock/contract\"");
    });
  });

  describe('accepts', () => {
    it('should create a valid event when data matches the schema', async () => {
      const event = createArvoEventFactory(mockContract).accepts({
        version: '0.0.1',
        source: 'test-source',
        subject: 'test-subject',
        data: { input: 'test' },
        to: 'cmd.saad.test',
      });

      expect(event).toBeDefined();
      expect(event.type).toBe('test.input.0');
      expect(event.data).toEqual({ input: 'test' });
    });

    it('should throw an error when data does not match the schema', async () => {
      expect(() =>
        createArvoEventFactory(mockContract).accepts({
          version: '0.0.1',
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
      const eventFactory = createArvoEventFactory(mockContract);
      const event = eventFactory.systemError({
        source: 'test',
        subject: 'test',
        error: new Error('Some error'),
        to: 'cmd.saad.test',
      });
      expect(event.data.errorName).toBe('Error');
      expect(event.data.errorMessage).toBe('Some error');
      expect(event.data.errorStack).toBeTruthy();
      expect(parseEventDataSchema(event)?.version).toBe(
        ArvoOrchestrationSubject.WildCardMachineVersion,
      );
    });
  });
});
