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

export type GameRuntimeState = {
  world: WorldState;
  permissions: PermissionState;
  auroraQueue: AuroraQueueState;
  auditLog: RuntimeAuditEvent[];
};

export function createInitialGameRuntimeState(initialWorldState: WorldState): GameRuntimeState {
  return {
    world: initialWorldState,
    permissions: { alwaysAllowedPermissionClasses: new Set() },
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
