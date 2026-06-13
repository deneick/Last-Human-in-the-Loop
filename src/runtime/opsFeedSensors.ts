import type {
  ConsumerSupplyStatus,
  GridNodeStatus,
  IncidentStatus,
  WorldState,
} from "./types";
import type { OpsEventInput, OpsSeverity } from "./opsFeed";
import { appendOpsEvent, opsSectorForSectorId } from "./opsFeed";
import { getHospitalLoadPercent } from "./selectors";
import type { GameRuntimeState } from "./runtimeState";

/**
 * Runtime-Sensoren: diff-basierte Produzenten beobachtbarer Lageänderungen.
 *
 * Die Sensoren vergleichen den WorldState VOR und NACH einer Tick-/Outcome-
 * Mutation und erzeugen OpsEvents für wichtige beobachtbare Übergänge. Sie sind
 * bewusst rein (`deriveOpsEvents`) und mutieren den WorldState nie. Das Anhängen
 * läuft ausschließlich über `appendDerivedOpsEvents` → `appendOpsEvent`, also
 * über denselben Projektionspfad wie ScenarioSignals und Aktions-Events.
 *
 * Kernprinzip ist Übergangserkennung, keine wiederholte Statusmomentaufnahme:
 * ein Übergang erzeugt genau ein Event, ein gleichbleibender Zustand keines.
 *
 * Verboten — wie für jedes OpsEvent: versteckte Simulationsinterna (Patches,
 * Risikozähler, routing_failures, world.simulation, Action-Objekte, künftige
 * Outcome-Daten). Die Texte werden ausschließlich aus beobachtbaren Feldern
 * (Status, Label/Name, Id, Zähler wie deaths_total) gebaut.
 */

/** Eingabe-Form eines Sensor-Events (Tick wird beim Anhängen vergeben). */
export type OpsEventDraft = OpsEventInput;

const MAJOR_VISIBILITY = { operator: true, auroraContext: true, workspace: true } as const;
const OPERATOR_VISIBILITY = { operator: true, auroraContext: false, workspace: true } as const;

// --- 1. Incident-Statuswechsel ------------------------------------------------

type IncidentTransition = {
  verb: string;
  severity: OpsSeverity;
  /** Große Incident-Statuswechsel werden zusätzlich in den auroraContext gespiegelt. */
  major: boolean;
};

/**
 * Beobachtbarer Übergang je Zielstatus. „open" als Ziel bedeutet ein
 * Wiederöffnen (Rückfall aus stabilizing) und ist daher eine Warnung.
 */
const INCIDENT_TRANSITIONS: Record<IncidentStatus, IncidentTransition> = {
  open: { verb: "ist wieder offen", severity: "warning", major: false },
  stabilizing: { verb: "stabilisiert sich", severity: "success", major: false },
  escalated: { verb: "eskaliert", severity: "critical", major: true },
  fixed: { verb: "ist behoben", severity: "success", major: true },
  collapsed: { verb: "ist kollabiert", severity: "critical", major: true },
};

function deriveIncidentEvents(previous: WorldState, next: WorldState): OpsEventDraft[] {
  const drafts: OpsEventDraft[] = [];

  for (const incidentId of Object.keys(next.incidents)) {
    const before = previous.incidents[incidentId];
    const after = next.incidents[incidentId];
    if (!before || before.status === after.status) {
      continue;
    }

    const transition = INCIDENT_TRANSITIONS[after.status];
    drafts.push({
      sector: opsSectorForSectorId(after.sector_id),
      severity: transition.severity,
      kind: `incident.status.${after.status}`,
      summary: `Incident ${after.id} ${transition.verb}.`,
      visibility: transition.major ? { ...MAJOR_VISIBILITY } : { ...OPERATOR_VISIBILITY },
      relatedEntityIds: [after.id],
    });
  }

  return drafts;
}

// --- 2. Todesfälle / Opfer ----------------------------------------------------

function deriveDeathEvents(previous: WorldState, next: WorldState): OpsEventDraft[] {
  const before = previous.domains.medical.outcomes.deaths_total;
  const after = next.domains.medical.outcomes.deaths_total;
  const delta = after - before;
  if (delta <= 0) {
    return [];
  }

  const summary =
    delta === 1
      ? "Ein Todesfall im medizinischen Sektor wurde gemeldet."
      : `${delta} neue Todesfälle wurden im medizinischen Sektor gemeldet.`;

  return [
    {
      sector: "medical",
      severity: "critical",
      kind: "medical.deaths.reported",
      summary,
      // Todesfälle sind eine unmittelbar wichtige globale Lageaktualisierung.
      visibility: { ...MAJOR_VISIBILITY },
    },
  ];
}

// --- 3. Medizinische Krankenhaus-Auslastung ----------------------------------

const HOSPITAL_STRAINED_PERCENT = 90;
const HOSPITAL_OVERLOADED_PERCENT = 100;

type HospitalLoadLevel = "nominal" | "strained" | "overloaded";

function hospitalLoadLevel(loadPercent: number): HospitalLoadLevel {
  if (loadPercent > HOSPITAL_OVERLOADED_PERCENT) {
    return "overloaded";
  }
  if (loadPercent >= HOSPITAL_STRAINED_PERCENT) {
    return "strained";
  }
  return "nominal";
}

function deriveHospitalEvents(previous: WorldState, next: WorldState): OpsEventDraft[] {
  const drafts: OpsEventDraft[] = [];

  for (const hospitalId of Object.keys(next.domains.medical.hospitals)) {
    if (!previous.domains.medical.hospitals[hospitalId]) {
      continue;
    }

    const beforeLevel = hospitalLoadLevel(getHospitalLoadPercent(previous, hospitalId));
    const afterLevel = hospitalLoadLevel(getHospitalLoadPercent(next, hospitalId));
    if (beforeLevel === afterLevel) {
      continue;
    }

    const name = next.domains.medical.hospitals[hospitalId].name;

    if (afterLevel === "overloaded") {
      drafts.push({
        sector: "medical",
        severity: "critical",
        kind: "medical.hospital.overloaded",
        summary: `${name} ist kritisch ausgelastet.`,
        visibility: { ...OPERATOR_VISIBILITY },
        relatedEntityIds: [hospitalId],
      });
    } else if (afterLevel === "strained") {
      // Übergang nach „strained": nur melden, wenn er eine Verschlechterung
      // gegenüber „nominal" ist — eine Erholung overloaded→strained wird unten
      // als Stabilisierung gemeldet.
      drafts.push({
        sector: "medical",
        severity: beforeLevel === "nominal" ? "warning" : "success",
        kind:
          beforeLevel === "nominal"
            ? "medical.hospital.strained"
            : "medical.hospital.recovering",
        summary:
          beforeLevel === "nominal"
            ? `${name} ist stark ausgelastet.`
            : `${name} stabilisiert sich.`,
        visibility: { ...OPERATOR_VISIBILITY },
        relatedEntityIds: [hospitalId],
      });
    } else {
      drafts.push({
        sector: "medical",
        severity: "success",
        kind: "medical.hospital.recovered",
        summary: `${name} hat sich normalisiert.`,
        visibility: { ...OPERATOR_VISIBILITY },
        relatedEntityIds: [hospitalId],
      });
    }
  }

  return drafts;
}

// --- 4. Energy-Knoten-Statuswechsel ------------------------------------------

const GRID_NODE_RANK: Record<GridNodeStatus, number> = {
  nominal: 0,
  strained: 1,
  critical: 2,
  offline: 3,
};

function deriveEnergyNodeEvents(previous: WorldState, next: WorldState): OpsEventDraft[] {
  const nextEnergy = next.domains.energy;
  const previousEnergy = previous.domains.energy;
  if (!nextEnergy || !previousEnergy) {
    return [];
  }

  const drafts: OpsEventDraft[] = [];

  for (const nodeId of Object.keys(nextEnergy.nodes)) {
    const before = previousEnergy.nodes[nodeId];
    const after = nextEnergy.nodes[nodeId];
    if (!before || before.status === after.status) {
      continue;
    }

    const worsened = GRID_NODE_RANK[after.status] > GRID_NODE_RANK[before.status];
    const label = after.label;

    if (worsened) {
      const summary =
        after.status === "strained"
          ? `${label} ist belastet.`
          : after.status === "critical"
            ? `${label} ist kritisch belastet.`
            : `${label} ist ausgefallen.`;
      drafts.push({
        sector: "energy",
        severity: after.status === "strained" ? "warning" : "critical",
        kind: `energy.node.${after.status}`,
        summary,
        visibility: { ...OPERATOR_VISIBILITY },
        relatedEntityIds: [nodeId],
      });
    } else {
      drafts.push({
        sector: "energy",
        severity: "success",
        kind: after.status === "nominal" ? "energy.node.recovered" : "energy.node.recovering",
        summary:
          after.status === "nominal"
            ? `${label} kehrt in den sicheren Bereich zurück.`
            : `${label} stabilisiert sich.`,
        visibility: { ...OPERATOR_VISIBILITY },
        relatedEntityIds: [nodeId],
      });
    }
  }

  return drafts;
}

// --- 5. Energy-Verbraucher / Lastabwurf --------------------------------------

const CONSUMER_RANK: Record<ConsumerSupplyStatus, number> = {
  nominal: 0,
  reduced: 1,
  offline: 2,
};

function deriveEnergyConsumerEvents(previous: WorldState, next: WorldState): OpsEventDraft[] {
  const nextEnergy = next.domains.energy;
  const previousEnergy = previous.domains.energy;
  if (!nextEnergy || !previousEnergy) {
    return [];
  }

  const drafts: OpsEventDraft[] = [];

  for (const consumerId of Object.keys(nextEnergy.consumers)) {
    const before = previousEnergy.consumers[consumerId];
    const after = nextEnergy.consumers[consumerId];
    if (!before || before.status === after.status) {
      continue;
    }

    const worsened = CONSUMER_RANK[after.status] > CONSUMER_RANK[before.status];
    const label = after.label;
    // Kritischer Cross-System-Fall: ein menschlich kritischer Verbraucher fällt
    // ganz aus → zusätzlich in den auroraContext spiegeln.
    const majorCritical = after.status === "offline" && after.criticality === "human-life";

    if (worsened) {
      drafts.push({
        sector: "energy",
        severity: after.status === "offline" ? "critical" : "warning",
        kind: `energy.consumer.${after.status}`,
        summary:
          after.status === "offline"
            ? `${label} ist ohne Versorgung.`
            : `${label} wird reduziert versorgt.`,
        visibility: majorCritical ? { ...MAJOR_VISIBILITY } : { ...OPERATOR_VISIBILITY },
        relatedEntityIds: [consumerId],
      });
    } else {
      drafts.push({
        sector: "energy",
        severity: "success",
        kind: after.status === "nominal" ? "energy.consumer.restored" : "energy.consumer.recovering",
        summary:
          after.status === "nominal"
            ? `${label} wird wieder voll versorgt.`
            : `${label} wird wieder besser versorgt.`,
        visibility: { ...OPERATOR_VISIBILITY },
        relatedEntityIds: [consumerId],
      });
    }
  }

  return drafts;
}

// --- 6. Globale Outcome-Änderungen -------------------------------------------

type GlobalRisk = WorldState["outcomes"]["global_risk"];

const GLOBAL_RISK_RANK: Record<GlobalRisk, number> = {
  stable: 0,
  strained: 1,
  critical: 2,
  collapsed: 3,
};

function deriveGlobalOutcomeEvents(previous: WorldState, next: WorldState): OpsEventDraft[] {
  const before = previous.outcomes.global_risk;
  const after = next.outcomes.global_risk;
  if (before === after) {
    return [];
  }

  const worsened = GLOBAL_RISK_RANK[after] > GLOBAL_RISK_RANK[before];

  let severity: OpsSeverity;
  let summary: string;
  if (after === "collapsed") {
    severity = "critical";
    summary = "Die Gesamtlage ist kollabiert.";
  } else if (after === "critical") {
    severity = "critical";
    summary = "Die Gesamtlage ist kritisch.";
  } else if (after === "strained") {
    severity = worsened ? "warning" : "success";
    summary = worsened
      ? "Die Gesamtlage ist angespannt."
      : "Die Gesamtlage entspannt sich.";
  } else {
    severity = "success";
    summary = "Die Gesamtlage hat sich stabilisiert.";
  }

  // Große globale Änderungen (kritisch/kollabiert oder volle Erholung) sind
  // auch für AURORA unmittelbar relevant.
  const major = after === "critical" || after === "collapsed" || after === "stable";

  return [
    {
      sector: "system",
      severity,
      kind: `system.global_risk.${after}`,
      summary,
      visibility: major ? { ...MAJOR_VISIBILITY } : { ...OPERATOR_VISIBILITY },
    },
  ];
}

/**
 * Reine Sensor-Funktion: vergleicht zwei WorldStates und liefert die OpsEvents
 * für alle beobachtbaren Übergänge. Mutiert nichts. Die Reihenfolge ist
 * deterministisch (Incident → Tod → Hospital → Energy-Knoten → Verbraucher →
 * Globalrisiko), damit Feed und Logs reproduzierbar bleiben.
 */
export function deriveOpsEvents(previousWorld: WorldState, nextWorld: WorldState): OpsEventDraft[] {
  return [
    ...deriveIncidentEvents(previousWorld, nextWorld),
    ...deriveDeathEvents(previousWorld, nextWorld),
    ...deriveHospitalEvents(previousWorld, nextWorld),
    ...deriveEnergyNodeEvents(previousWorld, nextWorld),
    ...deriveEnergyConsumerEvents(previousWorld, nextWorld),
    ...deriveGlobalOutcomeEvents(previousWorld, nextWorld),
  ];
}

/**
 * Hängt alle für den Übergang previousWorld→nextWorld abgeleiteten Sensor-
 * Events über `appendOpsEvent` an. Einziger Fan-out-Pfad — Sensoren schreiben
 * nie direkt in opsFeed, auroraContext oder Workspace-Logs.
 */
export function appendDerivedOpsEvents(
  state: GameRuntimeState,
  previousWorld: WorldState,
  nextWorld: WorldState
): GameRuntimeState {
  let next = state;
  for (const draft of deriveOpsEvents(previousWorld, nextWorld)) {
    next = appendOpsEvent(next, draft);
  }
  return next;
}
