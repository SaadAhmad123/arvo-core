import { SpanKind } from "@opentelemetry/api";
import { VersionedArvoContract } from "../ArvoContract/VersionedArvoContract";
import ArvoExecution from "../OpenTelemetry/ArvoExecution";
import OpenInference from "../OpenTelemetry/OpenInference";
import { ArvoExecutionSpanKind } from "../OpenTelemetry/ArvoExecution/types";
import { OpenInferenceSpanKind } from "../OpenTelemetry/OpenInference/types";

export const createSpanOptions = (contract: VersionedArvoContract<any, any>) => ({
  kind: SpanKind.INTERNAL,
  attributes: {
    [ArvoExecution.ATTR_SPAN_KIND]: ArvoExecutionSpanKind.INTERNAL,
    [OpenInference.ATTR_SPAN_KIND]: OpenInferenceSpanKind.INTERNAL,
    'arvo.contract.uri': contract.uri,
    'arvo.contract.version': contract.version,
  }
})