import type { AuroraModelClient, ModelRequest, ModelResponse } from "./modelClient";
import { DEFAULT_OLLAMA_BASE_URL } from "./config";
import {
  parseChatCompletionResponse,
  toOpenAiMessages,
  type OpenAiChatCompletionResponse,
} from "./openAiCompatible";

/**
 * `AuroraModelClient` für einen lokalen Ollama-Server über dessen
 * OpenAI-kompatible Chat-Completions-API (`/v1/chat/completions`),
 * inklusive Tool-Calling.
 *
 * Dies ist der Standard-Client für AURORA im Browser-/Dev-Betrieb. Ein
 * OpenAI-kompatibler Cloud-Provider läuft über `OpenAiCompatibleModelClient`
 * (nur Node/Eval, mit API-Key) — beide teilen sich die Request-/Response-
 * Abbildung aus `openAiCompatible.ts`.
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
      messages: toOpenAiMessages(request.systemPrompt, request.messages),
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
      return parseChatCompletionResponse(data, () => this.nextFallbackCallId());
    } catch (error) {
      this.onExchange?.({
        requestBody,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private nextFallbackCallId(): string {
    this.fallbackCallIdCounter += 1;
    return `call-${this.fallbackCallIdCounter}`;
  }
}
