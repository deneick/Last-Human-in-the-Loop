import { getAuroraModelConfig } from "./config";
import type { AuroraModelClient } from "./modelClient";
import { OllamaModelClient } from "./ollamaModelClient";

export * from "./modelClient";
export * from "./toolSchema";
export * from "./systemPrompt";
export * from "./contextBuilder";
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
  const { baseUrl, model } = getAuroraModelConfig();
  return new OllamaModelClient({ baseUrl, model });
}
