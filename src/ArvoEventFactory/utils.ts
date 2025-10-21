import { SpanKind } from '@opentelemetry/api';
import type { VersionedArvoContract } from '../ArvoContract/VersionedArvoContract';
import { ArvoExecution, ArvoExecutionSpanKind } from '../OpenTelemetry/ArvoExecution';
import { OpenInference, OpenInferenceSpanKind } from '../OpenTelemetry/OpenInference';

export const createSpanOptions = (contract: VersionedArvoContract<any, any>) => ({
  kind: SpanKind.INTERNAL,
  attributes: {
    [ArvoExecution.ATTR_SPAN_KIND]: ArvoExecutionSpanKind.INTERNAL,
    [OpenInference.ATTR_SPAN_KIND]: OpenInferenceSpanKind.INTERNAL,
    'arvo.contract.uri': contract.uri,
    'arvo.contract.version': contract.version,
  },
});
