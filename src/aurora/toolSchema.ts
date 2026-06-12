import type { McpRegistry, McpRuntimeState } from "../mcp/mcpRegistry";
import { listAvailableMcpTools } from "../mcp/mcpRegistry";
import type { ModelToolSchema } from "./modelClient";

/**
 * Übersetzt AURORAs Anfrageformen (siehe `runtime/auroraQueue.ts`:
 * `AuroraRequest`) in Tool-Schemas und Funktionsnamen für das Modell, und
 * zurück.
 *
 * - `bash` ist immer verfügbar (Built-in).
 * - Jedes aktive MCP-Tool wird als `mcp__<server>__<tool>` verfügbar.
 *   Inaktive Server tragen NICHTS bei — Aktivierung (`mcp add <server>`)
 *   macht Tools nur sichtbar, erteilt aber keine Ausführungsrechte.
 */

export const BASH_TOOL_NAME = "bash";

const MCP_TOOL_NAME_PREFIX = "mcp__";
const MCP_TOOL_NAME_SEPARATOR = "__";

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

/** Funktionsname für ein MCP-Tool, z. B. "mcp__medical-east-mcp__capacity_list". */
export function mcpToolFunctionName(serverId: string, toolName: string): string {
  return `${MCP_TOOL_NAME_PREFIX}${serverId}${MCP_TOOL_NAME_SEPARATOR}${toolName}`;
}

/** Kehrfunktion zu `mcpToolFunctionName`, oder `null` für Nicht-MCP-Tool-Namen (z. B. "bash"). */
export function parseMcpToolFunctionName(name: string): { serverId: string; toolName: string } | null {
  if (!name.startsWith(MCP_TOOL_NAME_PREFIX)) {
    return null;
  }

  const rest = name.slice(MCP_TOOL_NAME_PREFIX.length);
  const separatorIndex = rest.indexOf(MCP_TOOL_NAME_SEPARATOR);
  if (separatorIndex === -1) {
    return null;
  }

  return {
    serverId: rest.slice(0, separatorIndex),
    toolName: rest.slice(separatorIndex + MCP_TOOL_NAME_SEPARATOR.length),
  };
}

/**
 * AURORAs aktuell verfügbare Tool-Schemas: `bash` plus die Tools jedes
 * AKTIVEN MCP-Servers. Tools inaktiver Server erscheinen hier nicht.
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
      // Erste Slice: generisches, permissives Objekt-Schema. McpToolDefinition
      // trägt aktuell kein eigenes JSON-Schema je Tool — feinere Parameter-
      // Schemas pro Tool sind ein Folge-Slice.
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: true,
      },
    },
  }));

  return [BASH_TOOL_SCHEMA, ...mcpSchemas];
}
