import { z } from 'zod';
import {
  createArvoOrchestratorContract,
  ArvoOrchestratorEventTypeGen,
  ArvoEventSchema,
} from '../../src';

describe('ArvoOrchestratorContract', () => {
  const testUri = 'test://example';
  const orchestratorType = 'test.contract';
  const testInitType = ArvoOrchestratorEventTypeGen.init(orchestratorType);
  const testCompleteType =
    ArvoOrchestratorEventTypeGen.complete(orchestratorType);
  const testInitSchema = z.object({ foo: z.string() });
  const testCompleteSchema = z.object({ bar: z.number() });

  it('should create an instance with correct properties', () => {
    const contract = createArvoOrchestratorContract({
      uri: testUri,
      type: orchestratorType,
      versions: {
        '0.0.1': {
          init: testInitSchema,
          complete: testCompleteSchema,
        },
      },
    });

    expect(contract.uri).toBe(testUri);
    expect(contract.type).toBe(testInitType);

    const acceptsSchema = contract.versions['0.0.1'].accepts;
    expect(acceptsSchema).toBeDefined();
    const merged =
      ArvoEventSchema.OrchestrationInitEventBaseSchema.merge(testInitSchema);
    expect(JSON.stringify(acceptsSchema)).toBe(JSON.stringify(merged));

    const emitsSchemas = contract.versions['0.0.1'].emits;
    expect(emitsSchemas[testCompleteType]).toBeDefined();
    expect(JSON.stringify(emitsSchemas[testCompleteType])).toBe(
      JSON.stringify(testCompleteSchema),
    );

    expect(Object.keys(contract.versions)[0]).toBe('0.0.1');
  });

  it('should throw an error for invalid type format', () => {
    expect(() => {
      createArvoOrchestratorContract({
        uri: testUri,
        type: 'Invalid Type',
        versions: {
          '0.0.1': {
            init: testInitSchema,
            complete: testCompleteSchema,
          },
        },
      });
    }).toThrow(
      "Invalid 'type' = 'Invalid Type'. The 'type' must only contain alphanumeric characters. e.g. test.orchestrator",
    );
  });

  it('should properly merge OrchestrationInitEventBaseSchema with init schema', () => {
    const contract = createArvoOrchestratorContract({
      uri: testUri,
      type: orchestratorType,
      versions: {
        '0.0.1': {
          init: testInitSchema,
          complete: testCompleteSchema,
        },
      },
    });

    const acceptsSchema = contract.versions['0.0.1'].accepts;
    const validData = {
      parentSubject$$: 'parent-123',
      foo: 'test',
    };
    expect(() => acceptsSchema.parse(validData)).not.toThrow();

    const invalidData = {
      foo: 'test',
    };
    expect(() => acceptsSchema.parse(invalidData)).toThrow();

    const emptyParentData = {
      parentSubject$$: '',
      foo: 'test',
    };
    expect(() => acceptsSchema.parse(emptyParentData)).toThrow();
  });

  it('should support multiple versions', () => {
    const v2InitSchema = z.object({ foo: z.string(), additional: z.number() });
    const v2CompleteSchema = z.object({ bar: z.number(), status: z.string() });

    const contract = createArvoOrchestratorContract({
      uri: testUri,
      type: orchestratorType,
      versions: {
        '1.0.0': {
          init: testInitSchema,
          complete: testCompleteSchema,
        },
        '2.0.0': {
          init: v2InitSchema,
          complete: v2CompleteSchema,
        },
      },
    });

    expect(Object.keys(contract.versions)).toHaveLength(2);
    expect(contract.versions['1.0.0']).toBeDefined();
    expect(contract.versions['2.0.0']).toBeDefined();

    const v2Accepts = contract.versions['2.0.0'].accepts;
    const v2Emits = contract.versions['2.0.0'].emits;

    expect(v2Accepts).toBeDefined();
    expect(v2Emits[testCompleteType]).toBeDefined();
  });
});
