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

    let event: ArvoEvent = createArvoOrchestratorEventFactory(contract.version('0.0.1')).init({
      source: 'com.test.test',
      data: {
        parentSubject$$: null,
        foo: 'test',
      },
    });

    expect(event.domain).toBe(null);
    expect(ArvoOrchestrationSubject.parse(event.subject).execution.domain).toBe(null);

    event = createArvoOrchestratorEventFactory(contract.version('0.0.1')).init({
      source: 'com.test.test',
      data: {
        parentSubject$$: null,
        foo: 'test',
      },
      domain: 'external.review',
    });

    expect(event.domain).toBe('external.review');
    expect(ArvoOrchestrationSubject.parse(event.subject).execution.domain).toBe('external.review');

    event = createArvoOrchestratorEventFactory(contract.version('0.0.1')).complete({
      source: 'com.test.test',
      data: {
        bar: 1,
      },
      domain: 'external.review',
    });

    expect(event.domain).toBe('external.review');
    expect(ArvoOrchestrationSubject.parse(event.subject).execution.domain).toBe('external.review');

    event = createArvoOrchestratorEventFactory(contract.version('0.0.1')).complete({
      subject: event.subject,
      source: 'com.test.test',
      data: {
        bar: 1,
      },
      domain: 'external.review.1',
    });

    expect(event.domain).toBe('external.review.1');
    expect(ArvoOrchestrationSubject.parse(event.subject).execution.domain).toBe('external.review');
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

  it('should handle domain inheritance in child orchestrations via parentSubject$$', () => {
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

    // Parent orchestration with domain
    const parentEvent = createArvoOrchestratorEventFactory(contract.version('0.0.1')).init({
      source: 'com.test.parent',
      data: {
        parentSubject$$: null,
        foo: 'parent',
      },
      domain: 'production.us',
    });

    expect(parentEvent.domain).toBe('production.us');
    expect(ArvoOrchestrationSubject.parse(parentEvent.subject).execution.domain).toBe('production.us');

    // Child orchestration inherits parent's domain through subject
    const childEvent = createArvoOrchestratorEventFactory(contract.version('0.0.1')).init({
      source: 'com.test.child',
      data: {
        parentSubject$$: parentEvent.subject,
        foo: 'child',
      },
    });

    // Child event domain is null (not explicitly set)
    expect(childEvent.domain).toBe(null);
    // Child subject's initiator is the parent orchestrator name
    const childSubject = ArvoOrchestrationSubject.parse(childEvent.subject);
    expect(childSubject.execution.initiator).toBe(testInitType);
    expect(childSubject.execution.domain).toBe('production.us');

    // When child spawns with explicit different domain
    const childWithDomain = createArvoOrchestratorEventFactory(contract.version('0.0.1')).init({
      source: 'com.test.child',
      data: {
        parentSubject$$: parentEvent.subject,
        foo: 'child',
      },
      domain: 'staging.eu',
    });

    expect(childWithDomain.domain).toBe('staging.eu');
    // Subject still reflects the parent orchestrator as initiator
    const childWithDomainSubject = ArvoOrchestrationSubject.parse(childWithDomain.subject);
    expect(childWithDomainSubject.execution.initiator).toBe(testInitType);
    expect(childWithDomainSubject.execution.domain).toBe('staging.eu')
  });

  it('should allow explicit domain override on completion events', () => {
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

    // Create orchestration in specific domain
    const initEvent = createArvoOrchestratorEventFactory(contract.version('0.0.1')).init({
      source: 'com.test.test',
      data: {
        parentSubject$$: null,
        foo: 'test',
      },
      domain: 'region.asia',
    });

    // Complete event without domain - defaults to null
    const completeLocal = createArvoOrchestratorEventFactory(contract.version('0.0.1')).complete({
      subject: initEvent.subject,
      source: 'com.test.test',
      data: { bar: 42 },
    });

    expect(completeLocal.domain).toBe(null);
    expect(ArvoOrchestrationSubject.parse(completeLocal.subject).execution.domain).toBe('region.asia');

    // Complete event with explicit domain override
    const completeOverride = createArvoOrchestratorEventFactory(contract.version('0.0.1')).complete({
      subject: initEvent.subject,
      source: 'com.test.test',
      data: { bar: 42 },
      domain: 'notification.email',
    });

    expect(completeOverride.domain).toBe('notification.email');
    expect(ArvoOrchestrationSubject.parse(completeOverride.subject).execution.domain).toBe('region.asia');
  });

  it('should handle null domain explicitly set vs undefined domain', () => {
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

    // No domain parameter (undefined)
    const eventUndefined = createArvoOrchestratorEventFactory(contract.version('0.0.1')).init({
      source: 'com.test.test',
      data: {
        parentSubject$$: null,
        foo: 'test',
      },
    });

    expect(eventUndefined.domain).toBe(null);
    expect(ArvoOrchestrationSubject.parse(eventUndefined.subject).execution.domain).toBe(null);

    // Explicit null domain
    const eventNull = createArvoOrchestratorEventFactory(contract.version('0.0.1')).init({
      source: 'com.test.test',
      data: {
        parentSubject$$: null,
        foo: 'test',
      },
      domain: null,
    });

    expect(eventNull.domain).toBe(null);
    expect(ArvoOrchestrationSubject.parse(eventNull.subject).execution.domain).toBe(null);

    // Both behave identically - domain defaults to null
    expect(eventUndefined.domain).toBe(eventNull.domain);

    // Domain string
    const eventWithDomain = createArvoOrchestratorEventFactory(contract.version('0.0.1')).init({
      source: 'com.test.test',
      data: {
        parentSubject$$: null,
        foo: 'test',
      },
      domain: 'custom.domain',
    });

    expect(eventWithDomain.domain).toBe('custom.domain');
    expect(ArvoOrchestrationSubject.parse(eventWithDomain.subject).execution.domain).toBe('custom.domain');
  });

  it('should allow explicit domain override on completion events', () => {
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

    // Create orchestration in specific domain
    const initEvent = createArvoOrchestratorEventFactory(contract.version('0.0.1')).init({
      source: 'com.test.test',
      data: {
        parentSubject$$: null,
        foo: 'test',
      },
      domain: 'region.asia',
    });

    // Complete event without domain - defaults to null
    const completeLocal = createArvoOrchestratorEventFactory(contract.version('0.0.1')).complete({
      subject: initEvent.subject,
      source: 'com.test.test',
      data: { bar: 42 },
    });

    expect(completeLocal.domain).toBe(null);
    expect(ArvoOrchestrationSubject.parse(completeLocal.subject).execution.domain).toBe('region.asia');

    // Complete event with explicit domain override
    const completeOverride = createArvoOrchestratorEventFactory(contract.version('0.0.1')).complete({
      subject: initEvent.subject,
      source: 'com.test.test',
      data: { bar: 42 },
      domain: 'notification.email',
    });

    expect(completeOverride.domain).toBe('notification.email');
    expect(ArvoOrchestrationSubject.parse(completeOverride.subject).execution.domain).toBe('region.asia');
  });

  it('should handle null domain explicitly set vs undefined domain', () => {
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

    // No domain parameter (undefined)
    const eventUndefined = createArvoOrchestratorEventFactory(contract.version('0.0.1')).init({
      source: 'com.test.test',
      data: {
        parentSubject$$: null,
        foo: 'test',
      },
    });

    expect(eventUndefined.domain).toBe(null);
    expect(ArvoOrchestrationSubject.parse(eventUndefined.subject).execution.domain).toBe(null);

    // Explicit null domain
    const eventNull = createArvoOrchestratorEventFactory(contract.version('0.0.1')).init({
      source: 'com.test.test',
      data: {
        parentSubject$$: null,
        foo: 'test',
      },
      domain: null,
    });

    expect(eventNull.domain).toBe(null);
    expect(ArvoOrchestrationSubject.parse(eventNull.subject).execution.domain).toBe(null);

    // Both behave identically - domain defaults to null
    expect(eventUndefined.domain).toBe(eventNull.domain);

    // Domain string
    const eventWithDomain = createArvoOrchestratorEventFactory(contract.version('0.0.1')).init({
      source: 'com.test.test',
      data: {
        parentSubject$$: null,
        foo: 'test',
      },
      domain: 'custom.domain',
    });

    expect(eventWithDomain.domain).toBe('custom.domain');
    expect(ArvoOrchestrationSubject.parse(eventWithDomain.subject).execution.domain).toBe('custom.domain');
  });
});
