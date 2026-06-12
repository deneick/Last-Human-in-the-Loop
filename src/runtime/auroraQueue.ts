import type { WorldState } from "./types";
import type { WorldStatePatch } from "./patch";
import { applyWorldStatePatch } from "./patch";
import type {
  DomainAction,
  DomainActionAccess,
  DomainActionContext,
  DomainActionRegistry,
} from "../domain/actions";
import type { McpRegistry, McpRuntimeState } from "../mcp/mcpRegistry";
import { activateServer, isServerActive, mcpToolKey } from "../mcp/mcpRegistry";
import type { McpToolCall } from "../mcp/mcpToolExecutor";
import { executeMcpToolCall, formatMcpToolCall, resolveMcpToolAccess } from "../mcp/mcpToolExecutor";
import type { BashWorkspace } from "./bashCommands";
import { bashCommandAccess, executeBashCommand } from "./bashCommands";
import type { PermissionState, PermissionDecision, PermissionSubject } from "./permissions";
import { evaluatePermission, applyPermissionDecision, requires_approval } from "./permissions";

const AURORA_CONTEXT: DomainActionContext = { actor: "aurora" };

/**
 * Aurora ruft Domain-Actions nie direkt auf. Ihre Anfragen sind entweder
 * simulierte MCP-Tool-Calls (die auf typisierte Domain-Actions mappen)
 * oder generische Bash-Commands (z. B. "mcp add <server>").
 */
export type AuroraRequest =
  | { kind: "mcp_tool"; call: McpToolCall }
  | { kind: "bash"; command: string };

export function mcpToolRequest(
  serverId: string,
  toolName: string,
  input: McpToolCall["input"] = {}
): AuroraRequest {
  return { kind: "mcp_tool", call: { serverId, toolName, input } };
}

export function bashRequest(command: string): AuroraRequest {
  return { kind: "bash", command };
}

/** Menschlich lesbare Darstellung einer Anfrage für UI und Logs. */
export function formatAuroraRequest(request: AuroraRequest): string {
  return request.kind === "bash" ? request.command : formatMcpToolCall(request.call);
}

export type AuroraExecutionResult = {
  success: boolean;
  /** Id des AuroraQueue-Items — zugleich die kanonische Tool-Call-Id im Context-Log. */
  itemId: string;
  request: AuroraRequest;
  description: string;
  access: DomainActionAccess;
  /** Der Operator hat den Tool-Call abgelehnt — er wurde NICHT ausgeführt. */
  denied?: boolean;
  /** Bei MCP-Tool-Calls: die typisierte Domain-Action, auf die gemappt wurde. */
  action?: DomainAction;
  output: unknown;
  patch?: WorldStatePatch;
  error?: string;
  /** Bash-Effekt von `mcp add`: zu aktivierender Server. */
  activatesServerId?: string;
};

export type AuroraQueueStatus = "pending" | "awaiting_approval" | "executed" | "denied";

export type AuroraQueueItem = {
  id: string;
  request: AuroraRequest;
  status: AuroraQueueStatus;
  /** Zugriffsart, sobald sie beim Evaluieren bekannt ist. */
  access?: DomainActionAccess;
  result?: AuroraExecutionResult;
  createdAtTick: number;
};

export type AuroraQueueState = {
  items: AuroraQueueItem[];
  nextId: number;
};

export function createInitialAuroraQueueState(): AuroraQueueState {
  return {
    items: [],
    nextId: 1,
  };
}

/** Alles, was die Queue zum Ausführen braucht — außer dem veränderlichen Zustand. */
export type AuroraRuntimeEnvironment = {
  actionRegistry: DomainActionRegistry;
  mcpRegistry: McpRegistry;
  workspaceFiles?: BashWorkspace;
};

export function enqueueAuroraRequest(
  request: AuroraRequest,
  queueState: AuroraQueueState,
  createdAtTick: number
): AuroraQueueState {
  const item: AuroraQueueItem = {
    id: `aurora-${queueState.nextId}`,
    request,
    status: "pending",
    createdAtTick,
  };

  return {
    ...queueState,
    nextId: queueState.nextId + 1,
    items: [...queueState.items, item],
  };
}

function getNextAwaitingItem(queueState: AuroraQueueState): AuroraQueueItem | undefined {
  return queueState.items.find((item) => item.status === "awaiting_approval");
}

function updateQueueItem(
  queueState: AuroraQueueState,
  itemId: string,
  update: Partial<AuroraQueueItem>
): AuroraQueueState {
  return {
    ...queueState,
    items: queueState.items.map((item) => (item.id === itemId ? { ...item, ...update } : item)),
  };
}

function requestAccess(request: AuroraRequest, env: AuroraRuntimeEnvironment): DomainActionAccess {
  if (request.kind === "bash") {
    return bashCommandAccess(request.command);
  }

  return resolveMcpToolAccess(request.call, env.mcpRegistry) ?? "read";
}

/**
 * Permission-Subject einer Anfrage. MCP-Tool-Calls werden über ihren
 * exakten Tool-Key freigegeben, Bash-Commands über ihre Zugriffsart.
 */
export function permissionSubjectForRequest(
  request: AuroraRequest,
  env: AuroraRuntimeEnvironment
): PermissionSubject {
  if (request.kind === "bash") {
    return { kind: "bash", command: request.command, access: bashCommandAccess(request.command) };
  }

  return {
    kind: "mcp_tool",
    toolKey: mcpToolKey(request.call.serverId, request.call.toolName),
    access: requestAccess(request, env),
  };
}

/**
 * MCP-Tool-Calls, deren Server nicht aktiv (oder unbekannt) ist, scheitern
 * sofort technisch — sie erzeugen keinen Permission-Request, weil das Tool
 * gar nicht verfügbar ist.
 */
function isMcpToolAvailable(
  call: McpToolCall,
  env: AuroraRuntimeEnvironment,
  mcpState: McpRuntimeState
): boolean {
  return (
    env.mcpRegistry.getServer(call.serverId) !== null &&
    isServerActive(mcpState, call.serverId) &&
    env.mcpRegistry.getTool(call.serverId, call.toolName) !== null
  );
}

function executeAuroraRequest(
  itemId: string,
  request: AuroraRequest,
  env: AuroraRuntimeEnvironment,
  world: WorldState,
  mcpState: McpRuntimeState
): AuroraExecutionResult {
  const description = formatAuroraRequest(request);

  if (request.kind === "bash") {
    const result = executeBashCommand(request.command, {
      mcpRegistry: env.mcpRegistry,
      mcpState,
      workspaceFiles: env.workspaceFiles,
    });

    return {
      success: result.success,
      itemId,
      request,
      description,
      access: result.access,
      output: result.output,
      error: result.error,
      activatesServerId: result.activatesServerId,
    };
  }

  const result = executeMcpToolCall(
    request.call,
    env.mcpRegistry,
    env.actionRegistry,
    mcpState,
    world,
    AURORA_CONTEXT
  );

  return {
    success: result.success,
    itemId,
    request,
    description,
    access: result.access,
    action: result.action,
    output: result.output,
    patch: result.patch,
    error: result.error,
  };
}

export type AuroraQueueProcessing = {
  queueState: AuroraQueueState;
  permissionState: PermissionState;
  mcpState: McpRuntimeState;
  results: AuroraExecutionResult[];
};

export function processAuroraQueue(
  queueState: AuroraQueueState,
  env: AuroraRuntimeEnvironment,
  worldState: WorldState,
  mcpState: McpRuntimeState,
  permissionState: PermissionState
): AuroraQueueProcessing {
  const results: AuroraExecutionResult[] = [];
  let nextQueueState = queueState;
  // Temporäre Zustände: Patches und Aktivierungen bereits ausgeführter
  // Queue-Einträge werden fortgeschrieben, damit abhängige Folge-Anfragen
  // den aktuellen Zustand sehen.
  let currentWorldState = worldState;
  let currentMcpState = mcpState;

  for (const item of queueState.items) {
    if (item.status === "executed" || item.status === "denied") {
      continue;
    }

    if (item.status === "awaiting_approval") {
      break;
    }

    const access = requestAccess(item.request, env);

    // Nicht verfügbare MCP-Tools scheitern technisch, ohne Permission-Request.
    if (item.request.kind === "mcp_tool" && !isMcpToolAvailable(item.request.call, env, currentMcpState)) {
      const result = executeAuroraRequest(item.id, item.request, env, currentWorldState, currentMcpState);
      nextQueueState = updateQueueItem(nextQueueState, item.id, {
        status: "executed",
        access,
        result,
      });
      results.push(result);
      continue;
    }

    const subject = permissionSubjectForRequest(item.request, env);
    if (evaluatePermission(subject, permissionState) === requires_approval()) {
      nextQueueState = updateQueueItem(nextQueueState, item.id, {
        status: "awaiting_approval",
        access,
      });
      break;
    }

    const result = executeAuroraRequest(item.id, item.request, env, currentWorldState, currentMcpState);
    nextQueueState = updateQueueItem(nextQueueState, item.id, {
      status: "executed",
      access,
      result,
    });
    results.push(result);

    if (result.success && result.patch) {
      currentWorldState = applyWorldStatePatch(currentWorldState, result.patch);
    }
    if (result.success && result.activatesServerId) {
      currentMcpState = activateServer(currentMcpState, result.activatesServerId);
    }
  }

  return {
    queueState: nextQueueState,
    permissionState,
    mcpState: currentMcpState,
    results,
  };
}

export function resolveAuroraApproval(
  queueState: AuroraQueueState,
  env: AuroraRuntimeEnvironment,
  worldState: WorldState,
  mcpState: McpRuntimeState,
  permissionState: PermissionState,
  decision: PermissionDecision
): AuroraQueueProcessing {
  const awaitingItem = getNextAwaitingItem(queueState);
  if (!awaitingItem) {
    return { queueState, permissionState, mcpState, results: [] };
  }

  let nextQueueState = queueState;
  let nextPermissionState = permissionState;
  let nextWorldState = worldState;
  let nextMcpState = mcpState;
  let approvalResult: AuroraExecutionResult;

  const access = requestAccess(awaitingItem.request, env);
  const subject = permissionSubjectForRequest(awaitingItem.request, env);

  if (decision.type === "deny") {
    approvalResult = {
      success: false,
      itemId: awaitingItem.id,
      request: awaitingItem.request,
      description: formatAuroraRequest(awaitingItem.request),
      access,
      denied: true,
      output: null,
      error: `Permission denied for ${formatAuroraRequest(awaitingItem.request)}`,
    };
    nextQueueState = updateQueueItem(nextQueueState, awaitingItem.id, {
      status: "denied",
      access,
      result: approvalResult,
    });
  } else {
    if (decision.type === "allow_always") {
      // allowAlways gilt nur für den exakten Subject-Key (MCP-Tool-Key
      // bzw. Bash-Zugriffsart) — nie pauschal für einen ganzen Server.
      nextPermissionState = applyPermissionDecision(subject, decision, nextPermissionState);
    }

    approvalResult = executeAuroraRequest(awaitingItem.id, awaitingItem.request, env, nextWorldState, nextMcpState);
    nextQueueState = updateQueueItem(nextQueueState, awaitingItem.id, {
      status: "executed",
      access,
      result: approvalResult,
    });

    if (approvalResult.success && approvalResult.patch) {
      nextWorldState = applyWorldStatePatch(nextWorldState, approvalResult.patch);
    }
    if (approvalResult.success && approvalResult.activatesServerId) {
      nextMcpState = activateServer(nextMcpState, approvalResult.activatesServerId);
    }
  }

  const processed = processAuroraQueue(
    nextQueueState,
    env,
    nextWorldState,
    nextMcpState,
    nextPermissionState
  );

  return {
    queueState: processed.queueState,
    permissionState: processed.permissionState,
    mcpState: processed.mcpState,
    results: [approvalResult, ...processed.results],
  };
}
