import { z } from 'zod';
import {
  type ArvoEvent,
  ArvoEventSchema,
  ArvoOrchestrationSubject,
  ArvoOrchestratorEventTypeGen,
  createArvoOrchestratorContract,
  createArvoOrchestratorEventFactory,
  createSimpleArvoContract,
} from '../../src';

describe('ArvoOrchestratorContract', () => {
  const testUri = 'test://example';
  const orchestratorType = 'test.contract';
  const testInitType = ArvoOrchestratorEventTypeGen.init(orchestratorType);
  const testCompleteType = ArvoOrchestratorEventTypeGen.complete(orchestratorType);
  const testInitSchema = z.object({ foo: z.string() });
  const testCompleteSchema = z.object({ bar: z.number() });

  it('should create an instance with correct properties', () => {
    const contract = createArvoOrchestratorContract({
      uri: testUri,
      name: orchestratorType,
      metadata: {
        name: 1 as const,
      },
      versions: {
        '0.0.1': {
          init: testInitSchema,
          complete: testCompleteSchema,
        },
        '0.0.2': {
          init: testInitSchema,
          complete: testCompleteSchema,
        },
      },
    });

    expect(contract.uri).toBe(testUri);
    expect(contract.type).toBe(testInitType);

    const acceptsSchema = contract.versions['0.0.1'].accepts;
    expect(acceptsSchema).toBeDefined();
    const merged = ArvoEventSchema.OrchestrationInitEventBaseSchema.merge(testInitSchema);
    expect(JSON.stringify(acceptsSchema)).toBe(JSON.stringify(merged));

    const emitsSchemas = contract.versions['0.0.1'].emits;
    expect(emitsSchemas[testCompleteType]).toBeDefined();
    expect(JSON.stringify(emitsSchemas[testCompleteType])).toBe(JSON.stringify(testCompleteSchema));

    expect(Object.keys(contract.versions)[0]).toBe('0.0.1');

    const event = createArvoOrchestratorEventFactory(contract.version('0.0.1')).init({
      source: 'com.test.test',
      data: {
        parentSubject$$: null,
        foo: 'test',
      },
    });

    expect(event.domain).toBe(null);
    expect(ArvoOrchestrationSubject.parse(event.subject).execution.domain).toBe(null);
  });

  it('should throw an error for invalid type format', () => {
    expect(() => {
      createArvoOrchestratorContract({
        uri: testUri,
        name: 'Invalid Type',
        versions: {
          '0.0.1': {
            init: testInitSchema,
            complete: testCompleteSchema,
          },
        },
      });
    }).toThrow(
      "Invalid 'name' = 'Invalid Type'. The 'name' must only contain alphanumeric characters. e.g. test.orchestrator",
    );
  });

  it('should properly merge OrchestrationInitEventBaseSchema with init schema', () => {
    const contract = createArvoOrchestratorContract({
      uri: testUri,
      name: orchestratorType,
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
      name: orchestratorType,
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

    expect(() => {
      createArvoOrchestratorEventFactory(
        createSimpleArvoContract({
          uri: '#/test',
          type: 'test.test',
          versions: {
            '0.0.1': {
              accepts: z.object({}),
              emits: z.object({}),
            },
          },
        }).version('0.0.1'),
      );
    }).toThrow('This factory can only be used for ArvoOrchestratorContract');

    let event: ArvoEvent = createArvoOrchestratorEventFactory(contract.version('2.0.0')).init({
      source: 'com.test.test',
      data: {
        foo: 'saad',
        additional: 2,
        parentSubject$$: null,
      },
      redirectto: 'com.redirect.to',
    });

    expect(event.to).toBe(contract.type);
    expect(event.type).toBe(contract.type);
    expect(event.redirectto).toBe('com.redirect.to');
    expect(ArvoOrchestrationSubject.parse(event.subject).meta.redirectto).toBe(event.redirectto);

    event = createArvoOrchestratorEventFactory(contract.version('2.0.0')).init({
      source: 'com.test.test',
      data: {
        foo: 'saad',
        additional: 2,
        parentSubject$$: event.subject,
      },
    });

    expect(ArvoOrchestrationSubject.parse(event.subject).meta.redirectto).toBe('com.test.test');
    expect(event.redirectto).toBe(null);

    event = createArvoOrchestratorEventFactory(contract.version('2.0.0')).init({
      source: 'com.test.test',
      data: {
        foo: 'saad',
        additional: 2,
        parentSubject$$: null,
      },
    });
    expect(ArvoOrchestrationSubject.parse(event.subject).meta.redirectto).toBe(undefined);

    expect(() => {
      createArvoOrchestratorEventFactory(contract.version('2.0.0')).init({
        source: 'com.test.test',
        data: {
          foo: 'saad',
          additional: 'ass' as any,
          parentSubject$$: null,
        },
        redirectto: 'com.redirect.to',
      });
    }).toThrow('Init Event data validation failed: ');

    event = createArvoOrchestratorEventFactory(contract.version('1.0.0')).complete({
      source: 'com.test.test',
      subject: 'test',
      data: {
        bar: 0,
      },
      to: 'com.ret.test',
    });

    expect(event.subject).toBe('test');
    expect(event.type).toBe(contract.version('1.0.0').metadata.completeEventType);
    expect(event.to).toBe('com.ret.test');

    event = createArvoOrchestratorEventFactory(contract.version('1.0.0')).complete({
      source: 'com.test.test',
      data: {
        bar: 0,
      },
      to: 'com.ret.test',
    });

    expect(event.type).toBe(contract.version('1.0.0').metadata.completeEventType);
    expect(event.to).toBe('com.ret.test');
    const parsedSubject = ArvoOrchestrationSubject.parse(event.subject);
    expect(parsedSubject.orchestrator.name).toBe(contract.version('1.0.0').metadata.completeEventType);
    expect(parsedSubject.orchestrator.version).toBe(contract.version('1.0.0').version);
    expect(parsedSubject.execution.initiator).toBe('com.test.test');

    expect(() => {
      createArvoOrchestratorEventFactory(contract.version('1.0.0')).complete({
        source: 'com.test.test',
        subject: 'test',
        data: {
          bar: '1' as any,
        },
        to: 'com.ret.test',
      });
    }).toThrow('Emit Event data validation failed: ');
  });

  it('should create domained event on domained contracts', () => {
    const contract = createArvoOrchestratorContract({
      uri: testUri,
      name: orchestratorType,
      domain: 'test.test',
      versions: {
        '0.0.1': {
          init: testInitSchema,
          complete: testCompleteSchema,
        },
        '0.0.2': {
          init: testInitSchema,
          complete: testCompleteSchema,
        },
      },
    });

    let event: ArvoEvent = createArvoOrchestratorEventFactory(contract.version('0.0.1')).init({
      source: 'com.test.test',
      data: {
        parentSubject$$: null,
        foo: 'test',
      },
    });

    expect(event.domain).toBe('test.test');
    expect(ArvoOrchestrationSubject.parse(event.subject).execution.domain).toBe('test.test');

    event = createArvoOrchestratorEventFactory(contract.version('0.0.1')).init({
      source: 'com.test.test',
      domain: null,
      data: {
        parentSubject$$: null,
        foo: 'test',
      },
    });

    expect(event.domain).toBe(null);
    expect(ArvoOrchestrationSubject.parse(event.subject).execution.domain).toBe(null);

    event = createArvoOrchestratorEventFactory(contract.version('0.0.1')).init({
      source: 'com.test.test',
      domain: 'test',
      data: {
        parentSubject$$: null,
        foo: 'test',
      },
    });

    expect(event.domain).toBe('test');
    expect(ArvoOrchestrationSubject.parse(event.subject).execution.domain).toBe('test');

    event = createArvoOrchestratorEventFactory(contract.version('0.0.1')).complete({
      source: 'com.test.test',
      domain: 'test',
      data: {
        bar: 100,
      },
    });

    expect(event.domain).toBe('test');
    expect(ArvoOrchestrationSubject.parse(event.subject).execution.domain).toBe('test');

    event = createArvoOrchestratorEventFactory(contract.version('0.0.1')).complete({
      source: 'com.test.test',
      data: {
        bar: 100,
      },
    });

    expect(event.domain).toBe('test.test');
    expect(ArvoOrchestrationSubject.parse(event.subject).execution.domain).toBe('test.test');

    event = createArvoOrchestratorEventFactory(contract.version('0.0.1')).complete({
      source: 'com.test.test',
      domain: null,
      data: {
        bar: 100,
      },
    });

    expect(event.domain).toBe(null);
    expect(ArvoOrchestrationSubject.parse(event.subject).execution.domain).toBe(null);
  });
});
