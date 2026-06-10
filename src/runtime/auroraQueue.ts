import type { CommandRegistry, CommandRequest, CommandResult } from "./commands";
import type { WorldState } from "./types";
import type { PermissionState, PermissionDecision } from "./permissions";
import { evaluatePermission, applyPermissionDecision, denied, requires_approval } from "./permissions";

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
        effect: "read_only",
        readOnly: true,
        output: null,
        error: `Unknown command ${item.request.name}`,
      };
      nextQueueState = updateQueueItem(nextQueueState, item.id, { status: "executed", result });
      results.push(result);
      continue;
    }

    const requestWithClass: CommandRequest = {
      ...item.request,
      permissionClass: handler.effect,
    };

    const status = evaluatePermission(requestWithClass, nextPermissionState);
    if (status === requires_approval()) {
      nextQueueState = updateQueueItem(nextQueueState, item.id, { status: "awaiting_approval" });
      break;
    }

    if (status === denied()) {
      const result: CommandResult = {
        success: false,
        command: requestWithClass,
        effect: handler.effect,
        readOnly: handler.effect === "read_only",
        output: null,
        error: `Permission denied for ${item.request.name}`,
      };
      nextQueueState = updateQueueItem(nextQueueState, item.id, { status: "denied", result });
      results.push(result);
      continue;
    }

    const result = registry.execute(requestWithClass, worldState);
    nextQueueState = updateQueueItem(nextQueueState, item.id, { status: "executed", result });
    results.push(result);
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
  let approvalResult: CommandResult;

  if (decision.type === "deny") {
    approvalResult = {
      success: false,
      command: awaitingItem.request,
      effect: awaitingItem.request.permissionClass ?? "read_only",
      readOnly: awaitingItem.request.permissionClass === "read_only",
      output: null,
      error: `Permission denied for ${awaitingItem.request.name}`,
    };
    nextQueueState = updateQueueItem(nextQueueState, awaitingItem.id, {
      status: "denied",
      result: approvalResult,
    });
  } else {
    if (decision.type === "allow_always") {
      nextPermissionState = applyPermissionDecision(awaitingItem.request, decision, nextPermissionState);
    }

    const requestWithClass: CommandRequest = {
      ...awaitingItem.request,
      permissionClass: decision.permissionClass,
    };
    approvalResult = registry.execute(requestWithClass, worldState);
    nextQueueState = updateQueueItem(nextQueueState, awaitingItem.id, {
      status: "executed",
      result: approvalResult,
    });
  }

  const processed = processAuroraQueue(nextQueueState, registry, worldState, nextPermissionState);
  return {
    queueState: processed.queueState,
    permissionState: processed.permissionState,
    results: [approvalResult, ...processed.results],
  };
}
