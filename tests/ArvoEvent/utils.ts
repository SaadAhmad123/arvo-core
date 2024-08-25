import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

export const telemetrySdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: '@arvo/core-tests',
  }),
  traceExporter: new ConsoleSpanExporter(),
});