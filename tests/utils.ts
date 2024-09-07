import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import * as dotenv from 'dotenv'
dotenv.config()

diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);

// Console Logger
export const telemetrySdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: 'arvo-core',
  }),
  traceExporter: new ConsoleSpanExporter(),
  instrumentations: [getNodeAutoInstrumentations()],
});

export const telemetrySdkStart = () => {
  if (process.env.ENABLE_OTEL) {
    telemetrySdk.start();
  }
};

export const telemetrySdkStop = () => {
  telemetrySdk.shutdown();
};
