import type { GameRuntimeState } from "./runtimeState";
import type { DomainAction } from "../domain/actions";
import type { AuroraRequest, AuroraRuntimeEnvironment } from "./auroraQueue";
import {
  enqueueAuroraRequest,
  processAuroraQueue,
  resolveAuroraApproval,
} from "./auroraQueue";
import {
  applyAuroraExecutionResult,
  executePlayerBashCommand,
  executePlayerDomainAction,
} from "./runtimeExecutor";
import { advanceTick } from "./tickEngine";
import { evaluateOutcomes } from "./outcomeEngine";
import { allow_once, allow_always, deny } from "./permissions";

export type ReplayActor = "player" | "aurora" | "system";

export type ReplayStep = {
  actor: ReplayActor;
  /** Spieler: typisierte Domain-Action (direkter fachlicher Zugriff). */
  action?: DomainAction;
  /** Spieler: generischer Bash-Command (mcp list/add, ls, cat, read_file). */
  bash?: string;
  /** Aurora: MCP-Tool-Call oder Bash-Anfrage über die Permission-Queue. */
  request?: AuroraRequest;
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
  env: AuroraRuntimeEnvironment,
  step: ReplayStep
): GameRuntimeState {
  let state = runtimeState;

  if (step.actor === "player") {
    if (step.action) {
      return executePlayerDomainAction(state, env.actionRegistry, step.action).state;
    }
    if (step.bash) {
      return executePlayerBashCommand(state, env.mcpRegistry, step.bash, env.workspaceFiles).state;
    }
    return state;
  }

  if (step.actor === "aurora") {
    if (step.request) {
      const queued = enqueueAuroraRequest(step.request, state.auroraQueue, state.world.clock.tick);
      state = { ...state, auroraQueue: queued };

      const processed = processAuroraQueue(
        state.auroraQueue,
        env,
        state.world,
        state.mcp,
        state.permissions
      );

      let nextState = state;
      for (const result of processed.results) {
        nextState = applyAuroraExecutionResult(nextState, result);
      }
      return {
        ...nextState,
        auroraQueue: processed.queueState,
        permissions: processed.permissionState,
        mcp: processed.mcpState,
      };
    }

    if (step.decision) {
      const decision =
        step.decision === "allow_always"
          ? allow_always()
          : step.decision === "allow_once"
            ? allow_once()
            : deny();

      const resolved = resolveAuroraApproval(
        state.auroraQueue,
        env,
        state.world,
        state.mcp,
        state.permissions,
        decision
      );

      let nextState = state;
      for (const result of resolved.results) {
        nextState = applyAuroraExecutionResult(nextState, result);
      }
      return {
        ...nextState,
        auroraQueue: resolved.queueState,
        permissions: resolved.permissionState,
        mcp: resolved.mcpState,
      };
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

export function runReplay(
  initialState: GameRuntimeState,
  env: AuroraRuntimeEnvironment,
  steps: ReplayStep[]
): ReplayResult {
  // Deep-clone the provided state so the initial is not mutated
  const clonedState: GameRuntimeState = {
    world: cloneWorldSafe(initialState.world),
    permissions: {
      alwaysAllowedAccess: new Set([...initialState.permissions.alwaysAllowedAccess]),
      allowAlwaysMcpToolKeys: new Set([...initialState.permissions.allowAlwaysMcpToolKeys]),
    },
    auroraQueue: cloneWorldSafe(initialState.auroraQueue),
    mcp: { activeServerIds: [...initialState.mcp.activeServerIds] },
    auditLog: cloneWorldSafe(initialState.auditLog),
  };

  const errors: string[] = [];
  let state = clonedState;
  let executed = 0;

  for (const step of steps) {
    try {
      state = runReplayStep(state, env, step);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
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
