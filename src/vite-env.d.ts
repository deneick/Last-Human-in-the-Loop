/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Modellname für den lokalen AURORA-Agenten (Ollama), z. B. "llama3.1". */
  readonly VITE_AURORA_MODEL?: string;
  /** Basis-URL des lokalen OpenAI-kompatiblen Modell-Servers (Ollama). */
  readonly VITE_OLLAMA_BASE_URL?: string;
  /** Sampling-Temperatur des AURORA-Modells (Default 0). */
  readonly VITE_AURORA_TEMPERATURE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
