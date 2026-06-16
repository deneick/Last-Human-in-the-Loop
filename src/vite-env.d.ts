/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Modellname für den lokalen AURORA-Agenten (Ollama), z. B. "llama3.1". */
  readonly VITE_AURORA_MODEL?: string;
  /** Basis-URL des lokalen OpenAI-kompatiblen Modell-Servers (Ollama). */
  readonly VITE_OLLAMA_BASE_URL?: string;
  /** Sampling-Temperatur des AURORA-Modells (Default 0). */
  readonly VITE_AURORA_TEMPERATURE?: string;
  /**
   * Browser-Routing des Modell-Clients: "proxy" leitet AURORA im Dev-Betrieb
   * über den Vite-Dev-Proxy `/__aurora-llm` an einen Cloud-Provider (Key bleibt
   * Node-seitig); sonst (Default) direkt an den lokalen Ollama-Server. Enthält
   * NIE einen API-Key — nur diese Routing-Wahl.
   */
  readonly VITE_AURORA_PROVIDER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
