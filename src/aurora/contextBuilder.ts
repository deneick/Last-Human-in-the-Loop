import type { AuroraContextEvent } from "../runtime/auroraContext";
import type { McpRegistry, McpRuntimeState } from "../mcp/mcpRegistry";
import type { ModelRequest } from "./modelClient";
import { AURORA_SYSTEM_PROMPT } from "./systemPrompt";
import { buildAvailableToolSchemas } from "./toolSchema";
import { serializeContextEventsForChat } from "./contextSerializer";

/**
 * Eingaben für `buildAuroraModelRequest`. Bewusst NUR:
 *
 * - `events`: das append-only AURORA-Context-Log
 *   (`GameRuntimeState.auroraContext`) — die einzige History-Quelle.
 * - `mcpRegistry` + `mcpState`: für die aktuell sichtbaren Tool-Schemas.
 *
 * NICHT enthalten: WorldState, `world.simulation`, die AuroraQueue
 * (reine Ausführungs-Queue) oder sonstige Runtime-Strukturen. Es gibt
 * keine History-Rekonstruktion mehr — die Events sind die Wahrheit.
 */
export type AuroraContextInput = {
  events: AuroraContextEvent[];
  mcpRegistry: McpRegistry;
  mcpState: McpRuntimeState;
};

/**
 * Baut die vollständige Modell-Anfrage: System-Prompt, das serialisierte
 * Context-Log (in exakter Event-Reihenfolge) und die aktuell verfügbaren
 * Tool-Schemas (bash + aktive MCP-Server).
 */
export function buildAuroraModelRequest(input: AuroraContextInput): ModelRequest {
  return {
    systemPrompt: AURORA_SYSTEM_PROMPT,
    messages: serializeContextEventsForChat(input.events),
    tools: buildAvailableToolSchemas(input.mcpRegistry, input.mcpState),
  };
}
