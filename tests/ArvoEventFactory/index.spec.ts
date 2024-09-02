import { createArvoContract, createArvoEventFactory } from '../../src';
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
    uri: 'test-uri',
    accepts: {
      type: 'test.input.0',
      schema: z.object({ input: z.string() }),
    },

    emits: {
      'test.output.0': z.object({
        output: z.number(),
      }),
      'test.output.1': z.object({
        message: z.string(),
      }),
    },
  });

  describe('emits', () => {
    it('should create a valid event when data matches the schema', async () => {
      const event = createArvoEventFactory(mockContract).emits({
        type: 'test.output.0',
        source: 'test-source',
        subject: 'test-subject',
        data: { output: 42 },
        to: 'cmd.saad.test',
      });

      expect(event).toBeDefined();
      expect(event.type).toBe('test.output.0');
      expect(event.data).toEqual({ output: 42 });

      const event1 = createArvoEventFactory(mockContract).emits({
        type: 'test.output.1',
        source: 'test-source',
        subject: 'test-subject',
        data: { message: 'saad' },
        to: 'cmd.saad.test',
      });

      expect(event1).toBeDefined();
      expect(event1.type).toBe('test.output.1');
      expect(event1.data).toEqual({ message: 'saad' });
    });

    it('should throw an error when data does not match the schema', async () => {
      expect(() =>
        createArvoEventFactory(mockContract).emits({
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
          type: 'unknown.type.0' as any,
          source: 'test-source',
          subject: 'test-subject',
          data: {} as any,
          to: 'cmd.saad.test',
        }),
      ).toThrow('Emit type "unknown.type.0" not found in contract');
    });
  });

  describe('accepts', () => {
    it('should create a valid event when data matches the schema', async () => {
      const event = createArvoEventFactory(mockContract).accepts({
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
          source: 'test-source',
          subject: 'test-subject',
          data: { input: 42 as any },
          to: 'cmd.saad.test',
        }),
      ).toThrow('Event data validation failed');
    });

    it('should throw an error for unknown event type', async () => {
      expect(() =>
        createArvoEventFactory(mockContract).accepts({
          source: 'test-source',
          subject: 'test-subject',
          data: {} as any,
          to: 'cmd.saad.test',
        }),
      ).toThrow('Accept type "unknown.type.0" not found in contract');
    });
  });

  describe('systemError', () => {
    it('should create system error message as per the contract', () => {
      const eventFactory = createArvoEventFactory(mockContract).systemError
    })
  })
});
