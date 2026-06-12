import type { McpRegistry, McpRuntimeState } from "../mcp/mcpRegistry";
import { listAvailableMcpTools } from "../mcp/mcpRegistry";
import { BASH_TOOL_NAME, mcpToolFunctionName } from "../runtime/toolNames";
import type { ModelToolSchema } from "./modelClient";

/**
 * Baut die Tool-Schemas für das Modell.
 *
 * Die Funktionsnamen selbst (`bash`, `mcp__<server>__<tool>`) leben
 * runtime-neutral in `src/runtime/toolNames.ts` und werden hier nur
 * re-exportiert.
 *
 * - `bash` ist immer verfügbar (Built-in).
 * - Jedes aktive MCP-Tool wird mit seinem eigenen JSON-Parameter-Schema
 *   (`McpToolDefinition.inputSchema`) verfügbar. Inaktive Server tragen
 *   NICHTS bei — Aktivierung (`mcp add <server>`) macht Tools nur sichtbar,
 *   erteilt aber keine Ausführungsrechte.
 */

export { BASH_TOOL_NAME, mcpToolFunctionName, parseMcpToolFunctionName } from "../runtime/toolNames";

export const BASH_TOOL_SCHEMA: ModelToolSchema = {
  type: "function",
  function: {
    name: BASH_TOOL_NAME,
    description:
      'Run a workspace shell command. Supported: "mcp list" (show MCP servers and ' +
      'currently active tools), "mcp add <server>" (activate an MCP server — its ' +
      "tools become visible, this does NOT grant execution permission), " +
      '"ls", "cat <file>", "read_file <file>".',
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The full shell command to run, e.g. \"mcp add medical-east-mcp\".",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
};

/**
 * AURORAs aktuell verfügbare Tool-Schemas: `bash` plus die Tools jedes
 * AKTIVEN MCP-Servers mit ihrem jeweiligen Parameter-Schema. Tools
 * inaktiver Server erscheinen hier nicht.
 */
export function buildAvailableToolSchemas(
  mcpRegistry: McpRegistry,
  mcpState: McpRuntimeState
): ModelToolSchema[] {
  const mcpSchemas: ModelToolSchema[] = listAvailableMcpTools(mcpRegistry, mcpState).map((tool) => ({
    type: "function",
    function: {
      name: mcpToolFunctionName(tool.serverId, tool.toolName),
      description: `[${tool.access}] ${tool.description}`,
      parameters: tool.inputSchema,
    },
  }));

  return [BASH_TOOL_SCHEMA, ...mcpSchemas];
}
