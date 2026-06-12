import type { AuroraModelClient, ModelRequest, ModelResponse, ModelToolCall } from "./modelClient";

/**
 * Deterministischer `AuroraModelClient` für Tests: liefert eine vorbereitete
 * Antwortsequenz, unabhängig vom tatsächlichen `ModelRequest`.
 *
 * Die letzte Antwort wird wiederholt, falls `complete` öfter aufgerufen wird
 * als Antworten vorbereitet wurden — so bleiben Tests robust gegenüber
 * zusätzlichen Agenten-Schritten (z. B. nach einer Permission-Entscheidung).
 */
export class FakeModelClient implements AuroraModelClient {
  private readonly responses: ModelResponse[];
  private callCount = 0;

  /** Für Tests: alle bisher empfangenen Requests, in Aufrufreihenfolge. */
  readonly requests: ModelRequest[] = [];

  constructor(responses: ModelResponse[]) {
    if (responses.length === 0) {
      throw new Error("FakeModelClient requires at least one response");
    }
    this.responses = responses;
  }

  get calls(): number {
    return this.callCount;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const index = Math.min(this.callCount, this.responses.length - 1);
    this.callCount += 1;
    return this.responses[index];
  }
}

/** Reine Text-Antwort ohne Tool-Call. */
export function textResponse(message: string): ModelResponse {
  return { message, toolCalls: [] };
}

/** Antwort mit genau einem Tool-Call (bash oder mcp__<server>__<tool>). */
export function toolCallResponse(
  name: string,
  args: Record<string, unknown> = {},
  id = "call-1"
): ModelResponse {
  const toolCall: ModelToolCall = { id, name, arguments: args };
  return { message: "", toolCalls: [toolCall] };
}
