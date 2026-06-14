import { getAuroraModelConfig } from "./config";
import type { AuroraModelClient } from "./modelClient";
import { OllamaModelClient, type AuroraModelExchange } from "./ollamaModelClient";

export * from "./modelClient";
export * from "./toolSchema";
export * from "./systemPrompt";
export * from "./contextBuilder";
export * from "./contextSerializer";
export * from "./config";
export * from "./fakeModelClient";
export * from "./ollamaModelClient";
export * from "./agent";

/**
 * Standard-Modell-Client für AURORA: ein lokaler Ollama-Server,
 * konfiguriert über `VITE_OLLAMA_BASE_URL` / `VITE_AURORA_MODEL`
 * (siehe `.env.example`). Tests verwenden stattdessen `FakeModelClient`.
 */
export function createDefaultAuroraModelClient(): AuroraModelClient {
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
