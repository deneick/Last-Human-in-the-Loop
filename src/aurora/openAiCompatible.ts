import type { ModelMessage, ModelResponse, ModelToolCall } from "./modelClient";

/**
 * Geteilte Request-/Response-Abbildung für die OpenAI-kompatible
 * Chat-Completions-API. Sowohl der lokale `OllamaModelClient` als auch der
 * `OpenAiCompatibleModelClient` (Cloud) bauen darauf auf — so ist garantiert,
 * dass Messages, Tools und Tool-Result-Serialisierung über alle Provider
 * IDENTISCH sind (Anforderung: gleiche Serialisierung, gleiche Guards).
 *
 * Bewusst KEINE Netzwerk-/Auth-Logik hier — die Clients besitzen URL, Header
 * und API-Key. Diese Datei ist provider- und transport-neutral.
 */

export type OpenAiToolCall = {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    /**
     * Standardkonform ein JSON-String. Manche OpenAI-kompatiblen Provider
     * (z. B. Gemini) liefern die Argumente stattdessen direkt als Objekt —
     * `parseToolArguments` normalisiert beide Formen hier im Adapter, damit die
     * Runtime nur noch ein `Record` sieht.
     */
    arguments?: string | Record<string, unknown>;
  };
};

export type OpenAiChatMessage = {
  content?: string | null;
  tool_calls?: OpenAiToolCall[];
  /**
   * Reasoning-/Thinking-Text von Reasoning-Modellen. Ollama liefert ihn als
   * `reasoning`, manche OpenAI-kompatiblen Server als `reasoning_content`.
   */
  reasoning?: string | null;
  reasoning_content?: string | null;
};

/** Token-Verbrauch laut Provider (für Telemetrie/Logging). */
export type OpenAiUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

export type OpenAiChatCompletionResponse = {
  choices?: { message?: OpenAiChatMessage; finish_reason?: string }[];
  usage?: OpenAiUsage;
};

/** Baut die `messages`-Liste: System-Prompt zuerst, dann die abgebildete History. */
export function toOpenAiMessages(systemPrompt: string, messages: ModelMessage[]): Record<string, unknown>[] {
  return [{ role: "system", content: systemPrompt }, ...messages.map(toOpenAiMessage)];
}

export function toOpenAiMessage(message: ModelMessage): Record<string, unknown> {
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

export function toOpenAiToolCall(call: ModelToolCall): OpenAiToolCall {
  return {
    id: call.id,
    // OpenAI-Schema verlangt das type-Feld an jedem assistant tool_call.
    type: "function",
    function: { name: call.name, arguments: JSON.stringify(call.arguments) },
  };
}

/**
 * Parst eine Chat-Completions-Antwort in eine `ModelResponse`. Fehlende/leere
 * Tool-Call-Ids bekommen über `nextFallbackId` eine eindeutige Ersatz-Id (der
 * aufrufende Client hält den monotonen Zähler).
 */
export function parseChatCompletionResponse(
  data: OpenAiChatCompletionResponse,
  nextFallbackId: () => string
): ModelResponse {
  const message = data.choices?.[0]?.message ?? {};

  const toolCalls: ModelToolCall[] = (message.tool_calls ?? []).map((toolCall) => {
    const parsed = parseToolArguments(toolCall.function?.arguments);

    return {
      // `||` statt `??`: auch ein leerer Id-String bekommt eine Fallback-Id.
      id: toolCall.id || nextFallbackId(),
      name: toolCall.function?.name ?? "",
      arguments: parsed.arguments,
      ...(parsed.error ? { argumentsError: parsed.error } : {}),
    };
  });

  const reasoning =
    typeof message.reasoning === "string" && message.reasoning.trim().length > 0
      ? message.reasoning
      : typeof message.reasoning_content === "string" && message.reasoning_content.trim().length > 0
        ? message.reasoning_content
        : undefined;

  return {
    message: typeof message.content === "string" ? message.content : "",
    toolCalls,
    ...(reasoning ? { reasoning } : {}),
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
export function parseToolArguments(raw: string | Record<string, unknown> | undefined): ParsedToolArguments {
  if (raw === undefined || raw === null) {
    return { arguments: {} };
  }

  // Gemini-Variante: die Argumente kommen bereits als geparstes Objekt herein —
  // direkt übernehmen (ein Array ist kein gültiges Argument-Objekt).
  if (typeof raw === "object") {
    return Array.isArray(raw)
      ? { arguments: {}, error: "Tool arguments must be a JSON object, got an array" }
      : { arguments: raw as Record<string, unknown> };
  }

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
