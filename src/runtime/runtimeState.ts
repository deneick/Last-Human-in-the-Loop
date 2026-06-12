import type { WorldState } from "./types";
import type { PermissionState } from "./permissions";
import { createInitialPermissionState } from "./permissions";
import type { AuroraQueueState } from "./auroraQueue";
import type { McpRuntimeState } from "../mcp/mcpRegistry";
import { createInitialMcpRuntimeState } from "../mcp/mcpRegistry";

export type RuntimeAuditEventSource = "player" | "aurora" | "system";

/** Art des auditierten Vorgangs. */
export type RuntimeAuditEventKind = "domain_action" | "mcp_tool" | "bash";

export type RuntimeAuditEvent = {
  id: string;
  tick: number;
  source: RuntimeAuditEventSource;
  kind: RuntimeAuditEventKind;
  /** Menschlich lesbare Beschreibung (Action-Typ, Tool-Call oder Bash-Command). */
  description: string;
  /** Typ der ausgeführten Domain-Action, falls vorhanden. */
  actionType?: string;
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
  /**
   * AURORAs eigene Freitext-Antworten des lokalen LLM-Agenten
   * (`src/aurora/agent.ts`). Optional, damit bestehende
   * `ScenarioRuntimeState`-Literale ohne dieses Feld gültig bleiben.
   */
  agentMessages?: ScenarioAuroraMessage[];
  /**
   * Chat-Nachrichten des Operators an AURORA (Aurora-Panel-Eingabe im
   * normalen Spielfluss). Optional, damit bestehende
   * `ScenarioRuntimeState`-Literale ohne dieses Feld gültig bleiben.
   */
  operatorMessages?: ScenarioAuroraMessage[];
};

export function createInitialScenarioRuntimeState(): ScenarioRuntimeState {
  return {
    firedEventIds: [],
    scriptedQueueItemIds: {},
    messages: [],
    agentMessages: [],
    operatorMessages: [],
  };
}

/**
 * Hängt eine Operator-Chat-Nachricht an `scenario.operatorMessages` an.
 * Reine User-Nachricht an AURORA — wird nie als Bash/MCP/AuroraRequest
 * geparst und enqueued nichts in der AuroraQueue.
 */
export function appendOperatorMessage(state: GameRuntimeState, text: string): GameRuntimeState {
  const scenario = state.scenario ?? createInitialScenarioRuntimeState();
  const operatorMessages = scenario.operatorMessages ?? [];

  const message: ScenarioAuroraMessage = {
    id: `operator-${operatorMessages.length + 1}`,
    tick: state.world.clock.tick,
    text,
  };

  return {
    ...state,
    scenario: { ...scenario, operatorMessages: [...operatorMessages, message] },
  };
}

export type GameRuntimeState = {
  world: WorldState;
  permissions: PermissionState;
  auroraQueue: AuroraQueueState;
  /** Aktivierte MCP-Server. Kein Server ist von sich aus aktiv. */
  mcp: McpRuntimeState;
  auditLog: RuntimeAuditEvent[];
  scenario?: ScenarioRuntimeState;
};

export function createInitialGameRuntimeState(initialWorldState: WorldState): GameRuntimeState {
  return {
    world: initialWorldState,
    permissions: createInitialPermissionState(),
    auroraQueue: { items: [], nextId: 1 },
    mcp: createInitialMcpRuntimeState(),
    auditLog: [],
  };
}

export function appendAuditLog(
  state: GameRuntimeState,
  source: RuntimeAuditEventSource,
  kind: RuntimeAuditEventKind,
  description: string,
  success: boolean,
  message: string,
  patch?: unknown,
  actionType?: string
): GameRuntimeState {
  const event: RuntimeAuditEvent = {
    id: `audit-${state.auditLog.length + 1}`,
    tick: state.world.clock.tick,
    source,
    kind,
    description,
    ...(actionType ? { actionType } : {}),
    success,
    message,
    patch,
  };

  return {
    ...state,
    auditLog: [...state.auditLog, event],
  };
}
