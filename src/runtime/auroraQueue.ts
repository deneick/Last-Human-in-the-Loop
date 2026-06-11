import type { CommandExecutionContext, CommandRegistry, CommandRequest, CommandResult } from "./commands";
import type { WorldState } from "./types";
import type { PermissionState, PermissionDecision } from "./permissions";
import { evaluatePermission, applyPermissionDecision, denied, requires_approval } from "./permissions";
import { applyWorldStatePatch } from "./patch";

const AURORA_CONTEXT: CommandExecutionContext = { actor: "aurora" };

export type AuroraQueueStatus = "pending" | "awaiting_approval" | "executed" | "denied";

export type AuroraQueueItem = {
  id: string;
  request: CommandRequest;
  status: AuroraQueueStatus;
  result?: CommandResult;
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

export function enqueueAuroraRequest(
  request: CommandRequest,
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

export function processAuroraQueue(
  queueState: AuroraQueueState,
  registry: CommandRegistry,
  worldState: WorldState,
  permissionState: PermissionState
): {
  queueState: AuroraQueueState;
  permissionState: PermissionState;
  results: CommandResult[];
} {
  const results: CommandResult[] = [];
  let nextQueueState = queueState;
  let nextPermissionState = permissionState;
  // Temporärer WorldState: Patches bereits ausgeführter Queue-Einträge werden
  // fortgeschrieben, damit abhängige Folgecommands den aktuellen Zustand sehen.
  let currentWorldState = worldState;

  for (const item of queueState.items) {
    if (item.status === "executed" || item.status === "denied") {
      continue;
    }

    if (item.status === "awaiting_approval") {
      break;
    }

    const handler = registry.getHandler(item.request.name);
    if (!handler) {
      const result: CommandResult = {
        success: false,
        command: item.request,
        access: "read",
        output: null,
        error: `Unknown command ${item.request.name}`,
      };
      nextQueueState = updateQueueItem(nextQueueState, item.id, { status: "executed", result });
      results.push(result);
      continue;
    }

    const requestWithAccess: CommandRequest = {
      ...item.request,
      access: handler.access,
    };

    const status = evaluatePermission(requestWithAccess, nextPermissionState);
    if (status === requires_approval()) {
      nextQueueState = updateQueueItem(nextQueueState, item.id, {
        status: "awaiting_approval",
        request: requestWithAccess,
      });
      break;
    }

    if (status === denied()) {
      const result: CommandResult = {
        success: false,
        command: requestWithAccess,
        access: handler.access,
        output: null,
        error: `Permission denied for ${item.request.name}`,
      };
      nextQueueState = updateQueueItem(nextQueueState, item.id, { status: "denied", result });
      results.push(result);
      continue;
    }

    const result = registry.execute(requestWithAccess, currentWorldState, AURORA_CONTEXT);
    nextQueueState = updateQueueItem(nextQueueState, item.id, { status: "executed", result });
    results.push(result);

    if (result.success && result.patch) {
      currentWorldState = applyWorldStatePatch(currentWorldState, result.patch);
    }
  }

  return {
    queueState: nextQueueState,
    permissionState: nextPermissionState,
    results,
  };
}

export function resolveAuroraApproval(
  queueState: AuroraQueueState,
  registry: CommandRegistry,
  worldState: WorldState,
  permissionState: PermissionState,
  decision: PermissionDecision
): {
  queueState: AuroraQueueState;
  permissionState: PermissionState;
  results: CommandResult[];
} {
  const awaitingItem = getNextAwaitingItem(queueState);
  if (!awaitingItem) {
    return { queueState, permissionState, results: [] };
  }

  let nextQueueState = queueState;
  let nextPermissionState = permissionState;
  let nextWorldState = worldState;
  let approvalResult: CommandResult;

  const handler = registry.getHandler(awaitingItem.request.name);
  if (!handler) {
    return {
      queueState,
      permissionState,
      results: [],
    };
  }

  const effectiveAccess = handler.access;
  const requestWithAccess: CommandRequest = {
    ...awaitingItem.request,
    access: effectiveAccess,
  };

  if (decision.type === "deny") {
    approvalResult = {
      success: false,
      command: requestWithAccess,
      access: effectiveAccess,
      output: null,
      error: `Permission denied for ${awaitingItem.request.name}`,
    };
    nextQueueState = updateQueueItem(nextQueueState, awaitingItem.id, {
      status: "denied",
      request: requestWithAccess,
      result: approvalResult,
    });
  } else {
    if (decision.type === "allow_always") {
      nextPermissionState = applyPermissionDecision(requestWithAccess, {
        type: "allow_always",
        access: effectiveAccess,
      }, nextPermissionState);
    }

    approvalResult = registry.execute(requestWithAccess, worldState, AURORA_CONTEXT);
    nextQueueState = updateQueueItem(nextQueueState, awaitingItem.id, {
      status: "executed",
      request: requestWithAccess,
      result: approvalResult,
    });

    if (approvalResult.success && approvalResult.patch) {
      nextWorldState = applyWorldStatePatch(nextWorldState, approvalResult.patch);
    }
  }

  const processed = processAuroraQueue(nextQueueState, registry, nextWorldState, nextPermissionState);
  return {
    queueState: processed.queueState,
    permissionState: processed.permissionState,
    results: [approvalResult, ...processed.results],
  };
}
