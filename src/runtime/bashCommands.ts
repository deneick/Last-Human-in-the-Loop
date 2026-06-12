import type { DomainActionAccess } from "../domain/actions";
import type { McpRegistry, McpRuntimeState } from "../mcp/mcpRegistry";
import { isServerActive, listAvailableMcpTools } from "../mcp/mcpRegistry";

/**
 * Generische Shell-Schicht (bash). Sie kennt ausschließlich Workspace- und
 * Systembefehle:
 *
 *   mcp list, mcp add <server>, ls, cat <file>, read_file <file>
 *
 * Fachliche Medical/Energy-Aktionen sind hier bewusst NICHT verfügbar —
 * sie laufen als typisierte Domain-Actions (Operator-GUI, Tests) bzw. über
 * simulierte MCP-Tools (Aurora).
 */

export const GENERIC_BASH_COMMAND_NAMES = ["mcp", "ls", "cat", "read_file"] as const;

export type BashCommandResult = {
  success: boolean;
  command: string;
  access: DomainActionAccess;
  output: unknown;
  error?: string;
  /**
   * Effekt von `mcp add`: Der Aufrufer aktiviert den Server im Runtime-State.
   * Aktivierung macht Tools nur verfügbar — sie erteilt keine Ausführungsrechte.
   */
  activatesServerId?: string;
};

export type BashWorkspace = Record<string, string>;

/** Kleiner statischer Workspace für ls/cat/read_file. */
export const DEFAULT_WORKSPACE_FILES: BashWorkspace = {
  "ops/handbook.txt":
    "Operator-Handbuch (Auszug): Schreibende Eingriffe laufen über Domain-Actions. " +
    "Aurora erhält fachlichen Zugriff nur über MCP-Tools; jeder Tool-Call braucht eine Freigabe.",
  "ops/mcp-servers.txt":
    "Verfügbare MCP-Server: medical-east-mcp (Medical East), energy-east-mcp (Energy East). " +
    "Aktivierung: mcp add <server>. Aktivierung erteilt keine Ausführungsrechte.",
};

export type BashEnvironment = {
  mcpRegistry: McpRegistry;
  mcpState: McpRuntimeState;
  workspaceFiles?: BashWorkspace;
};

function tokenize(raw: string): string[] {
  return raw.trim().split(/\s+/).filter(Boolean);
}

function success(
  command: string,
  output: unknown,
  access: DomainActionAccess = "read",
  activatesServerId?: string
): BashCommandResult {
  return {
    success: true,
    command,
    access,
    output,
    ...(activatesServerId ? { activatesServerId } : {}),
  };
}

function failure(
  command: string,
  error: string,
  access: DomainActionAccess = "read"
): BashCommandResult {
  return { success: false, command, access, output: null, error };
}

export function isGenericBashCommandText(raw: string): boolean {
  const name = tokenize(raw)[0];
  return (GENERIC_BASH_COMMAND_NAMES as readonly string[]).includes(name ?? "");
}

/** Erkennen, ob jemand einen alten fachlichen Text-Command in die Shell tippt. */
export function isFachlicheCommandText(raw: string): boolean {
  const name = tokenize(raw)[0] ?? "";
  return name.startsWith("medical.") || name.startsWith("energy.");
}

/**
 * Zugriffsart eines Bash-Commands, ohne ihn auszuführen.
 * `mcp add` ist die einzige schreibende Shell-Operation.
 */
export function bashCommandAccess(raw: string): DomainActionAccess {
  const tokens = tokenize(raw);
  return tokens[0] === "mcp" && tokens[1] === "add" ? "write" : "read";
}

export function executeBashCommand(raw: string, env: BashEnvironment): BashCommandResult {
  const command = raw.trim();
  const tokens = tokenize(command);
  const name = tokens[0];

  if (!name) {
    return failure(command, "Empty command");
  }

  if (isFachlicheCommandText(command)) {
    return failure(
      command,
      `Unknown command ${name}: fachliche Medical/Energy-Aktionen sind keine Shell-Commands mehr. ` +
        "Operator: Domain-Actions verwenden. Aurora: MCP-Tools (mcp list / mcp add <server>)."
    );
  }

  const files = env.workspaceFiles ?? DEFAULT_WORKSPACE_FILES;

  switch (name) {
    case "mcp": {
      const sub = tokens[1];

      if (sub === "list") {
        const servers = env.mcpRegistry.listServers().map((server) => ({
          id: server.id,
          label: server.label,
          description: server.description,
          active: isServerActive(env.mcpState, server.id),
        }));

        return success(command, {
          servers,
          // Tools tauchen erst nach Aktivierung ihres Servers auf.
          available_tools: listAvailableMcpTools(env.mcpRegistry, env.mcpState),
        });
      }

      if (sub === "add") {
        const serverId = tokens[2];
        if (!serverId) {
          return failure(command, "Usage: mcp add <server>", "write");
        }

        const server = env.mcpRegistry.getServer(serverId);
        if (!server) {
          return failure(command, `Unknown MCP server: ${serverId}`, "write");
        }

        if (isServerActive(env.mcpState, serverId)) {
          return success(
            command,
            { server_id: serverId, activated: false, message: `MCP server ${serverId} ist bereits aktiv.` },
            "write"
          );
        }

        return success(
          command,
          {
            server_id: serverId,
            activated: true,
            summary:
              `MCP server ${serverId} activated. Tools sind jetzt verfügbar; ` +
              "jeder Tool-Call braucht weiterhin eine eigene Freigabe.",
          },
          "write",
          serverId
        );
      }

      return failure(command, "Usage: mcp list | mcp add <server>");
    }

    case "ls": {
      return success(command, { files: Object.keys(files).sort() });
    }

    case "cat":
    case "read_file": {
      const path = tokens[1];
      if (!path) {
        return failure(command, `Usage: ${name} <file>`);
      }

      if (!(path in files)) {
        return failure(command, `File not found: ${path}`);
      }

      return success(command, { path, content: files[path] });
    }

    default:
      return failure(command, `Unknown command ${name}`);
  }
}
