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
  type?: string;
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
  /**
   * Fallback-Zähler für Tool-Call-Ids, falls der Server keine (oder leere)
   * Ids liefert. Läuft über die Lebensdauer des Clients monoton hoch, damit
   * Fallback-Ids auch über mehrere Züge hinweg eindeutig bleiben.
   */
  private fallbackCallIdCounter = 0;

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
    return this.toModelResponse(data);
  }

  private toModelResponse(data: OpenAiChatCompletionResponse): ModelResponse {
    const message = data.choices?.[0]?.message ?? {};

    const toolCalls: ModelToolCall[] = (message.tool_calls ?? []).map((toolCall) => {
      const parsed = parseToolArguments(toolCall.function?.arguments);

      return {
        // `||` statt `??`: auch ein leerer Id-String bekommt eine Fallback-Id.
        id: toolCall.id || this.nextFallbackCallId(),
        name: toolCall.function?.name ?? "",
        arguments: parsed.arguments,
        ...(parsed.error ? { argumentsError: parsed.error } : {}),
      };
    });

    return {
      message: typeof message.content === "string" ? message.content : "",
      toolCalls,
    };
  }

  private nextFallbackCallId(): string {
    this.fallbackCallIdCounter += 1;
    return `call-${this.fallbackCallIdCounter}`;
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
    // OpenAI-Schema verlangt das type-Feld an jedem assistant tool_call.
    type: "function",
    function: { name: call.name, arguments: JSON.stringify(call.arguments) },
  };
}

const MAX_RAW_ARGUMENTS_IN_ERROR = 200;

type ParsedToolArguments = {
  arguments: Record<string, unknown>;
  /** Fehlerbeschreibung, falls die rohen Argumente kein JSON-Objekt waren. */
  error?: string;
};

/**
 * Parst die rohen Tool-Argumente des Modells. Kaputtes JSON wird NICHT still
 * zu `{}` — der Fehler wandert als `argumentsError` in den ModelToolCall und
 * von dort als fehlgeschlagenes Tool-Result zurück ans Modell.
 */
function parseToolArguments(raw: string | undefined): ParsedToolArguments {
  if (!raw) {
    return { arguments: {} };
  }

  const excerpt =
    raw.length > MAX_RAW_ARGUMENTS_IN_ERROR ? `${raw.slice(0, MAX_RAW_ARGUMENTS_IN_ERROR)}…` : raw;

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return { arguments: parsed as Record<string, unknown> };
    }
    return { arguments: {}, error: `Tool arguments must be a JSON object, got: ${excerpt}` };
  } catch {
    return { arguments: {}, error: `Invalid JSON in tool arguments: ${excerpt}` };
  }
}
