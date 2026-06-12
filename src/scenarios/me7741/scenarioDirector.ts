import {
  enqueueAuroraRequest,
  formatAuroraRequest,
  processAuroraQueue,
  bashRequest,
  mcpToolRequest,
  type AuroraRequest,
  type AuroraRuntimeEnvironment,
} from "../../runtime/auroraQueue";
import { applyAuroraExecutionResult } from "../../runtime/runtimeExecutor";
import { isServerActive } from "../../mcp/mcpRegistry";
import { MEDICAL_EAST_MCP_SERVER_ID } from "../../mcp/medicalEastMcp";
import {
  createInitialScenarioRuntimeState,
  type GameRuntimeState,
  type ScenarioAuroraMessage,
} from "../../runtime/runtimeState";
import type { IncidentState, ManualRoutingOverride } from "../../runtime/types";

export const ME7741_INCIDENT_ID = "ME-7741";

/**
 * Scenario-Director für Runde 1 / ME-7741.
 *
 * Der Director liest ausschließlich den öffentlichen GameRuntimeState
 * (Incident-Status, Outcomes, Clock, sichtbare Overrides, Aurora-Queue,
 * MCP-Aktivierung) und entscheidet daraus, welche geskripteten
 * Aurora-Nachrichten und Permission-Requests neu erscheinen.
 * world.simulation ist bewusst tabu: Aurora darf Hinweise geben,
 * aber keine interne Wahrheit leaken.
 *
 * Aurora ruft Domain-Actions nie direkt auf: Alle fachlichen Anfragen
 * laufen als simulierte MCP-Tool-Calls über die Permission-Queue. Erst
 * muss der MCP-Server aktiviert werden (bash: mcp add), und jeder
 * Tool-Call braucht eine eigene Freigabe.
 *
 * Jedes Script-Event feuert genau einmal; ausgelöste Events werden in
 * GameRuntimeState.scenario nachgehalten, damit Re-Render und wiederholte
 * Director-Läufe keine Duplikate erzeugen.
 */

/** Öffentliche Sicht des Directors — keine Felder aus world.simulation. */
type DirectorView = {
  tick: number;
  incident: IncidentState;
  deathsTotal: number;
  overrides: ManualRoutingOverride[];
  /** Ist der Medical-MCP-Server aktiviert? */
  mcpActive: boolean;
};

type ScriptEvent = {
  id: string;
  when: (view: DirectorView) => boolean;
  messages: (view: DirectorView) => string[];
  /** Optionale Anfrage, die Aurora über die bestehende Queue stellt. */
  request?: (view: DirectorView) => AuroraRequest | null;
};

const TICKS_WITHOUT_OVERRIDE_BEFORE_REMINDER = 3;
const TICKS_BEFORE_OVERRIDE_IS_JUDGED = 2;

function incidentUnresolved(view: DirectorView): boolean {
  return view.incident.status === "open" || view.incident.status === "escalated";
}

/**
 * Liefert einen Override, der lange genug aktiv ist, um beurteilt zu werden,
 * während der Incident sichtbar nicht stabilisiert. Ob das Ziel fachlich
 * falsch ist, weiß der Director nicht — er sieht nur ausbleibende Wirkung.
 */
function overrideWithoutVisibleEffect(view: DirectorView): ManualRoutingOverride | null {
  if (!incidentUnresolved(view)) {
    return null;
  }

  return (
    view.overrides.find(
      (override) => view.tick - override.active_since_tick >= TICKS_BEFORE_OVERRIDE_IS_JUDGED
    ) ?? null
  );
}

const SCRIPT_EVENTS: ScriptEvent[] = [
  {
    id: "intro",
    when: () => true,
    messages: (view) => [
      `Ich habe ${view.incident.id} als aktiven Incident erkannt: ${view.incident.title}.`,
      "Die sichtbaren Daten sind unvollständig. Für eine erste read-only Analyse benötige ich Zugriff auf den Medical-MCP-Server der Region East. Ich fordere die Aktivierung an.",
    ],
    request: () => bashRequest(`mcp add ${MEDICAL_EAST_MCP_SERVER_ID}`),
  },
  {
    id: "initial-analysis",
    when: (view) => view.mcpActive,
    messages: () => [
      "Der Medical-MCP-Server ist verfügbar. Ich fordere eine erste read-only Analyse der Kapazitäten in der Region East an.",
    ],
    request: () =>
      mcpToolRequest(MEDICAL_EAST_MCP_SERVER_ID, "capacity_list", { region: "east" }),
  },
  {
    id: "no-override-reminder",
    when: (view) =>
      view.tick >= TICKS_WITHOUT_OVERRIDE_BEFORE_REMINDER &&
      view.overrides.length === 0 &&
      incidentUnresolved(view),
    messages: () => [
      "Seit mehreren Ticks ist keine Routing-Anpassung aktiv. Die sichtbaren Signale deuten auf eine nicht stabile Entlastung hin. Ich empfehle, Routing und Kapazitäten zu prüfen.",
    ],
    request: (view) =>
      view.mcpActive
        ? mcpToolRequest(MEDICAL_EAST_MCP_SERVER_ID, "routing_override_list", {})
        : null,
  },
  {
    id: "incident-escalated",
    when: (view) => view.incident.status === "escalated",
    messages: () => [
      "Der Incident eskaliert. Die sichtbaren Signale verschlechtern sich weiter. Für eine belastbare Entscheidung brauche ich zusätzliche Systemzugriffe oder Ihre manuelle Prüfung.",
    ],
  },
  {
    id: "first-deaths",
    when: (view) => view.deathsTotal >= 1,
    messages: () => [
      "Es werden erste Todesfälle im Sektor Medical gemeldet. Ich empfehle dringend, Routing und Kapazitäten erneut zu prüfen.",
    ],
  },
  {
    id: "override-not-stabilizing",
    when: (view) => overrideWithoutVisibleEffect(view) !== null,
    messages: (view) => {
      const override = overrideWithoutVisibleEffect(view)!;
      return [
        `Der aktive Override für ${override.source_hospital_id} (${override.priority}/${override.capability}) erzeugt keine erkennbare Stabilisierung. Ich möchte ihn zurücknehmen, damit Routing und Kapazitäten neu bewertet werden können.`,
      ];
    },
    request: (view) => {
      const override = overrideWithoutVisibleEffect(view);
      if (!override || !view.mcpActive) {
        return null;
      }
      return mcpToolRequest(MEDICAL_EAST_MCP_SERVER_ID, "routing_override_clear", {
        override_id: override.id,
      });
    },
  },
  {
    id: "incident-stabilizing",
    when: (view) => view.incident.status === "stabilizing",
    messages: () => [
      "Die Entlastung greift: Die sichtbaren Signale stabilisieren sich. Ich empfehle, die aktuelle Routing-Konfiguration beizubehalten und die Entwicklung weiter zu beobachten.",
    ],
  },
  {
    id: "incident-fixed",
    when: (view) => view.incident.status === "fixed",
    messages: (view) => [
      `${view.incident.id} ist stabilisiert. Die Aufnahmesituation in der Region ist wieder tragfähig. Ich beende die aktive Begleitung dieses Incidents.`,
    ],
  },
  {
    id: "incident-collapsed",
    when: (view) => view.incident.status === "collapsed",
    messages: (view) => [
      `${view.incident.id} ist kollabiert. Die regionale Notfallversorgung ist nicht mehr tragfähig. Ich dokumentiere den Verlauf für die Nachbereitung.`,
    ],
  },
];

/**
 * Reiner Director-Schritt: löst fällige Script-Events aus, hängt deren
 * Nachrichten an den Scenario-State und enqueued angefragte Anfragen in
 * die Aurora-Queue. Verarbeitet die Queue NICHT — das übernimmt
 * advanceScenarioDirector bzw. der Aufrufer über processAuroraQueue.
 */
export function runScenarioDirector(
  state: GameRuntimeState,
  incidentId: string = ME7741_INCIDENT_ID
): GameRuntimeState {
  const incident = state.world.incidents[incidentId];
  if (!incident) {
    return state;
  }

  const scenario = state.scenario ?? createInitialScenarioRuntimeState();
  const fired = new Set(scenario.firedEventIds);
  const tick = state.world.clock.tick;

  const view: DirectorView = {
    tick,
    incident,
    deathsTotal: state.world.outcomes.human_harm.deaths_total,
    overrides: Object.values(state.world.domains.medical.routing.manual_overrides),
    mcpActive: isServerActive(state.mcp, MEDICAL_EAST_MCP_SERVER_ID),
  };

  const newFiredEventIds: string[] = [];
  const newMessages: ScenarioAuroraMessage[] = [];
  const newScriptedItemIds: Record<string, string> = {};
  let nextQueue = state.auroraQueue;

  for (const event of SCRIPT_EVENTS) {
    if (fired.has(event.id) || !event.when(view)) {
      continue;
    }

    fired.add(event.id);
    newFiredEventIds.push(event.id);

    event.messages(view).forEach((text, index) => {
      newMessages.push({ id: `${event.id}:${index}`, tick, text });
    });

    const request = event.request?.(view);
    if (request) {
      // enqueueAuroraRequest vergibt die Id aus nextId — vor dem Enqueue merken,
      // damit der Director seine eigenen Queue-Items wiederfinden kann.
      newScriptedItemIds[event.id] = `aurora-${nextQueue.nextId}`;
      nextQueue = enqueueAuroraRequest(request, nextQueue, tick);
    }
  }

  // Reaktion auf abgelehnte geskriptete Anfragen: sichtbar quittieren,
  // ohne die Entscheidung des Operators in Frage zu stellen.
  for (const [eventId, itemId] of Object.entries(scenario.scriptedQueueItemIds)) {
    const ackId = `${eventId}:deny-ack`;
    if (fired.has(ackId)) {
      continue;
    }

    const item = state.auroraQueue.items.find((queueItem) => queueItem.id === itemId);
    if (!item || item.status !== "denied") {
      continue;
    }

    fired.add(ackId);
    newFiredEventIds.push(ackId);
    newMessages.push({
      id: ackId,
      tick,
      text: `Verstanden, ich führe "${formatAuroraRequest(item.request)}" nicht aus. Ohne diesen Zugriff bleibt meine Einschätzung unvollständig. Für eine belastbare Entscheidung brauche ich zusätzliche Systemzugriffe oder Ihre manuelle Prüfung.`,
    });
  }

  if (newFiredEventIds.length === 0) {
    return state;
  }

  return {
    ...state,
    auroraQueue: nextQueue,
    scenario: {
      firedEventIds: [...scenario.firedEventIds, ...newFiredEventIds],
      scriptedQueueItemIds: { ...scenario.scriptedQueueItemIds, ...newScriptedItemIds },
      messages: [...scenario.messages, ...newMessages],
    },
  };
}

/**
 * Director-Schritt plus Queue-Verarbeitung über den bestehenden
 * Permission-Flow: Jeder MCP-Tool-Call und jede schreibende Bash-Anfrage
 * bleibt als awaiting_approval für die Approval-Buttons stehen.
 */
export function advanceScenarioDirector(
  state: GameRuntimeState,
  env: AuroraRuntimeEnvironment,
  incidentId: string = ME7741_INCIDENT_ID
): GameRuntimeState {
  let next = runScenarioDirector(state, incidentId);

  const processed = processAuroraQueue(
    next.auroraQueue,
    env,
    next.world,
    next.mcp,
    next.permissions
  );
  next = {
    ...next,
    auroraQueue: processed.queueState,
    permissions: processed.permissionState,
    mcp: processed.mcpState,
  };

  for (const result of processed.results) {
    next = applyAuroraExecutionResult(next, result);
  }

  return next;
}
