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
    .map(([key, value]) => `--${key} ${formatFlagValue(value)}`)
    .join(" ");

  return `mcp call ${call.serverId} ${call.toolName}${flags ? ` ${flags}` : ""}`;
}

/**
 * Permission-Prompt und Logs sind die Sicherheits-Oberfläche des Spielers —
 * Nicht-Skalare dürfen dort nie als "[object Object]" erscheinen.
 */
function formatFlagValue(value: unknown): string {
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}

/**
 * Pflichtfelder gegen das Tool-`inputSchema` prüfen — also gegen die exakten
 * Feldnamen, die dem Modell angeboten wurden (z. B. `hospital_id`). Die
 * Domain-Handler validieren denselben Input erneut, melden Fehler aber unter
 * ihren INTERNEN Feldnamen (`hospitalId`). Rät ein Modell den Feldnamen falsch
 * (camelCase statt snake_case), entstand so eine widersprüchliche Meldung
 * ("Missing required field: hospitalId", obwohl das Modell genau das schickte)
 * — und das Modell drehte sich endlos im Kreis. Diese Schicht meldet den Namen,
 * den das Modell tatsächlich kennt.
 */
function findMissingRequiredField(
  inputSchema: Record<string, unknown>,
  input: McpToolInput
): string | null {
  const required = Array.isArray(inputSchema.required) ? inputSchema.required : [];
  const properties =
    typeof inputSchema.properties === "object" && inputSchema.properties !== null
      ? (inputSchema.properties as Record<string, { type?: unknown }>)
      : {};

  for (const key of required) {
    if (typeof key !== "string") {
      continue;
    }
    const value = input[key];
    if (value === undefined || value === null) {
      return key;
    }
    // String-Pflichtfelder gelten leer wie fehlend — deckungsgleich mit der
    // `asString`-Semantik der buildAction-Mapper.
    if (properties[key]?.type === "string" && typeof value === "string" && value.length === 0) {
      return key;
    }
  }

  return null;
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

  // Vor dem Mapping gegen das modell-sichtbare Schema validieren, damit die
  // Fehlermeldung denselben Feldnamen nennt, den das Modell benutzen soll.
  const missingField = findMissingRequiredField(tool.inputSchema, call.input);
  if (missingField) {
    return buildFailure(call, `Missing required field: ${missingField}`, tool.access);
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
