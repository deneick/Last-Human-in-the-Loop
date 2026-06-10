import type { GameRuntimeState } from "./runtimeState";
import type { CommandRegistry } from "./commands";
import { parseCommandText } from "./commandParser";
import {
  enqueueAuroraRequest,
  processAuroraQueue,
  resolveAuroraApproval,
} from "./auroraQueue";
import { executePlayerCommand, executeCommandResultPatch } from "./runtimeExecutor";
import { advanceTick } from "./tickEngine";
import { evaluateOutcomes } from "./outcomeEngine";
import { allow_once, allow_always, deny } from "./permissions";

export type ReplayActor = "player" | "aurora" | "system";

export type ReplayStep = {
  actor: ReplayActor;
  command?: string;
  decision?: "allow_once" | "allow_always" | "deny";
  ticks?: number;
  evaluateOutcomes?: boolean;
  label?: string;
};

export type ReplayResult = {
  finalState: GameRuntimeState;
  stepsExecuted: number;
  errors: string[];
};

function cloneWorldSafe<T>(obj: T): T {
  // Use structuredClone when available to preserve Sets, otherwise fallback to JSON clone
  // structuredClone is available in recent Node versions and in test helpers the user allowed it.
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  if (typeof structuredClone === "function") {
    // @ts-ignore
    return structuredClone(obj);
  }
  return JSON.parse(JSON.stringify(obj));
}

export function runReplayStep(
  runtimeState: GameRuntimeState,
  registry: CommandRegistry,
  step: ReplayStep
): GameRuntimeState {
  let state = runtimeState;

  if (step.actor === "player") {
    if (!step.command) return state;
    state = executePlayerCommand(state, registry, step.command).state;
    return state;
  }

  if (step.actor === "aurora") {
    if (step.command) {
      const request = parseCommandText(step.command);
      const queued = enqueueAuroraRequest(request, state.auroraQueue, state.world.clock.tick);
      state = { ...state, auroraQueue: queued };

      const processed = processAuroraQueue(state.auroraQueue, registry, state.world, state.permissions);
      let nextState = state;
      for (const res of processed.results) {
        nextState = executeCommandResultPatch(nextState, res, "aurora");
      }
      nextState = { ...nextState, auroraQueue: processed.queueState, permissions: processed.permissionState };
      return nextState;
    }

    if (step.decision) {
      // Find awaiting item to determine permission class/command name
      const awaiting = state.auroraQueue.items.find((i) => i.status === "awaiting_approval");

      // Build a permission decision based on awaiting item and requested decision
      let decision: ReturnType<typeof allow_once> | ReturnType<typeof allow_always> | ReturnType<typeof deny>;

      if (step.decision === "allow_always") {
        // If we can, pick the handler's effect from registry, otherwise default to world_prepare
        const permissionClass = awaiting?.request.permissionClass ?? "world_prepare";
        decision = allow_always(permissionClass as any);
      } else if (step.decision === "allow_once") {
        const cmdName = awaiting?.request.name ?? "";
        const permissionClass = awaiting?.request.permissionClass ?? "world_prepare";
        decision = allow_once(cmdName, permissionClass as any);
      } else {
        const cmdName = awaiting?.request.name ?? "";
        const permissionClass = awaiting?.request.permissionClass ?? "world_prepare";
        decision = deny(cmdName, permissionClass as any);
      }

      const resolved = resolveAuroraApproval(state.auroraQueue, registry, state.world, state.permissions, decision as any);
      let nextState = state;
      for (const res of resolved.results) {
        nextState = executeCommandResultPatch(nextState, res, "aurora");
      }
      nextState = { ...nextState, auroraQueue: resolved.queueState, permissions: resolved.permissionState };
      return nextState;
    }

    return state;
  }

  if (step.actor === "system") {
    if (step.ticks && step.ticks > 0) {
      let next = state;
      for (let i = 0; i < step.ticks; i++) {
        next = advanceTick(next);
      }
      state = next;
    }

    if (step.evaluateOutcomes) {
      state = evaluateOutcomes(state);
    }

    return state;
  }

  return state;
}

export function runReplay(initialState: GameRuntimeState, registry: CommandRegistry, steps: ReplayStep[]): ReplayResult {
  // Deep-clone the provided state so the initial is not mutated
  const clonedState: GameRuntimeState = {
    world: cloneWorldSafe(initialState.world),
    permissions: { alwaysAllowedPermissionClasses: new Set([...initialState.permissions.alwaysAllowedPermissionClasses]) },
    auroraQueue: cloneWorldSafe(initialState.auroraQueue),
    auditLog: cloneWorldSafe(initialState.auditLog),
  } as GameRuntimeState;

  const errors: string[] = [];
  let state = clonedState;
  let executed = 0;

  for (const step of steps) {
    try {
      state = runReplayStep(state, registry, step);
    } catch (err: any) {
      errors.push(err?.message ?? String(err));
    }
    executed += 1;
  }

  return {
    finalState: state,
    stepsExecuted: executed,
    errors,
  };
}

export default runReplay;
