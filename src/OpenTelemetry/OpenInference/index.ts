/**
 * OpenInference class containing attribute constants for OpenTelemetry OpenInference.
 * These attribute names are defined as per the OpenInference specification:
 * @see https://github.com/Arize-ai/openinference/blob/main/spec/semantic_conventions.md
 */
export default class OpenInference {
  static readonly ATTR_SPAN_KIND = 'openinference.span.kind';

  // Document attributes
  static readonly ATTR_DOCUMENT_CONTENT = 'document.content';
  static readonly ATTR_DOCUMENT_ID = 'document.id';
  static readonly ATTR_DOCUMENT_METADATA = 'document.metadata';
  static readonly ATTR_DOCUMENT_SCORE = 'document.score';

  // Embedding attributes
  static readonly ATTR_EMBEDDING_EMBEDDINGS = 'embedding.embeddings';
  static readonly ATTR_EMBEDDING_MODEL_NAME = 'embedding.model_name';
  static readonly ATTR_EMBEDDING_TEXT = 'embedding.text';
  static readonly ATTR_EMBEDDING_VECTOR = 'embedding.vector';

  // Exception attributes
  static readonly ATTR_EXCEPTION_ESCAPED = 'exception.escaped';
  static readonly ATTR_EXCEPTION_MESSAGE = 'exception.message';
  static readonly ATTR_EXCEPTION_STACKTRACE = 'exception.stacktrace';
  static readonly ATTR_EXCEPTION_TYPE = 'exception.type';

  // Image attribute
  static readonly ATTR_IMAGE_URL = 'image.url';

  // Input attributes
  static readonly ATTR_INPUT_MIME_TYPE = 'input.mime_type';
  static readonly ATTR_INPUT_VALUE = 'input.value';

  // LLM attributes
  static readonly ATTR_LLM_FUNCTION_CALL = 'llm.function_call';
  static readonly ATTR_LLM_INPUT_MESSAGES = 'llm.input_messages';
  static readonly ATTR_LLM_INVOCATION_PARAMETERS = 'llm.invocation_parameters';
  static readonly ATTR_LLM_MODEL_NAME = 'llm.model_name';
  static readonly ATTR_LLM_OUTPUT_MESSAGES = 'llm.output_messages';
  static readonly ATTR_LLM_PROMPT_TEMPLATE_TEMPLATE =
    'llm.prompt_template.template';
  static readonly ATTR_LLM_PROMPT_TEMPLATE_VARIABLES =
    'llm.prompt_template.variables';
  static readonly ATTR_LLM_PROMPT_TEMPLATE_VERSION =
    'llm.prompt_template.version';
  static readonly ATTR_LLM_TOKEN_COUNT_COMPLETION =
    'llm.token_count.completion';
  static readonly ATTR_LLM_TOKEN_COUNT_PROMPT = 'llm.token_count.prompt';
  static readonly ATTR_LLM_TOKEN_COUNT_TOTAL = 'llm.token_count.total';
  static readonly ATTR_LLM_TOOLS = 'llm.tools';

  // Message attributes
  static readonly ATTR_MESSAGE_CONTENT = 'message.content';
  static readonly ATTR_MESSAGE_CONTENTS = 'message.contents';
  static readonly ATTR_MESSAGE_FUNCTION_CALL_ARGUMENTS_JSON =
    'message.function_call_arguments_json';
  static readonly ATTR_MESSAGE_FUNCTION_CALL_NAME =
    'message.function_call_name';
  static readonly ATTR_MESSAGE_ROLE = 'message.role';
  static readonly ATTR_MESSAGE_TOOL_CALLS = 'message.tool_calls';

  // Message content attributes
  static readonly ATTR_MESSAGE_CONTENT_TYPE = 'messagecontent.type';
  static readonly ATTR_MESSAGE_CONTENT_TEXT = 'messagecontent.text';
  static readonly ATTR_MESSAGE_CONTENT_IMAGE = 'messagecontent.image';

  // Metadata attribute
  static readonly ATTR_METADATA = 'metadata';

  // Output attributes
  static readonly ATTR_OUTPUT_MIME_TYPE = 'output.mime_type';
  static readonly ATTR_OUTPUT_VALUE = 'output.value';

  // Reranker attributes
  static readonly ATTR_RERANKER_INPUT_DOCUMENTS = 'reranker.input_documents';
  static readonly ATTR_RERANKER_MODEL_NAME = 'reranker.model_name';
  static readonly ATTR_RERANKER_OUTPUT_DOCUMENTS = 'reranker.output_documents';
  static readonly ATTR_RERANKER_QUERY = 'reranker.query';
  static readonly ATTR_RERANKER_TOP_K = 'reranker.top_k';

  // Retrieval attribute
  static readonly ATTR_RETRIEVAL_DOCUMENTS = 'retrieval.documents';

  // Session attribute
  static readonly ATTR_SESSION_ID = 'session.id';

  // Tag attribute
  static readonly ATTR_TAG_TAGS = 'tag.tags';

  // Tool attributes
  static readonly ATTR_TOOL_DESCRIPTION = 'tool.description';
  static readonly ATTR_TOOL_JSON_SCHEMA = 'tool.json_schema';
  static readonly ATTR_TOOL_NAME = 'tool.name';
  static readonly ATTR_TOOL_PARAMETERS = 'tool.parameters';

  // Tool call attributes
  static readonly ATTR_TOOL_CALL_FUNCTION_ARGUMENTS =
    'tool_call.function.arguments';
  static readonly ATTR_TOOL_CALL_FUNCTION_NAME = 'tool_call.function.name';

  // User attribute
  static readonly ATTR_USER_ID = 'user.id';
}
