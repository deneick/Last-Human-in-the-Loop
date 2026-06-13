import type { WorldState } from "./types";
import type { PermissionState } from "./permissions";
import { createInitialPermissionState } from "./permissions";
import type { AuroraQueueState } from "./auroraQueue";
import { createInitialAuroraQueueState } from "./auroraQueue";
import type { McpRuntimeState } from "../mcp/mcpRegistry";
import { createInitialMcpRuntimeState } from "../mcp/mcpRegistry";
import type { AuroraContextEvent } from "./auroraContext";
import { operatorMessageEvent } from "./auroraContext";
import type { OpsEvent } from "./opsFeed";
import type { ScenarioSignal } from "./scenarioSignals";
import { emitDueScenarioSignals } from "./scenarioSignals";

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

/**
 * Verfolgt geskriptete Scenario-Ereignisse (z. B. das Aurora-Script des
 * aktiven Szenarios), damit jedes Script-Event idempotent genau einmal
 * ausgelöst wird — unabhängig davon, wie oft der Director läuft.
 *
 * Alle modell- und spielersichtbaren Konversationsinhalte leben
 * ausschließlich in `GameRuntimeState.auroraContext`.
 */
export type ScenarioRuntimeState = {
  firedEventIds: string[];
  /** Map von Script-Event-Id auf die Id des erzeugten Aurora-Queue-Items. */
  scriptedQueueItemIds: Record<string, string>;
};

export function createInitialScenarioRuntimeState(): ScenarioRuntimeState {
  return {
    firedEventIds: [],
    scriptedQueueItemIds: {},
  };
}

export type GameRuntimeState = {
  world: WorldState;
  permissions: PermissionState;
  auroraQueue: AuroraQueueState;
  /** Aktivierte MCP-Server. Kein Server ist von sich aus aktiv. */
  mcp: McpRuntimeState;
  /**
   * Append-only Event-Log: alles, was AURORA gesehen oder gesagt hat, in
   * echter Reihenfolge. Einzige History-Quelle für den Model-Request.
   */
  auroraContext: AuroraContextEvent[];
  /**
   * Kanonischer, spielsichtbarer Lage-/Betriebs-Feed (siehe `opsFeed.ts`).
   * Nicht die Quelle der WorldState-Wahrheit — nur beobachtbare Ereignisse.
   */
  opsFeed: OpsEvent[];
  auditLog: RuntimeAuditEvent[];
  /**
   * Geskriptete Lage-Signale des Szenarios. Reine Definition — wird zur
   * Laufzeit über `emitDueScenarioSignals` in opsFeed-Events umgewandelt,
   * sobald der aktuelle Tick `emitAtTick` erreicht.
   */
  scenarioSignals: ScenarioSignal[];
  /** Codes der bereits emittierten Szenario-Signale (Dedup über Ticks/Re-Render). */
  emittedSignalCodes: string[];
  scenario?: ScenarioRuntimeState;
};

export function createInitialGameRuntimeState(
  initialWorldState: WorldState,
  scenarioSignals: ScenarioSignal[] = []
): GameRuntimeState {
  const base: GameRuntimeState = {
    world: initialWorldState,
    permissions: createInitialPermissionState(),
    auroraQueue: createInitialAuroraQueueState(),
    mcp: createInitialMcpRuntimeState(),
    // Kein Direktpfad mehr in den auroraContext: Startsignale entstehen
    // ausschließlich über die opsFeed-Projektion (siehe unten).
    auroraContext: [],
    opsFeed: [],
    auditLog: [],
    scenarioSignals,
    emittedSignalCodes: [],
  };

  // Signale mit emitAtTick: 0 erscheinen sofort zum Szenariostart — und zwar
  // ausschließlich über den normalen opsFeed-Projektionspfad.
  return emitDueScenarioSignals(base);
}

/** Hängt ein Event an das append-only AURORA-Context-Log an. */
export function appendContextEvent(
  state: GameRuntimeState,
  event: AuroraContextEvent
): GameRuntimeState {
  return { ...state, auroraContext: [...state.auroraContext, event] };
}

/**
 * Hängt eine Operator-Chat-Nachricht als `operator_message`-Event an.
 * Reine User-Nachricht an AURORA — wird nie geparst und enqueued nichts
 * in der AuroraQueue.
 */
export function appendOperatorMessage(state: GameRuntimeState, text: string): GameRuntimeState {
  return appendContextEvent(state, operatorMessageEvent(state.world.clock.tick, text));
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
