import { metrics } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { createArvoEventFactory } from 'arvo-core';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inventoryCheckV1 } from '../../../src/distributed/handler/com_inventory_check/contract.js';
import { inventoryCheckHandler } from '../../../src/distributed/handler/com_inventory_check/index.js';
import { orderFulfilV1 } from '../../../src/distributed/handler/com_order_fulfil/contract.js';
import { orderFulfilHandler } from '../../../src/distributed/handler/com_order_fulfil/index.js';
import { withDeliveryIdentity } from '../../../src/distributed/handler/log-context.js';
import { deliveryTelemetry } from '../../../src/distributed/handler/telemetry.js';
import { PostgresCatalogue } from '../../../src/distributed/shared/catalogue.js';
import { readConfig } from '../../../src/distributed/shared/config.js';
import { storeFor } from '../../../src/distributed/shared/record-store.js';

/**
 * Sections 13.8 and 13.9: what one delivery leaves behind to be read.
 *
 * Asserted against OpenTelemetry's own in-memory exporters rather than
 * against Loki and Prometheus. What is under test is that the signals
 * are produced and carry what they must — whether a collector is
 * reachable is a different question, and `pipeline.spec.ts` asks it.
 *
 * The handlers reach telemetry through the OpenTelemetry globals, so
 * registering providers here is what a worker does at boot.
 *
 * Needs the stack up and migrated, the handler reading its own data.
 */

/** An item the seed holds some of. */
const KNOWN_SKU = 'sku-wide-0005';

describe('what one delivery records', () => {
  let pool: Pool;
  const loggedRecords = new InMemoryLogRecordExporter();
  const exportedMetrics = new InMemoryMetricExporter(
    AggregationTemporality.CUMULATIVE,
  );
  let metricReader: PeriodicExportingMetricReader;
  let tracerProvider: NodeTracerProvider;

  beforeAll(async () => {
    const config = readConfig('arvo-observability-spec');
    pool = new Pool({ connectionString: config.recordsUrl, max: 4 });

    // Registered as a worker registers it, which also installs the
    // context manager: without one, nothing carried in context survives
    // an `await`, and the delivery identity would be lost at the first.
    tracerProvider = new NodeTracerProvider();
    tracerProvider.register();

    const loggerProvider = new LoggerProvider({
      processors: [new SimpleLogRecordProcessor({ exporter: loggedRecords })],
    });
    logs.setGlobalLoggerProvider(loggerProvider);

    metricReader = new PeriodicExportingMetricReader({
      exporter: exportedMetrics,
      exportIntervalMillis: 60_000,
    });
    metrics.setGlobalMeterProvider(
      new MeterProvider({ readers: [metricReader] }),
    );

    // One delivery, with the identity around it exactly as a mechanism
    // puts it there.
    const asked = createArvoEventFactory(inventoryCheckV1).createInput({
      source: 'com.test.observability',
      subject: `observed-${Date.now()}`,
      to: inventoryCheckV1.type,
      data: { sku: KNOWN_SKU, wanted: 1 },
    });

    await withDeliveryIdentity(
      {
        subject: asked.subject,
        handler: inventoryCheckV1.type,
        triggeringEventId: asked.id,
        attempt: 0,
      },
      () =>
        inventoryCheckHandler.execute({
          event: asked,
          state: ({ executionId }) => storeFor(pool).readRecord(executionId),
          attempt: 0,
          dependencies: new PostgresCatalogue(pool),
          telemetry: deliveryTelemetry(),
        }),
    );

    await metricReader.forceFlush();
  }, 120_000);

  afterAll(async () => {
    await metricReader?.shutdown();
    await tracerProvider?.shutdown();
    await pool?.end();
  });

  /** Every instrument published, by name. */
  const published = (): readonly string[] =>
    exportedMetrics
      .getMetrics()
      .flatMap((resource) => resource.scopeMetrics)
      .flatMap((scope) => scope.metrics)
      .map((one) => one.descriptor.name);

  it('carries which delivery it was on every line it logged', () => {
    const emitted = loggedRecords.getFinishedLogRecords();
    expect(emitted.length).toBeGreaterThan(0);

    for (const record of emitted) {
      // the workflow, which is what an operator searches by, and enough
      // besides to tell one delivery of it from another
      expect(record.attributes['arvo.subject']).toMatch(/^observed-/);
      expect(record.attributes['arvo.handler']).toBe(inventoryCheckV1.type);
      expect(record.attributes['arvo.triggering_event.id']).toEqual(
        expect.any(String),
      );
      expect(record.attributes['arvo.attempt']).toBe(0);
    }
  });

  it('leaves a line correlated to the span it was emitted under', () => {
    // Both, not either: the identity answers "every line for this
    // workflow" and the trace answers "everything this execution did".
    const emitted = loggedRecords.getFinishedLogRecords();
    expect(
      emitted.every(
        (record) =>
          typeof record.spanContext?.traceId === 'string' &&
          record.spanContext.traceId.length > 0,
      ),
    ).toBe(true);
  });

  it('publishes the protocol-level metrics ADR-006 names', () => {
    const names = published();

    // Prefixed by the package, which namespaces every instrument it
    // publishes. Collection size appears only where there is a
    // collection, so it is asserted by the followup below rather than
    // here: an execution that opened one has asked for nothing yet.
    expect(names).toContain('arvo.executions');
    expect(names).toContain('arvo.executor.duration');
  });

  it('publishes how wide a collection got, once there is one', async () => {
    // A real collection: an orchestrator asks for everything at once,
    // and one answer comes back. The fourth of ADR-006's metrics is
    // about how wide collections get, so it exists only from the moment
    // an execution has something to collect.
    const orderRef = `observed-collecting-${Date.now()}`;
    const opening = createArvoEventFactory(orderFulfilV1).createInput({
      source: 'com.test.observability',
      subject: orderRef,
      to: orderFulfilV1.type,
      data: { orderRef, category: 'orders', width: 1, depth: 0 },
    });

    const store = storeFor(pool);
    const asking = await orderFulfilHandler.execute({
      event: opening,
      state: ({ executionId }) => store.readRecord(executionId),
      attempt: 0,
      dependencies: new PostgresCatalogue(pool),
      telemetry: deliveryTelemetry(),
    });
    if (asking.kind !== 'produced') throw new Error('it asked for nothing');
    await store.commit({ record: asking.state, events: asking.events });

    // One of the things it asked for, answered as that service answers.
    const request = asking.events.find(
      (one) => one.to === inventoryCheckV1.type,
    );
    if (request === undefined) throw new Error('it asked for no check');

    const answer = createArvoEventFactory(inventoryCheckV1).createOutput({
      type: 'evt_inventory_checked',
      source: inventoryCheckV1.type,
      subject: orderRef,
      to: orderFulfilV1.type,
      executionid: String(asking.state.executionId),
      // Both the request's own id: it is what opened the execution that
      // is answering, and it is what the asking execution matches its
      // collection against.
      initid: request.id,
      parentid: request.id,
      data: { sku: KNOWN_SKU, held: 5, sufficient: true },
    });

    await orderFulfilHandler.execute({
      event: answer,
      state: ({ executionId }) => store.readRecord(executionId),
      attempt: 0,
      dependencies: new PostgresCatalogue(pool),
      telemetry: deliveryTelemetry(),
    });

    await metricReader.forceFlush();
    expect(published()).toContain('arvo.collection.size');
  }, 120_000);

  it('counts the delivery under the outcome it came to', () => {
    const executions = exportedMetrics
      .getMetrics()
      .flatMap((resource) => resource.scopeMetrics)
      .flatMap((scope) => scope.metrics)
      .find((one) => one.descriptor.name === 'arvo.executions');

    expect(executions).toBeDefined();
    const point = executions?.dataPoints[0];
    expect(point?.attributes.outcome).toBe('produced');
    expect(point?.attributes.lifecycle).toBe('success');
  });
});
