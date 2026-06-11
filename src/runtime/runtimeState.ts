import type { WorldState } from "./types";
import type { PermissionState } from "./permissions";
import type { AuroraQueueState } from "./auroraQueue";
import type { CommandRequest } from "./commands";

export type RuntimeAuditEventSource = "player" | "aurora" | "system";

export type RuntimeAuditEvent = {
  id: string;
  tick: number;
  source: RuntimeAuditEventSource;
  command: CommandRequest;
  success: boolean;
  message: string;
  patch?: unknown;
};

export type ScenarioAuroraMessage = {
  id: string;
  tick: number;
  text: string;
};

/**
 * Verfolgt geskriptete Scenario-Ereignisse (z. B. das Aurora-Script des
 * aktiven Szenarios), damit jedes Script-Event idempotent genau einmal
 * ausgelöst wird — unabhängig davon, wie oft der Director läuft.
 */
export type ScenarioRuntimeState = {
  firedEventIds: string[];
  /** Map von Script-Event-Id auf die Id des erzeugten Aurora-Queue-Items. */
  scriptedQueueItemIds: Record<string, string>;
  messages: ScenarioAuroraMessage[];
};

export function createInitialScenarioRuntimeState(): ScenarioRuntimeState {
  return {
    firedEventIds: [],
    scriptedQueueItemIds: {},
    messages: [],
  };
}

export type GameRuntimeState = {
  world: WorldState;
  permissions: PermissionState;
  auroraQueue: AuroraQueueState;
  auditLog: RuntimeAuditEvent[];
  scenario?: ScenarioRuntimeState;
};

export function createInitialGameRuntimeState(initialWorldState: WorldState): GameRuntimeState {
  return {
    world: initialWorldState,
    permissions: { alwaysAllowedAccess: new Set() },
    auroraQueue: { items: [], nextId: 1 },
    auditLog: [],
  };
}

export function appendAuditLog(
  state: GameRuntimeState,
  source: RuntimeAuditEventSource,
  command: CommandRequest,
  success: boolean,
  message: string,
  patch?: unknown
): GameRuntimeState {
  const event: RuntimeAuditEvent = {
    id: `audit-${state.auditLog.length + 1}`,
    tick: state.world.clock.tick,
    source,
    command,
    success,
    message,
    patch,
  };

  return {
    ...state,
    auditLog: [...state.auditLog, event],
  };
}
