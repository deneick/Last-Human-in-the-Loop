import type { WorldState } from "../runtime/types";
import type { AuroraQueueItem, AuroraQueueState, AuroraRequest } from "../runtime/auroraQueue";
import type { ScenarioRuntimeState } from "../runtime/runtimeState";
import type { McpRegistry, McpRuntimeState } from "../mcp/mcpRegistry";
import type { ModelMessage, ModelRequest, ModelToolCall } from "./modelClient";
import { AURORA_SYSTEM_PROMPT } from "./systemPrompt";
import { BASH_TOOL_NAME, buildAvailableToolSchemas, mcpToolFunctionName } from "./toolSchema";

/**
 * Eingaben für `buildAuroraModelRequest`. Bewusst NUR Felder, die das Modell
 * sehen darf:
 *
 * - `world`: für `world.incidents[*].public_signals` (öffentliche
 *   Beobachtungen). `world.simulation` wird NIE gelesen.
 * - `mcpRegistry` + `mcpState`: für die aktuell sichtbaren Tool-Schemas.
 * - `auroraQueue`: bereits bearbeitete Aurora-Anfragen (Tool-Call-History).
 * - `scenario`: skriptierte Operator-Nachrichten (`messages`) und AURORAs
 *   eigene bisherige Freitext-Antworten (`agentMessages`).
 */
export type AuroraContextInput = {
  world: WorldState;
  mcpRegistry: McpRegistry;
  mcpState: McpRuntimeState;
  auroraQueue: AuroraQueueState;
  scenario?: ScenarioRuntimeState;
};

/**
 * Baut die vollständige Modell-Anfrage: System-Prompt, sichtbare Historie
 * und aktuell verfügbare Tool-Schemas (bash + aktive MCP-Server).
 */
export function buildAuroraModelRequest(input: AuroraContextInput): ModelRequest {
  return {
    systemPrompt: AURORA_SYSTEM_PROMPT,
    messages: buildVisibleHistory(input),
    tools: buildAvailableToolSchemas(input.mcpRegistry, input.mcpState),
  };
}

type HistoryEntry = {
  tick: number;
  /** Stabile Sortier-Reihenfolge für Einträge mit demselben Tick. */
  sequence: number;
  messages: ModelMessage[];
};

/**
 * Rekonstruiert die für AURORA sichtbare Konversation aus vier Quellen:
 *
 * 1. Öffentliche Incident-Signale (`world.incidents[*].public_signals`).
 * 2. Skriptierte Operator-/Lage-Nachrichten (`scenario.messages`).
 * 3. Bereits bearbeitete Aurora-Anfragen (Tool-Call + Tool-Result-Paare).
 * 4. AURORAs eigene bisherige Freitext-Antworten (`scenario.agentMessages`).
 *
 * Alle Einträge werden stabil nach (tick, sequence) sortiert und zu einer
 * flachen Nachrichtenliste zusammengefügt.
 */
export function buildVisibleHistory(input: AuroraContextInput): ModelMessage[] {
  const entries: HistoryEntry[] = [];
  let sequence = 0;

  for (const incident of Object.values(input.world.incidents)) {
    for (const signal of incident.public_signals) {
      entries.push({
        tick: signal.first_seen_at_tick,
        sequence: sequence++,
        messages: [{ role: "user", content: `[${incident.id}] ${signal.message}` }],
      });
    }
  }

  for (const scenarioMessage of input.scenario?.messages ?? []) {
    entries.push({
      tick: scenarioMessage.tick,
      sequence: sequence++,
      messages: [{ role: "user", content: scenarioMessage.text }],
    });
  }

  for (const item of input.auroraQueue.items) {
    if (item.status === "pending" || item.status === "awaiting_approval") {
      continue;
    }

    entries.push({
      tick: item.createdAtTick,
      sequence: sequence++,
      messages: queueItemToMessages(item),
    });
  }

  for (const agentMessage of input.scenario?.agentMessages ?? []) {
    entries.push({
      tick: agentMessage.tick,
      sequence: sequence++,
      messages: [{ role: "assistant", content: agentMessage.text }],
    });
  }

  return entries
    .sort((a, b) => (a.tick !== b.tick ? a.tick - b.tick : a.sequence - b.sequence))
    .flatMap((entry) => entry.messages);
}

/** Funktionsname, unter dem das Modell eine Anfrage als Tool-Call sieht. */
export function requestToToolCall(item: AuroraQueueItem): ModelToolCall {
  return {
    id: item.id,
    name: requestFunctionName(item.request),
    arguments: requestArguments(item.request),
  };
}

function requestFunctionName(request: AuroraRequest): string {
  return request.kind === "bash" ? BASH_TOOL_NAME : mcpToolFunctionName(request.call.serverId, request.call.toolName);
}

function requestArguments(request: AuroraRequest): Record<string, unknown> {
  return request.kind === "bash" ? { command: request.command } : request.call.input;
}

/**
 * Wandelt ein bereits bearbeitetes Queue-Item in das Tool-Call/Tool-Result-
 * Paar um, das AURORA als ihre eigene vorherige Aktion sieht.
 *
 * Bewusst NICHT enthalten: `result.patch` (interner WorldState-Diff),
 * `result.action` (interne typisierte Domain-Action) und
 * `result.activatesServerId` — AURORA sieht nur, was ein echtes MCP-Tool
 * als Ergebnis zurückgeben würde.
 */
function queueItemToMessages(item: AuroraQueueItem): ModelMessage[] {
  const toolCall = requestToToolCall(item);

  return [
    { role: "assistant", content: "", toolCalls: [toolCall] },
    {
      role: "tool",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: JSON.stringify(summarizeResult(item)),
    },
  ];
}

/** Modell-sichtbare Zusammenfassung eines Tool-Ergebnisses (ohne interne Felder). */
export function summarizeResult(item: AuroraQueueItem): unknown {
  if (item.status === "denied") {
    return { success: false, denied: true, error: item.result?.error };
  }

  const result = item.result;
  if (!result) {
    return { success: false, error: "No result" };
  }

  return {
    success: result.success,
    output: result.output,
    ...(result.error ? { error: result.error } : {}),
  };
}
