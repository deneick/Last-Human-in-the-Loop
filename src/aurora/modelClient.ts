/**
 * Provider-neutrales Interface zwischen AURORAs Runtime und einem
 * Sprachmodell.
 *
 * Eine `AuroraModelClient`-Implementierung bekommt ausschließlich:
 * - den System-Prompt (Persona, Regeln, Permission-Flow),
 * - die sichtbare Konversations-/Event-/Tool-History,
 * - die aktuell verfügbaren Tool-Schemas (bash + aktive MCP-Server).
 *
 * Sie bekommt NIE den hidden WorldState, `world.simulation`, oder eine
 * synthetisierte allwissende "AURORA observation" — das stellt
 * `src/aurora/contextBuilder.ts` sicher.
 *
 * Standard-Implementierung: `OllamaModelClient` (lokal, OpenAI-kompatibel).
 * `FakeModelClient` ist ausschließlich für deterministische Tests.
 */

export type ModelToolCall = {
  /** Stabile Id des Tool-Calls — verbindet den Call mit seinem Tool-Result. */
  id: string;
  /** "bash" oder "mcp__<server>__<tool>" (siehe toolSchema.ts). */
  name: string;
  arguments: Record<string, unknown>;
  /**
   * Gesetzt, wenn die rohen Tool-Argumente des Modells nicht als
   * JSON-Objekt lesbar waren. Der Agent führt solche Calls nicht aus,
   * sondern meldet den Fehler als fehlgeschlagenes Tool-Result zurück —
   * das Modell bekommt damit präzises Feedback statt eines stillen `{}`.
   */
  argumentsError?: string;
};

export type ModelMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ModelToolCall[] }
  | { role: "tool"; content: string; toolCallId: string; toolName: string };

export type ModelToolSchema = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ModelRequest = {
  systemPrompt: string;
  messages: ModelMessage[];
  tools: ModelToolSchema[];
};

export type ModelResponse = {
  /** Freitext-Nachricht an den Operator. Kann leer sein, wenn nur ein Tool-Call folgt. */
  message: string;
  /** Erste Slice: AURORA versucht pro Zug höchstens einen Tool-Call. */
  toolCalls: ModelToolCall[];
  /**
   * Optionaler Reasoning-/Thinking-Text des Modells (z. B. `message.reasoning`
   * bei Reasoning-Modellen über die OpenAI-kompatible Ollama-API). Nur zur
   * Anzeige — fließt NICHT zurück in den Model-Request.
   */
  reasoning?: string;
};

export interface AuroraModelClient {
  complete(request: ModelRequest): Promise<ModelResponse>;
}
