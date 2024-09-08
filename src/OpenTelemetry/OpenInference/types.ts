/**
 * The open inference span kind as per
 * https://github.com/Arize-ai/openinference/blob/main/spec/traces.md#span-kind
 */
export enum OpenInferenceSpanKind {
  CHAIN = "CHAIN",
  RETRIEVER = "RETRIEVER",
  RERANKER = "RERANKER",
  LLM = "LLM",
  EMBEDDING = "EMBEDDING",
  TOOL = "TOOL",
  GUARDRAIL = "GUARDRAIL",  
  EVALUATOR = "EVALUATOR"
}