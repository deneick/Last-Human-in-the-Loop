import type { AuroraModelClient, ModelRequest, ModelResponse, ModelToolCall } from "./modelClient";

/**
 * Browser-Client, der NICHT direkt mit einem Cloud-Provider spricht, sondern
 * über den Dev-Proxy des Vite-Servers (`/__aurora-llm`, siehe `vite.config.ts`).
 *
 * SICHERHEIT: Hier gibt es bewusst KEINEN API-Key und KEINEN Provider-Namen.
 * Der `ModelRequest` (System-Prompt, sichtbare History, Tool-Schemas) geht an
 * den lokalen Proxy; dort hält der Node-Prozess den Key, baut den eigentlichen
 * Cloud-Client (`resolveAuroraProvider`) und gibt nur den fertigen
 * `ModelResponse` zurück. Der Key verlässt damit nie den Node-Prozess und
 * landet nie im Browser-Bundle. Dieser Pfad ist ausschließlich für den
 * Dev-Betrieb gedacht — im Production-Build existiert der Proxy nicht.
 */

export const AURORA_PROXY_ENDPOINT = "/__aurora-llm";

export type ProxyModelClientOptions = {
  /** Proxy-Endpunkt (Default: "/__aurora-llm"). */
  endpoint?: string;
  /** Für Tests: alternative `fetch`-Implementierung. */
  fetchImpl?: typeof fetch;
};

export class ProxyModelClient implements AuroraModelClient {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ProxyModelClientOptions = {}) {
    this.endpoint = options.endpoint ?? AURORA_PROXY_ENDPOINT;
    // `fetch` an `globalThis` gebunden lassen (sonst "Illegal invocation").
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const detail = await safeText(response);
      throw new Error(
        `AURORA-Dev-Proxy-Fehler: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ""}`
      );
    }

    const data = (await response.json()) as Partial<ModelResponse>;
    // Defensiv normalisieren — der Proxy liefert bereits einen ModelResponse,
    // aber wir verlassen uns nicht blind auf die Form.
    return {
      message: typeof data.message === "string" ? data.message : "",
      toolCalls: Array.isArray(data.toolCalls) ? (data.toolCalls as ModelToolCall[]) : [],
      ...(typeof data.reasoning === "string" && data.reasoning.length > 0
        ? { reasoning: data.reasoning }
        : {}),
    };
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
