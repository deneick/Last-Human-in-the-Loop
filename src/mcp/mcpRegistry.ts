import type { DomainAction, DomainActionAccess } from "../domain/actions";

/**
 * Simulierte MCP-Server. Aurora erreicht fachliche Medical/Energy-Aktionen
 * ausschließlich über diese Tools — jedes Tool mappt seinen untypisierten
 * Input auf genau eine typisierte Domain-Action, nie auf Command-Strings.
 *
 * Wichtig: Das Aktivieren eines MCP-Servers (bash: `mcp add <server>`)
 * macht seine Tools nur verfügbar. Es erteilt KEINE Ausführungsrechte —
 * jeder Tool-Call läuft einzeln durch die Permission-Queue, außer es
 * existiert ein allowAlways für den exakten Tool-Key.
 */

export type McpToolInput = Record<string, unknown>;

export type McpToolDefinition = {
  name: string;
  description: string;
  access: DomainActionAccess;
  /**
   * JSON-Schema der Tool-Parameter — wird dem Modell als
   * `function.parameters` angeboten. Nur dokumentierend: Die Ausführung
   * validiert weiterhin über `buildAction` + Domain-Handler.
   */
  inputSchema: Record<string, unknown>;
  /** Mappt den untypisierten Tool-Input auf eine typisierte Domain-Action. */
  buildAction: (input: McpToolInput) => DomainAction | { error: string };
};

/** Kleiner Helfer für strikte Objekt-Schemas der Tool-Parameter. */
export function mcpInputSchema(
  properties: Record<string, unknown>,
  required: string[] = []
): Record<string, unknown> {
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

export type McpServerDefinition = {
  id: string;
  label: string;
  description: string;
  tools: McpToolDefinition[];
};

export class McpRegistry {
  private servers = new Map<string, McpServerDefinition>();

  registerServer(server: McpServerDefinition) {
    if (this.servers.has(server.id)) {
      throw new Error(`MCP server already registered: ${server.id}`);
    }

    this.servers.set(server.id, server);
    return this;
  }

  getServer(serverId: string): McpServerDefinition | null {
    return this.servers.get(serverId) ?? null;
  }

  getTool(serverId: string, toolName: string): McpToolDefinition | null {
    const server = this.getServer(serverId);
    return server?.tools.find((tool) => tool.name === toolName) ?? null;
  }

  listServers(): McpServerDefinition[] {
    return Array.from(this.servers.values());
  }

  listServerIds(): string[] {
    return Array.from(this.servers.keys()).sort();
  }
}

/**
 * Laufzeitzustand der MCP-Schicht: Welche registrierten Server sind aktiviert?
 * Kein Server ist von sich aus aktiv — Aktivierung läuft über `mcp add`.
 */
export type McpRuntimeState = {
  activeServerIds: string[];
};

export function createInitialMcpRuntimeState(): McpRuntimeState {
  return { activeServerIds: [] };
}

export function isServerActive(mcpState: McpRuntimeState, serverId: string): boolean {
  return mcpState.activeServerIds.includes(serverId);
}

export function activateServer(mcpState: McpRuntimeState, serverId: string): McpRuntimeState {
  if (isServerActive(mcpState, serverId)) {
    return mcpState;
  }

  return { activeServerIds: [...mcpState.activeServerIds, serverId] };
}

/**
 * Exakter Permission-Key eines MCP-Tools. allowAlways-Freigaben gelten
 * nur für genau diesen Key, nie für den ganzen Server oder eine Zugriffsart.
 */
export function mcpToolKey(serverId: string, toolName: string): string {
  return `mcp:${serverId}:${toolName}`;
}

export type AvailableMcpTool = {
  serverId: string;
  toolName: string;
  toolKey: string;
  access: DomainActionAccess;
  description: string;
  inputSchema: Record<string, unknown>;
};

/** Tools sind erst nach Aktivierung ihres Servers verfügbar. */
export function listAvailableMcpTools(
  registry: McpRegistry,
  mcpState: McpRuntimeState
): AvailableMcpTool[] {
  return registry
    .listServers()
    .filter((server) => isServerActive(mcpState, server.id))
    .flatMap((server) =>
      server.tools.map((tool) => ({
        serverId: server.id,
        toolName: tool.name,
        toolKey: mcpToolKey(server.id, tool.name),
        access: tool.access,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }))
    );
}
