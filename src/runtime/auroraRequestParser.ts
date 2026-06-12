import type { AuroraRequest } from "./auroraQueue";
import { bashRequest, mcpToolRequest } from "./auroraQueue";
import { isGenericBashCommandText } from "./bashCommands";
import { parseCommandText } from "./commandParser";

/**
 * Parser für die Aurora-Eingabezeile der UI. Aurora kennt nur zwei
 * Anfrageformen:
 *
 *   mcp call <server> <tool> [--key value ...]   → simulierter MCP-Tool-Call
 *   mcp list | mcp add <server> | ls | cat | read_file → generische Bash
 *
 * Fachliche Text-Commands (medical.* / energy.*) sind hier bewusst
 * NICHT mehr ansprechbar — Aurora ruft Domain-Actions nie direkt auf.
 */
export function parseAuroraRequestText(raw: string): AuroraRequest | { error: string } {
  const parsed = parseCommandText(raw);

  if (!parsed.name) {
    return { error: "Empty request" };
  }

  if (parsed.name === "mcp" && parsed.args[0] === "call") {
    const serverId = parsed.args[1];
    const toolName = parsed.args[2];

    if (!serverId || !toolName) {
      return { error: "Usage: mcp call <server> <tool> [--key value ...]" };
    }

    return mcpToolRequest(serverId, toolName, { ...parsed.flags });
  }

  if (isGenericBashCommandText(raw)) {
    return bashRequest(raw.trim());
  }

  return {
    error:
      `Unknown request format: ${parsed.name}. ` +
      "Aurora unterstützt nur generische Bash-Commands und `mcp call <server> <tool> ...`.",
  };
}
