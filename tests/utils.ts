import { ArvoOpenTelemetry } from '../src';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import {
  diag,
  DiagConsoleLogger,
  DiagLogLevel,
  trace,
} from '@opentelemetry/api';
import { OTLPTraceExporter as GRPCTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import * as dotenv from 'dotenv';
dotenv.config();

ArvoOpenTelemetry.getInstance({ tracer: trace.getTracer('arvo-core') });

diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);

// Console Logger
const createTelemetrySdk = () => {
  const telemetryResources = new Resource({
    [ATTR_SERVICE_NAME]: 'arvo-core',
  });
  if (process.env.EXPORTER_OTEL === 'JAEGER') {
    return new NodeSDK({
      resource: telemetryResources,
      traceExporter: new GRPCTraceExporter(),
      instrumentations: [getNodeAutoInstrumentations()],
    });
  }
  return new NodeSDK({
    resource: telemetryResources,
    traceExporter: new ConsoleSpanExporter(),
    instrumentations: [getNodeAutoInstrumentations()],
  });
};

// Console Logger
export const telemetrySdk = createTelemetrySdk();

export const telemetrySdkStart = () => {
  if (process.env.ENABLE_OTEL === 'TRUE') {
    telemetrySdk.start();
  }
};

export const telemetrySdkStop = () => {
  telemetrySdk.shutdown();
};
