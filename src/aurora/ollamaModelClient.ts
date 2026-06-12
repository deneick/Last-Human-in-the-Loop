import type {
  AuroraModelClient,
  ModelMessage,
  ModelRequest,
  ModelResponse,
  ModelToolCall,
} from "./modelClient";
import { DEFAULT_AURORA_MODEL, DEFAULT_OLLAMA_BASE_URL } from "./config";

/**
 * `AuroraModelClient` für einen lokalen Ollama-Server über dessen
 * OpenAI-kompatible Chat-Completions-API (`/v1/chat/completions`),
 * inklusive Tool-Calling.
 *
 * Dies ist der Standard-Client für AURORA — Cloud-Provider (Anthropic,
 * OpenAI, ...) sind in diesem Slice bewusst nicht angebunden.
 */
export type OllamaModelClientOptions = {
  /** Basis-URL des Ollama-Servers, z. B. "http://localhost:11434". */
  baseUrl?: string;
  /** Modellname, wie er bei "ollama pull <model>" verwendet wurde. */
  model?: string;
  /** Für Tests: alternative `fetch`-Implementierung. */
  fetchImpl?: typeof fetch;
};

type OpenAiToolCall = {
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

type OpenAiChatMessage = {
  content?: string | null;
  tool_calls?: OpenAiToolCall[];
};

type OpenAiChatCompletionResponse = {
  choices?: { message?: OpenAiChatMessage }[];
};

export class OllamaModelClient implements AuroraModelClient {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OllamaModelClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_OLLAMA_BASE_URL;
    this.model = options.model ?? DEFAULT_AURORA_MODEL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        messages: [
          { role: "system", content: request.systemPrompt },
          ...request.messages.map(toOpenAiMessage),
        ],
        tools: request.tools,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as OpenAiChatCompletionResponse;
    return toModelResponse(data);
  }
}

function toOpenAiMessage(message: ModelMessage): Record<string, unknown> {
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content,
      ...(message.toolCalls && message.toolCalls.length > 0
        ? { tool_calls: message.toolCalls.map(toOpenAiToolCall) }
        : {}),
    };
  }

  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content,
    };
  }

  return { role: "user", content: message.content };
}

function toOpenAiToolCall(call: ModelToolCall): OpenAiToolCall {
  return {
    id: call.id,
    function: { name: call.name, arguments: JSON.stringify(call.arguments) },
  };
}

function toModelResponse(data: OpenAiChatCompletionResponse): ModelResponse {
  const message = data.choices?.[0]?.message ?? {};

  const toolCalls: ModelToolCall[] = (message.tool_calls ?? []).map((toolCall, index) => ({
    id: toolCall.id ?? `call-${index + 1}`,
    name: toolCall.function?.name ?? "",
    arguments: parseToolArguments(toolCall.function?.arguments),
  }));

  return {
    message: typeof message.content === "string" ? message.content : "",
    toolCalls,
  };
}

function parseToolArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
