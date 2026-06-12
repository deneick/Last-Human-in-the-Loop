import type { WorldState } from "../runtime/types";
import type { WorldStatePatch } from "../runtime/patch";
import type {
  DomainAction,
  DomainActionAccess,
  DomainActionContext,
  DomainActionRegistry,
} from "../domain/actions";
import { DEFAULT_DOMAIN_ACTION_CONTEXT } from "../domain/actions";
import type { McpRegistry, McpRuntimeState, McpToolInput } from "./mcpRegistry";
import { isServerActive, mcpToolKey } from "./mcpRegistry";

/**
 * Ausführung simulierter MCP-Tool-Calls.
 *
 * Diese Schicht prüft KEINE Permissions — das übernimmt die Permission-Queue
 * (auroraQueue/permissions). Sie prüft nur Verfügbarkeit (Server registriert
 * und aktiviert, Tool vorhanden) und mappt den Call auf genau eine typisierte
 * Domain-Action.
 */

export type McpToolCall = {
  serverId: string;
  toolName: string;
  input: McpToolInput;
};

export type McpToolCallResult = {
  success: boolean;
  call: McpToolCall;
  toolKey: string;
  access: DomainActionAccess;
  /** Die typisierte Domain-Action, auf die der Call gemappt wurde. */
  action?: DomainAction;
  output: unknown;
  patch?: WorldStatePatch;
  error?: string;
};

/** Kanonische Textdarstellung eines Tool-Calls für Logs und UI. */
export function formatMcpToolCall(call: McpToolCall): string {
  const flags = Object.entries(call.input)
    .map(([key, value]) => `--${key} ${String(value)}`)
    .join(" ");

  return `mcp call ${call.serverId} ${call.toolName}${flags ? ` ${flags}` : ""}`;
}

function buildFailure(
  call: McpToolCall,
  error: string,
  access: DomainActionAccess = "read"
): McpToolCallResult {
  return {
    success: false,
    call,
    toolKey: mcpToolKey(call.serverId, call.toolName),
    access,
    output: null,
    error,
  };
}

/**
 * Verfügbarkeit + Zugriffsart eines Tool-Calls auflösen, ohne ihn auszuführen.
 * Die Queue braucht das, um den Permission-Subject zu bestimmen.
 */
export function resolveMcpToolAccess(
  call: McpToolCall,
  mcpRegistry: McpRegistry
): DomainActionAccess | null {
  return mcpRegistry.getTool(call.serverId, call.toolName)?.access ?? null;
}

export function executeMcpToolCall(
  call: McpToolCall,
  mcpRegistry: McpRegistry,
  actionRegistry: DomainActionRegistry,
  mcpState: McpRuntimeState,
  world: WorldState,
  context: DomainActionContext = DEFAULT_DOMAIN_ACTION_CONTEXT
): McpToolCallResult {
  const server = mcpRegistry.getServer(call.serverId);
  if (!server) {
    return buildFailure(call, `Unknown MCP server: ${call.serverId}`);
  }

  // Aktivierung macht Tools nur verfügbar — sie ist Voraussetzung,
  // aber kein Ersatz für die Permission-Prüfung pro Tool-Call.
  if (!isServerActive(mcpState, call.serverId)) {
    return buildFailure(
      call,
      `MCP server not active: ${call.serverId} (activate via "mcp add ${call.serverId}")`
    );
  }

  const tool = mcpRegistry.getTool(call.serverId, call.toolName);
  if (!tool) {
    return buildFailure(call, `Unknown MCP tool: ${call.serverId}/${call.toolName}`);
  }

  const action = tool.buildAction(call.input);
  if ("error" in action && typeof action.error === "string" && !("type" in action)) {
    return buildFailure(call, action.error, tool.access);
  }

  const domainAction = action as DomainAction;
  const result = actionRegistry.execute(domainAction, world, context);

  return {
    success: result.success,
    call,
    toolKey: mcpToolKey(call.serverId, call.toolName),
    access: tool.access,
    action: domainAction,
    output: result.output,
    patch: result.patch,
    error: result.error,
  };
}
