import { z } from 'zod';
import {
  ArvoOrchestratorContract,
  createArvoOrchestratorContract,
  ArvoOrchestratorEventTypeGen,
  ArvoEventSchemas,
  createArvoEventFactory,
} from '../../src';
import zodToJsonSchema from 'zod-to-json-schema';

describe('ArvoOrchestratorContract', () => {
  const testUri = 'test://example';
  const testInitType = 'arvo.init.test';
  const testCompleteType = 'arvo.done.test';
  const testInitSchema = z.object({ foo: z.string() });
  const testCompleteSchema = z.object({ bar: z.number() });

  it('should create an instance with correct properties', () => {
    const contract = new ArvoOrchestratorContract({
      uri: testUri,
      init: {
        type: testInitType,
        schema: testInitSchema,
      },
      complete: {
        type: testCompleteType,
        schema: testCompleteSchema,
      },
    });

    expect(contract.uri).toBe(testUri);
    expect(contract.init.type).toBe(testInitType);
    expect(contract.init.schema).toBe(testInitSchema);
    expect(contract.complete.type).toBe(testCompleteType);
    expect(contract.complete.schema).toBe(testCompleteSchema);
  });

  it('should correctly get init and complete properties', () => {
    const contract = new ArvoOrchestratorContract({
      uri: testUri,
      init: {
        type: testInitType,
        schema: testInitSchema,
      },
      complete: {
        type: testCompleteType,
        schema: testCompleteSchema,
      },
    });

    expect(contract.init).toEqual({
      type: testInitType,
      schema: testInitSchema,
    });

    expect(contract.complete).toEqual({
      type: testCompleteType,
      schema: testCompleteSchema,
    });
  });
});

describe('createArvoOrchestratorContract', () => {
  const testUri = 'test://example';
  const testName = 'test.contract';
  const testInitSchema = z.object({ foo: z.string() });
  const testCompleteSchema = z.object({ bar: z.number() });

  it('should create a valid ArvoOrchestratorContract', () => {
    const contract = createArvoOrchestratorContract({
      uri: testUri,
      name: testName,
      schema: {
        init: testInitSchema,
        complete: testCompleteSchema,
      },
    });

    expect(contract).toBeInstanceOf(ArvoOrchestratorContract);
    expect(contract.uri).toBe(testUri);
    expect(contract.init.type).toBe(
      `${ArvoOrchestratorEventTypeGen.__prefix}.${testName}`,
    );
    expect(JSON.stringify(zodToJsonSchema(contract.init.schema))).toBe(
      JSON.stringify(
        zodToJsonSchema(
          z.intersection(
            ArvoEventSchemas.OrchestrationInitEventBaseSchema,
            testInitSchema,
          ),
        ),
      ),
    );
    expect(contract.complete.type).toBe(
      `${ArvoOrchestratorEventTypeGen.__prefix}.${testName}.done`,
    );
    expect(contract.complete.schema).toBe(testCompleteSchema);

    let event = createArvoEventFactory(contract).accepts({
      subject: 'test',
      source: 'test',
      data: {
        parentSubject$$: null,
        foo: 'saad'
      },
    });

    expect(event.data.parentSubject$$).toBe(null);
    expect(event.data.foo).toBe('saad');

    event = createArvoEventFactory(contract).accepts({
      subject: 'test',
      source: 'test',
      data: {
        parentSubject$$: 'child',
        foo: 'saad',
      },
    });

    expect(event.data.parentSubject$$).toBe('child');
    expect(event.data.foo).toBe('saad');
  });

  it('should throw an error for non-alphanumeric name', () => {
    expect(() => {
      createArvoOrchestratorContract({
        uri: testUri,
        name: 'invalid name',
        schema: {
          init: testInitSchema,
          complete: testCompleteSchema,
        },
      });
    }).toThrow(
      "Invalid 'name' = 'invalid name'. The 'name' must only contain alphanumeric characters.",
    );
  });
});
