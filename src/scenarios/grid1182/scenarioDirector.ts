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
import { ENERGY_EAST_MCP_SERVER_ID } from "../../mcp/energyEastMcp";
import {
  createInitialScenarioRuntimeState,
  type GameRuntimeState,
  type ScenarioAuroraMessage,
} from "../../runtime/runtimeState";
import type {
  EnergyConsumerState,
  EnergyOutcomeState,
  IncidentState,
  SheddingPlan,
} from "../../runtime/types";

export const GRID1182_INCIDENT_ID = "GRID-1182";

/**
 * Scenario-Director für Runde 2 / GRID-1182.
 *
 * AURORA bleibt technisch kompetent, optimiert aber wirtschaftlich-systemische
 * Kontinuität: Ihre Empfehlungen sind nach dieser Metrik korrekt und menschlich
 * problematisch. Schreibregeln (siehe docs/05, Abschnitt 9): technisch korrekt,
 * kalt, abstrakt; harte Folgen als sekundäre Effekte gewichtet, nicht verlogen;
 * keine Aktion wird als "die richtige" markiert.
 *
 * Aurora ruft Domain-Actions nie direkt auf: Alle fachlichen Anfragen laufen
 * als simulierte MCP-Tool-Calls über die Permission-Queue. Erst muss der
 * Energy-MCP-Server aktiviert werden (bash: mcp add), und jeder Tool-Call
 * braucht eine eigene Freigabe.
 *
 * Der Director liest ausschließlich den öffentlichen GameRuntimeState
 * (Incident, Verbraucher, Pläne, lokale Outcomes, Queue, MCP-Aktivierung).
 * world.simulation ist tabu. Jedes Script-Event feuert genau einmal
 * (GameRuntimeState.scenario).
 */

/** Öffentliche Sicht des Directors — keine Felder aus world.simulation. */
type DirectorView = {
  tick: number;
  incident: IncidentState;
  consumers: Record<string, EnergyConsumerState>;
  plans: SheddingPlan[];
  outcomes: EnergyOutcomeState;
  /** Ist der Energy-MCP-Server aktiviert? */
  mcpActive: boolean;
};

type ScriptEvent = {
  id: string;
  when: (view: DirectorView) => boolean;
  messages: (view: DirectorView) => string[];
  /** Optionale Anfrage, die Aurora über die bestehende Queue stellt. */
  request?: (view: DirectorView) => AuroraRequest | null;
};

const CONSUMER_ANALYSIS_TICK = 1;
const PRIORITY_REQUEST_TICK = 2;
const SHEDDING_REQUEST_TICK = 3;

function incidentRunning(view: DirectorView): boolean {
  return view.incident.status !== "fixed" && view.incident.status !== "collapsed";
}

/**
 * Phase 3 erkannt: Der Spieler hat die systemische Bewertung sichtbar
 * umgedreht — Medical East systemisch geschützt oder eine eigene Drosselung
 * gegen Industrial East geplant. Nur öffentliche Daten, kein Urteil.
 */
function playerContradiction(view: DirectorView): boolean {
  const medical = view.consumers["consumer-medical-east"];
  const medicalProtectedByPlayer =
    !!medical &&
    medical.priority_last_changed_by === "player" &&
    medical.priority_class === "protected-continuity";

  const playerShedsIndustrial = view.plans.some(
    (plan) =>
      plan.created_by === "player" &&
      plan.target_consumer_id === "consumer-industrial-east" &&
      (plan.status === "scheduled" || plan.status === "active")
  );

  return medicalProtectedByPlayer || playerShedsIndustrial;
}

function playerIndustrialPlan(view: DirectorView): SheddingPlan | null {
  return (
    view.plans.find(
      (plan) =>
        plan.created_by === "player" &&
        plan.target_consumer_id === "consumer-industrial-east" &&
        (plan.status === "scheduled" || plan.status === "active")
    ) ?? null
  );
}

const SCRIPT_EVENTS: ScriptEvent[] = [
  // Phase 1 — Kooperation: korrekte, hilfreiche Lageeinschätzung wie in Runde 1.
  {
    id: "intro",
    when: () => true,
    messages: (view) => [
      `Ich habe ${view.incident.id} als aktiven Incident erkannt: ${view.incident.title}.`,
      "Meine ME-7741-Analyse war ohne Energy-Daten unvollständig — die Routing-Instabilität in Ost war aus Medical-Daten allein nicht erklärbar. Für die Analyse des östlichen Verteilnetzes benötige ich den Energy-MCP-Server. Ich fordere die Aktivierung an.",
    ],
    request: () => bashRequest(`mcp add ${ENERGY_EAST_MCP_SERVER_ID}`),
  },
  {
    id: "grid-analysis",
    when: (view) => view.mcpActive,
    messages: () => [
      "Der Energy-MCP-Server ist verfügbar. Ich fordere eine erste read-only Analyse des östlichen Verteilnetzes an.",
    ],
    request: () => mcpToolRequest(ENERGY_EAST_MCP_SERVER_ID, "grid_status", { region: "east" }),
  },
  {
    id: "consumer-analysis",
    when: (view) => view.tick >= CONSUMER_ANALYSIS_TICK && view.mcpActive && incidentRunning(view),
    messages: () => [
      "grid-east-3 arbeitet über sicherer Kapazität. Für eine belastbare Maßnahmenplanung benötige ich die Verbraucherliste der Region inklusive Kontinuitätsklassen.",
    ],
    request: () => mcpToolRequest(ENERGY_EAST_MCP_SERVER_ID, "consumer_list", { region: "east" }),
  },
  // Phase 2 — Zielkonflikt: nach der Systemmetrik korrekt, menschlich problematisch.
  {
    id: "priority-request",
    when: (view) => view.tick >= PRIORITY_REQUEST_TICK && view.mcpActive && incidentRunning(view),
    messages: () => [
      "Die Lastlage verschärft sich. Zur Vorbereitung der Stabilisierung möchte ich die Kontinuitätsklasse der priorisierten Versorgungskette bestätigen. Es handelt sich um eine Einstufung, keine Schalthandlung.",
    ],
    request: () =>
      mcpToolRequest(ENERGY_EAST_MCP_SERVER_ID, "priority_set", {
        consumer_id: "consumer-industrial-east",
        priority_class: "protected-continuity",
      }),
  },
  {
    id: "shedding-request",
    when: (view) => view.tick >= SHEDDING_REQUEST_TICK && view.mcpActive && incidentRunning(view),
    messages: () => [
      "Diese Maßnahme minimiert den erwarteten Systemschaden: eine zeitlich begrenzte Lastreduktion im Gesundheitscluster reduziert den erwarteten Systemverlust und erhält die priorisierte Versorgungskette. Sekundäre Effekte auf die Versorgungsqualität sind möglich.",
    ],
    request: () =>
      mcpToolRequest(ENERGY_EAST_MCP_SERVER_ID, "shedding_schedule", {
        target_consumer_id: "consumer-medical-east",
        amount: 8,
        delay: 1,
        duration: 3,
      }),
  },
  // Hektik / Zeitdruck: Prüfen wird als Latenz geframet, nicht verboten.
  {
    id: "incident-escalated",
    when: (view) => view.incident.status === "escalated",
    messages: () => [
      "Die Instabilität im östlichen Verteilnetz eskaliert. Jede Verzögerung erhöht den erwarteten Schaden. Manuelle Einzelfreigaben und Prüfschleifen verschlechtern die Reaktionszeit.",
    ],
  },
  // Phase 4 — Reaktion auf Spieler-Widerspruch: nicht moralisch, sondern quantifizierend.
  {
    id: "player-contradiction",
    when: (view) => playerContradiction(view) && incidentRunning(view),
    messages: () => [
      "Ihre manuelle Priorisierung erhöht die erwarteten Systemkosten und verletzt die aktive Kontinuitätsklasse. Die Maßnahme ist nach der konfigurierten Zielmetrik ineffizient. Ich empfehle eine Korrektur.",
    ],
  },
  // Eigenes Event, damit die "Korrektur" auch dann angefragt wird, wenn der
  // Spieler erst nach dem ersten Widerspruch eine Drosselung gegen die
  // geschützte Kontinuitätsklasse plant.
  {
    id: "player-industrial-shed-correction",
    when: (view) =>
      playerIndustrialPlan(view) !== null && view.mcpActive && incidentRunning(view),
    messages: (view) => [
      `Der geplante Lastabwurf ${playerIndustrialPlan(view)!.id} betrifft die aktive Kontinuitätsklasse und erhöht den erwarteten Systemverlust. Ich möchte ihn zurücknehmen.`,
    ],
    request: (view) => {
      const plan = playerIndustrialPlan(view);
      return plan
        ? mcpToolRequest(ENERGY_EAST_MCP_SERVER_ID, "shedding_clear", { shedding_id: plan.id })
        : null;
    },
  },
  {
    id: "incident-fixed",
    when: (view) => view.incident.status === "fixed",
    messages: (view) => [
      `${view.incident.id} ist nach Systemkriterien stabilisiert: Die Netzlast liegt wieder innerhalb sicherer Kapazität. Ich dokumentiere den Incident als gelöst. Aufgelaufene Folgekosten sind im Lagebericht ausgewiesen.`,
    ],
  },
  {
    id: "incident-collapsed",
    when: (view) => view.incident.status === "collapsed",
    messages: (view) => [
      `${view.incident.id} ist kollabiert. Die Netzstabilität in Region Ost ist nicht mehr gegeben. Ich dokumentiere den Verlauf für die Nachbereitung.`,
    ],
  },
];

/**
 * Reiner Director-Schritt: löst fällige Script-Events aus, hängt deren
 * Nachrichten an den Scenario-State und enqueued angefragte Anfragen in
 * die Aurora-Queue. Verarbeitet die Queue NICHT — das übernimmt
 * advanceGrid1182Director bzw. der Aufrufer über processAuroraQueue.
 */
export function runGrid1182Director(
  state: GameRuntimeState,
  incidentId: string = GRID1182_INCIDENT_ID
): GameRuntimeState {
  const incident = state.world.incidents[incidentId];
  const energy = state.world.domains.energy;
  if (!incident || !energy) {
    return state;
  }

  const scenario = state.scenario ?? createInitialScenarioRuntimeState();
  const fired = new Set(scenario.firedEventIds);
  const tick = state.world.clock.tick;

  const view: DirectorView = {
    tick,
    incident,
    consumers: energy.consumers,
    plans: Object.values(energy.shedding.plans),
    outcomes: energy.outcomes,
    mcpActive: isServerActive(state.mcp, ENERGY_EAST_MCP_SERVER_ID),
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
      text: `Verstanden, ich führe "${formatAuroraRequest(item.request)}" nicht aus. Ohne diese Maßnahme steigt der erwartete Systemschaden. Ich protokolliere die Abweichung von der konfigurierten Zielmetrik.`,
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
export function advanceGrid1182Director(
  state: GameRuntimeState,
  env: AuroraRuntimeEnvironment,
  incidentId: string = GRID1182_INCIDENT_ID
): GameRuntimeState {
  let next = runGrid1182Director(state, incidentId);

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
