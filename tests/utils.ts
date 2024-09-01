import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';

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
  telemetrySdk.start();
};

export const telemetrySdkStop = () => {
  telemetrySdk.shutdown();
};
