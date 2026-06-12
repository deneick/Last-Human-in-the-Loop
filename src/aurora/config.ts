/**
 * Konfiguration für den lokalen AURORA-Agenten.
 *
 * Liest optionale Vite-Env-Variablen (siehe `src/vite-env.d.ts`,
 * `.env.example`) und fällt ansonsten auf einen lokalen Ollama-Server
 * zurück. Es gibt bewusst keine Cloud-Provider-Defaults — AURORA läuft
 * standardmäßig gegen ein lokales, OpenAI-kompatibles Modell.
 */

/** Standard-Basis-URL des lokalen Ollama-Servers. */
export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

/** Standard-Modellname, falls VITE_AURORA_MODEL nicht gesetzt ist. */
export const DEFAULT_AURORA_MODEL = "llama3.1";

export type AuroraModelConfig = {
  /** Basis-URL des OpenAI-kompatiblen Modell-Servers (ohne "/v1/..."-Suffix). */
  baseUrl: string;
  /** Modellname, wie er beim lokalen Server (z. B. "ollama pull <model>") registriert ist. */
  model: string;
};

/**
 * Liest die AURORA-Modellkonfiguration aus den Vite-Env-Variablen.
 * Leere oder fehlende Werte fallen auf die lokalen Defaults zurück.
 */
export function getAuroraModelConfig(): AuroraModelConfig {
  const env = import.meta.env;

  const baseUrl = env.VITE_OLLAMA_BASE_URL?.trim();
  const model = env.VITE_AURORA_MODEL?.trim();

  return {
    baseUrl: baseUrl && baseUrl.length > 0 ? baseUrl : DEFAULT_OLLAMA_BASE_URL,
    model: model && model.length > 0 ? model : DEFAULT_AURORA_MODEL,
  };
}
