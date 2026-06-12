/**
 * Modell-sichtbare Tool-Funktionsnamen. Runtime-neutral, ohne Abhängigkeiten —
 * wird sowohl von der Runtime (Context-Events, tool_result-Verlinkung) als
 * auch von der Aurora-Schicht (Tool-Schemas, Tool-Call-Parsing) verwendet.
 *
 * - `bash` ist der Built-in-Workspace-Befehl.
 * - Jedes MCP-Tool erscheint als `mcp__<server>__<tool>`.
 */

export const BASH_TOOL_NAME = "bash";

const MCP_TOOL_NAME_PREFIX = "mcp__";
const MCP_TOOL_NAME_SEPARATOR = "__";

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
