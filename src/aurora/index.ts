import { getAuroraBrowserProvider, getAuroraModelConfig } from "./config";
import type { AuroraModelClient } from "./modelClient";
import { OllamaModelClient, type AuroraModelExchange } from "./ollamaModelClient";
import { ProxyModelClient } from "./proxyModelClient";

export * from "./modelClient";
export * from "./toolSchema";
export * from "./systemPrompt";
export * from "./contextBuilder";
export * from "./contextSerializer";
export * from "./debriefSummary";
export * from "./config";
export * from "./fakeModelClient";
export * from "./ollamaModelClient";
export * from "./proxyModelClient";
export * from "./agent";

/**
 * Standard-Modell-Client für AURORA. Zwei browserseitige Pfade (Wahl über
 * `VITE_AURORA_PROVIDER`, siehe `getAuroraBrowserProvider`):
 *
 * - "ollama" (Default): direkter Zugriff auf den lokalen Ollama-Server,
 *   konfiguriert über `VITE_OLLAMA_BASE_URL` / `VITE_AURORA_MODEL`.
 * - "proxy" (nur Dev): Cloud-Provider über den Vite-Dev-Proxy `/__aurora-llm`;
 *   der API-Key bleibt im Node-Prozess (siehe `vite.config.ts`,
 *   `ProxyModelClient`) und landet nie im Browser-Bundle.
 *
 * Tests verwenden stattdessen `FakeModelClient`.
 */
export function createDefaultAuroraModelClient(): AuroraModelClient {
  // Der Proxy existiert nur im Dev-Betrieb — im Production-Build immer Ollama.
  if (import.meta.env.DEV && getAuroraBrowserProvider() === "proxy") {
    return new ProxyModelClient();
  }

  const { baseUrl, model, temperature } = getAuroraModelConfig();
  return new OllamaModelClient({
    baseUrl,
    model,
    temperature,
    // Nur im Vite-Dev-Betrieb: jeden rohen Modell-Austausch an den lokalen
    // Logging-Endpoint schicken, der ihn nach `logs/aurora-llm.log` schreibt
    // (siehe `vite.config.ts`). Im Production-Build und in Tests inaktiv.
    onExchange: import.meta.env.DEV ? postExchangeToDevLog : undefined,
  });
}

/**
 * Schickt einen Modell-Austausch fire-and-forget an den Dev-Logging-Endpoint.
 * Fehler hier dürfen den Spielfluss NIE stören — daher bewusst verschluckt.
 */
function postExchangeToDevLog(exchange: AuroraModelExchange): void {
  void fetch("/__aurora-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ timestamp: new Date().toISOString(), ...exchange }),
  }).catch(() => {
    /* Dev-Logging ist best-effort. */
  });
}
