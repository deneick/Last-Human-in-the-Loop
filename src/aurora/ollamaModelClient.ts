import type {
  AuroraModelClient,
  ModelMessage,
  ModelRequest,
  ModelResponse,
  ModelToolCall,
} from "./modelClient";
import { DEFAULT_OLLAMA_BASE_URL } from "./config";

/**
 * `AuroraModelClient` für einen lokalen Ollama-Server über dessen
 * OpenAI-kompatible Chat-Completions-API (`/v1/chat/completions`),
 * inklusive Tool-Calling.
 *
 * Dies ist der Standard-Client für AURORA — Cloud-Provider (Anthropic,
 * OpenAI, ...) sind in diesem Slice bewusst nicht angebunden.
 */
/**
 * Ein einzelner Modell-Austausch in roher Form: der exakt an den Server
 * gesendete Request-Body und entweder die rohe Antwort oder ein Fehlertext.
 * Dient ausschließlich dem dev-seitigen Mitschreiben (siehe
 * `createDefaultAuroraModelClient`).
 */
export type AuroraModelExchange = {
  requestBody: unknown;
  responseBody?: unknown;
  error?: string;
};

export type OllamaModelClientOptions = {
  /** Basis-URL des Ollama-Servers, z. B. "http://localhost:11434". */
  baseUrl?: string;
  /** Modellname, wie er bei "ollama pull <model>" verwendet wurde. */
  model?: string;
  /**
   * Sampling-Temperatur. Niedrige Werte (0..0.3) erhöhen die Zuverlässigkeit
   * von Tool-Calling und reduzieren halluzinierte Server-/Tool-Ids spürbar.
   * Undefined lässt das Modell-Default greifen.
   */
  temperature?: number;
  /** Optionaler Seed für reproduzierbare Antworten (Ollama-spezifisch). */
  seed?: number;
  /** Für Tests: alternative `fetch`-Implementierung. */
  fetchImpl?: typeof fetch;
  /**
   * Optionaler Hook, der bei JEDEM Modell-Austausch mit dem rohen Request und
   * der rohen Response (oder einem Fehler) aufgerufen wird. Dev-only Logging;
   * darf den Spielfluss nicht beeinflussen und sollte nie werfen.
   */
  onExchange?: (exchange: AuroraModelExchange) => void;
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
  /**
   * Reasoning-/Thinking-Text von Reasoning-Modellen. Ollama liefert ihn als
   * `reasoning`, manche OpenAI-kompatiblen Server als `reasoning_content`.
   */
  reasoning?: string | null;
  reasoning_content?: string | null;
};

type OpenAiChatCompletionResponse = {
  choices?: { message?: OpenAiChatMessage }[];
};

export class OllamaModelClient implements AuroraModelClient {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly temperature?: number;
  private readonly seed?: number;
  private readonly fetchImpl: typeof fetch;
  private readonly onExchange?: (exchange: AuroraModelExchange) => void;
  /**
   * Fallback-Zähler für Tool-Call-Ids, falls der Server keine (oder leere)
   * Ids liefert. Läuft über die Lebensdauer des Clients monoton hoch, damit
   * Fallback-Ids auch über mehrere Züge hinweg eindeutig bleiben.
   */
  private fallbackCallIdCounter = 0;

  constructor(options: OllamaModelClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_OLLAMA_BASE_URL;
    // Kein Default-Modell: ein nicht gesetzter Name bleibt leer und wird in
    // complete() als klarer Konfigurationsfehler gemeldet.
    this.model = options.model ?? "";
    this.temperature = options.temperature;
    this.seed = options.seed;
    // `fetch` muss an `globalThis`/`window` gebunden bleiben: ein über `this`
    // aufgerufenes, entkoppeltes `fetch` wirft im Browser "Illegal invocation".
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    this.onExchange = options.onExchange;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (!this.model) {
      throw new Error(
        'VITE_AURORA_MODEL ist nicht gesetzt. Lege den Modellnamen in .env.local fest ' +
          '(z. B. VITE_AURORA_MODEL=llama3.1) und installiere das Modell per ' +
          '"ollama pull <model>". Siehe .env.example.'
      );
    }

    // Genau der Body, der über die Leitung geht — auch das Logging sieht damit
    // exakt, was das Modell bekommen hat (System-Prompt, History, Tools).
    const requestBody = {
      model: this.model,
      stream: false,
      messages: [
        { role: "system", content: request.systemPrompt },
        ...request.messages.map(toOpenAiMessage),
      ],
      tools: request.tools,
      ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
      ...(this.seed !== undefined ? { seed: this.seed } : {}),
    };

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as OpenAiChatCompletionResponse;
      this.onExchange?.({ requestBody, responseBody: data });
      return this.toModelResponse(data);
    } catch (error) {
      this.onExchange?.({
        requestBody,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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

    const reasoning =
      typeof message.reasoning === "string" && message.reasoning.trim().length > 0
        ? message.reasoning
        : typeof message.reasoning_content === "string" &&
            message.reasoning_content.trim().length > 0
          ? message.reasoning_content
          : undefined;

    return {
      message: typeof message.content === "string" ? message.content : "",
      toolCalls,
      ...(reasoning ? { reasoning } : {}),
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
