/**
 * Konfiguration für den lokalen AURORA-Agenten.
 *
 * Liest optionale Vite-Env-Variablen (siehe `src/vite-env.d.ts`,
 * `.env.example`) und fällt für die Server-URL auf einen lokalen Ollama-Server
 * zurück. Es gibt bewusst KEINEN Default-Modellnamen — das Modell MUSS über
 * `VITE_AURORA_MODEL` gesetzt werden, damit nie still ein nicht installiertes
 * Modell angenommen wird. Fehlt der Wert, ist `model` leer; der Modell-Client
 * meldet das beim ersten `complete()` als klaren Fehler. Cloud-Provider sind
 * bewusst nicht angebunden — AURORA läuft gegen ein lokales, OpenAI-kompatibles
 * Modell.
 */

/** Standard-Basis-URL des lokalen Ollama-Servers. */
export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

/**
 * Standard-Sampling-Temperatur. 0 = deterministisch und maximal zuverlässig
 * beim Tool-Calling. Der Eval (`npm run eval:models`) zeigt für llama3.1: bei
 * temp 0 wird der richtige MCP-Server in 100% der Läufe aktiviert, bei höherer
 * Temperatur sinkt das spürbar und es tauchen erfundene Server-Ids auf.
 */
export const DEFAULT_AURORA_TEMPERATURE = 0;

export type AuroraModelConfig = {
  /** Basis-URL des OpenAI-kompatiblen Modell-Servers (ohne "/v1/..."-Suffix). */
  baseUrl: string;
  /**
   * Modellname aus `VITE_AURORA_MODEL`, wie beim lokalen Server registriert
   * (z. B. via "ollama pull <model>"). Leer, wenn nicht konfiguriert — es gibt
   * absichtlich keinen Fallback-Default.
   */
  model: string;
  /** Sampling-Temperatur aus `VITE_AURORA_TEMPERATURE` (Default 0). */
  temperature: number;
};

/**
 * Liest die AURORA-Modellkonfiguration aus den Vite-Env-Variablen.
 * Die Server-URL fällt auf den lokalen Default zurück; der Modellname hat
 * KEINEN Default und bleibt leer, wenn `VITE_AURORA_MODEL` nicht gesetzt ist.
 */
export function getAuroraModelConfig(): AuroraModelConfig {
  const env = import.meta.env;

  const baseUrl = env.VITE_OLLAMA_BASE_URL?.trim();
  const model = env.VITE_AURORA_MODEL?.trim();
  const rawTemperature = env.VITE_AURORA_TEMPERATURE?.trim();
  const parsedTemperature = rawTemperature ? Number(rawTemperature) : NaN;

  return {
    baseUrl: baseUrl && baseUrl.length > 0 ? baseUrl : DEFAULT_OLLAMA_BASE_URL,
    model: model && model.length > 0 ? model : "",
    temperature: Number.isFinite(parsedTemperature)
      ? parsedTemperature
      : DEFAULT_AURORA_TEMPERATURE,
  };
}
