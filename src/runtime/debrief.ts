import type { GameRuntimeState, RuntimeAuditEvent } from "./runtimeState";
import type { IncidentStatus, WorldState } from "./types";
import { tickToClock } from "./scenarioClock";

/**
 * Schicht-Aufarbeitung ("Debrief") für das Rundenende.
 *
 * Anders als `viewModel.ts` darf dieses Modul BEWUSST die interne
 * Simulationswahrheit lesen (`world.simulation`, kausale Death-Buchführung):
 * Die Runde ist vorbei, also wird die während des Spiels verborgene Wahrheit
 * aufgedeckt. Es ist der EINZIGE Pfad mit diesem Privileg — der Live-Pfad
 * (viewModel, Read-only-Commands, Director) bleibt strikt auf den öffentlichen
 * View beschränkt. Deshalb läuft das Debrief NICHT über viewModel.ts.
 *
 * Datenfluss:
 * - `recordDebriefSnapshot` hält pro Tick die relevanten Kennzahlen fest
 *   (`GameRuntimeState.debriefTimeline`). Aus den Differenzen aufeinander
 *   folgender Snapshots ergibt sich, welche Wirkung in welchem Tick eintrat.
 * - `buildDebriefView` verschränkt diese Tick-Wirkungen mit den attribuierten
 *   Aktionen aus dem `auditLog` ("wer hat was gemacht") zu einer Chronik.
 */

export type DebriefDeathsByCause = {
  overload: number;
  capability_mismatch: number;
  transport_delay: number;
};

/** Fester Pro-Tick-Mitschnitt der entscheidungsrelevanten Kennzahlen. */
export type DebriefSnapshot = {
  tick: number;
  incidentStatuses: Record<string, IncidentStatus>;
  globalRisk: WorldState["outcomes"]["global_risk"];
  deathsTotal: number;
  deathsByCause: DebriefDeathsByCause;
  deathsByHospital: Record<string, number>;
  /** Todesfälle je Hospital nach Ursache (interne Wahrheit aus deaths_recorded). */
  deathsByHospitalCause: Record<string, { overload: number; capability_mismatch: number }>;
  /** Klasse (priority/capability) des aktiven Overrides je Ziel-Hospital, z. B. "P2/TRAUMA". */
  overrideClassByTarget: Record<string, string>;
  energy?: {
    humanHarm: number;
    economicLoss: number;
    civilUnrest: number;
    gridInstability: number;
  };
};

function snapshotFromWorld(world: WorldState): DebriefSnapshot {
  const medical = world.domains.medical.outcomes;
  const energy = world.domains.energy?.outcomes;

  const incidentStatuses: Record<string, IncidentStatus> = {};
  for (const incident of Object.values(world.incidents)) {
    incidentStatuses[incident.id] = incident.status;
  }

  const deathsByHospitalCause: Record<string, { overload: number; capability_mismatch: number }> = {};
  for (const [hospitalId, recorded] of Object.entries(world.simulation.medical.deaths_recorded)) {
    deathsByHospitalCause[hospitalId] = {
      overload: recorded.overload,
      capability_mismatch: recorded.capability_mismatch,
    };
  }

  const overrideClassByTarget: Record<string, string> = {};
  for (const override of Object.values(world.domains.medical.routing.manual_overrides)) {
    overrideClassByTarget[override.target_hospital_id] = `${override.priority}/${override.capability}`;
  }

  return {
    tick: world.clock.tick,
    incidentStatuses,
    globalRisk: world.outcomes.global_risk,
    deathsTotal: world.outcomes.human_harm.deaths_total,
    deathsByCause: { ...medical.deaths_by_cause },
    deathsByHospital: { ...medical.deaths_by_hospital },
    deathsByHospitalCause,
    overrideClassByTarget,
    ...(energy
      ? {
          energy: {
            humanHarm: energy.human_harm,
            economicLoss: energy.economic_loss,
            civilUnrest: energy.civil_unrest,
            gridInstability: energy.grid_instability,
          },
        }
      : {}),
  };
}

/** Baseline-Snapshot für den Szenariostart (Tick 0). */
export function initialDebriefSnapshot(world: WorldState): DebriefSnapshot {
  return snapshotFromWorld(world);
}

/**
 * Hängt den Snapshot des aktuellen Welt-Ticks an die Debrief-Timeline an.
 * Idempotent pro Tick: Ein bereits erfasster Tick wird nicht doppelt
 * geschrieben (schützt gegen mehrfaches Aufrufen je Tick).
 */
export function recordDebriefSnapshot(state: GameRuntimeState): GameRuntimeState {
  const tick = state.world.clock.tick;
  const last = state.debriefTimeline[state.debriefTimeline.length - 1];
  if (last && last.tick === tick) {
    return state;
  }

  return {
    ...state,
    debriefTimeline: [...state.debriefTimeline, snapshotFromWorld(state.world)],
  };
}

// --- View-Aufbau -----------------------------------------------------------

export type DebriefSeverity = "info" | "warning" | "critical" | "success";

export type DebriefActionView = {
  actor: "operator" | "aurora";
  actorLabel: string;
  label: string;
  /** Detail der Aktion (z. B. Quelle/Ziel/Klasse eines Overrides), falls vorhanden. */
  detail?: string;
  success: boolean;
};

export type DebriefEffectView = {
  text: string;
  severity: DebriefSeverity;
};

export type DebriefTickView = {
  tick: number;
  clock: string;
  actions: DebriefActionView[];
  effects: DebriefEffectView[];
};

export type DebriefView = {
  outcome: "fixed" | "collapsed";
  outcomeLabel: string;
  durationTicks: number;
  deathsTotal: number;
  deathsByCause: DebriefDeathsByCause;
  economicLoss: number | null;
  energyHumanHarm: number | null;
  timeline: DebriefTickView[];
  /**
   * Deterministische Fakten-Zusammenfassung der Schicht (Todesfälle nach
   * Ursache, kausal zugerechnete Eingriffe). Im Skript-Modus die angezeigte
   * Zusammenfassung; im LLM-Modus die Faktenbasis, aus der AURORA ihre
   * Prosa-Zusammenfassung schreibt (siehe `aurora/debriefSummary.ts`).
   */
  summary: DebriefEffectView[];
};

/** Deutsche Aktions-Labels (schreibende Domain-Actions). */
const WRITE_ACTION_LABELS: Record<string, string> = {
  "medical.routing.override.set": "Routing-Override gesetzt",
  "medical.routing.override.clear": "Routing-Override entfernt",
  "energy.priority.set": "Verbraucher-Systemklasse gesetzt",
  "energy.shedding.schedule": "Lastabwurf geplant",
  "energy.shedding.clear": "Lastabwurf zurückgenommen",
};

const STATUS_LABELS: Record<IncidentStatus, string> = {
  open: "offen",
  stabilizing: "stabilisiert sich",
  escalated: "eskaliert",
  fixed: "behoben",
  collapsed: "kollabiert",
};

const CAUSE_LABELS: Record<keyof DebriefDeathsByCause, string> = {
  overload: "Überlast",
  capability_mismatch: "fehlende Fachversorgung",
  transport_delay: "Transportverzögerung",
};

/** Korrekte Pluralform: 1 → "Todesfall", sonst "Todesfälle". */
function deathWord(count: number): string {
  return count === 1 ? "Todesfall" : "Todesfälle";
}

function actorLabel(source: RuntimeAuditEvent["source"]): "operator" | "aurora" | null {
  if (source === "player") return "operator";
  if (source === "aurora") return "aurora";
  return null;
}

/**
 * Bildet einen auditierten Vorgang auf eine sichtbare Aktion ab — oder `null`,
 * wenn er keine Lageveränderung ist (reine Reads, System-Ticks). Nur Aktionen,
 * die etwas bewirken, gehören in die Wirkungs-Chronik.
 */
function auditToAction(event: RuntimeAuditEvent): DebriefActionView | null {
  const actor = actorLabel(event.source);
  if (!actor) {
    return null;
  }

  const label = event.actionType ? WRITE_ACTION_LABELS[event.actionType] : undefined;
  if (label) {
    return {
      actor,
      actorLabel: actor === "operator" ? "Operator" : "AURORA",
      label,
      ...(event.detail ? { detail: event.detail } : {}),
      success: event.success,
    };
  }

  // Zugriffserweiterung: MCP-Server aktiviert (bash "mcp add <server>").
  if (event.kind === "bash" && event.description.trim().startsWith("mcp add")) {
    const server = event.description.trim().slice("mcp add".length).trim();
    return {
      actor,
      actorLabel: actor === "operator" ? "Operator" : "AURORA",
      label: server ? `MCP-Server ${server} aktiviert` : "MCP-Server aktiviert",
      success: event.success,
    };
  }

  return null;
}

function diffEffects(
  previous: DebriefSnapshot,
  current: DebriefSnapshot
): DebriefEffectView[] {
  const effects: DebriefEffectView[] = [];

  // Neue Todesfälle dieses Ticks — pro Hospital nach Ursache, in einer Zeile,
  // beim Capability-Mismatch mit der konkret fehlenden Klasse.
  const hospitalIds = new Set([
    ...Object.keys(current.deathsByHospitalCause),
    ...Object.keys(previous.deathsByHospitalCause),
  ]);
  for (const hospitalId of hospitalIds) {
    const cur = current.deathsByHospitalCause[hospitalId] ?? { overload: 0, capability_mismatch: 0 };
    const prev = previous.deathsByHospitalCause[hospitalId] ?? { overload: 0, capability_mismatch: 0 };

    const overloadDelta = cur.overload - prev.overload;
    if (overloadDelta > 0) {
      effects.push({
        text: `${overloadDelta} ${deathWord(overloadDelta)} in ${hospitalId} durch Überlast`,
        severity: "critical",
      });
    }

    const mismatchDelta = cur.capability_mismatch - prev.capability_mismatch;
    if (mismatchDelta > 0) {
      const klass = current.overrideClassByTarget[hospitalId];
      const reason = klass ? `fehlende ${klass} Versorgung` : "fehlende Fachversorgung";
      effects.push({
        text: `${mismatchDelta} ${deathWord(mismatchDelta)} in ${hospitalId} durch ${reason}`,
        severity: "critical",
      });
    }
  }

  // Incident-Statuswechsel.
  for (const incidentId of Object.keys(current.incidentStatuses)) {
    const before = previous.incidentStatuses[incidentId];
    const after = current.incidentStatuses[incidentId];
    if (before && after && before !== after) {
      effects.push({
        text: `${incidentId}: ${STATUS_LABELS[before]} → ${STATUS_LABELS[after]}`,
        severity:
          after === "collapsed" ? "critical" : after === "fixed" ? "success" : "warning",
      });
    }
  }

  // Energy-Outcome-Deltas.
  if (current.energy && previous.energy) {
    const humanHarmDelta = current.energy.humanHarm - previous.energy.humanHarm;
    if (humanHarmDelta > 0) {
      effects.push({ text: `+${humanHarmDelta} menschlicher Schaden`, severity: "critical" });
    }
    const economicDelta = current.energy.economicLoss - previous.energy.economicLoss;
    if (economicDelta > 0) {
      effects.push({ text: `+${economicDelta} wirtschaftlicher Schaden`, severity: "warning" });
    }
    const unrestDelta = current.energy.civilUnrest - previous.energy.civilUnrest;
    if (unrestDelta > 0) {
      effects.push({ text: `+${unrestDelta} zivile Unruhe`, severity: "warning" });
    }
  }

  return effects;
}

/**
 * Faktische Schluss-Zusammenfassung: bindet die finale interne Wahrheit
 * (Todesfälle nach Ursache und Hospital, am Ende noch aktive Eingriffe samt
 * Urheber) zu kurzen Sätzen zusammen. Faktisch, ohne Wertung.
 */
function buildSummary(state: GameRuntimeState): DebriefEffectView[] {
  const lines: DebriefEffectView[] = [];
  const medical = state.world.domains.medical.outcomes;

  for (const cause of Object.keys(medical.deaths_by_cause) as (keyof DebriefDeathsByCause)[]) {
    const count = medical.deaths_by_cause[cause];
    if (count > 0) {
      lines.push({
        text: `${count} ${deathWord(count)} durch ${CAUSE_LABELS[cause]}.`,
        severity: "critical",
      });
    }
  }

  // Capability-Mismatch-Tote hängen direkt an einem Override auf ein Ziel ohne
  // passende Fachversorgung — die kausalste Zurechnung, die die Engine kennt.
  const overrides = Object.values(state.world.domains.medical.routing.manual_overrides);
  for (const override of overrides) {
    const deathsAtTarget = medical.deaths_by_hospital[override.target_hospital_id] ?? 0;
    if (deathsAtTarget > 0) {
      const who = override.created_by === "player" ? "Operator" : "AURORA";
      lines.push({
        text: `Aktiver Override (${who}) leitete ${override.priority}/${override.capability} von ${override.source_hospital_id} auf ${override.target_hospital_id} — dort ${deathsAtTarget} ${deathWord(deathsAtTarget)}.`,
        severity: "warning",
      });
    }
  }

  // Am Rundenende noch aktive Drosselungen samt Urheber.
  const energy = state.world.domains.energy;
  if (energy) {
    for (const plan of Object.values(energy.shedding.plans)) {
      if (plan.status === "active" || plan.status === "scheduled") {
        const who = plan.created_by === "player" ? "Operator" : "AURORA";
        lines.push({
          text: `Offener Lastabwurf (${who}): ${plan.amount} auf ${plan.target_consumer_id} (${plan.status === "active" ? "aktiv" : "geplant"}).`,
          severity: "warning",
        });
      }
    }
  }

  return lines;
}

/**
 * Baut die Schicht-Chronik aus Debrief-Timeline (Pro-Tick-Wirkungen) und
 * auditLog (attribuierte Aktionen). Liefert `null`, solange kein Incident
 * einen Endzustand erreicht hat.
 */
export function buildDebriefView(state: GameRuntimeState): DebriefView | null {
  const finalIncident = Object.values(state.world.incidents).find(
    (incident) => incident.status === "fixed" || incident.status === "collapsed"
  );
  if (!finalIncident) {
    return null;
  }

  const scenarioStart = state.world.clock.scenario_time;
  const outcome = finalIncident.status === "fixed" ? "fixed" : "collapsed";

  // Aktionen je Tick aus dem auditLog (in Reihenfolge).
  const actionsByTick = new Map<number, DebriefActionView[]>();
  for (const event of state.auditLog) {
    const action = auditToAction(event);
    if (!action) {
      continue;
    }
    const list = actionsByTick.get(event.tick) ?? [];
    list.push(action);
    actionsByTick.set(event.tick, list);
  }

  // Wirkungen je Tick aus den Snapshot-Differenzen.
  const timeline: DebriefTickView[] = [];
  const snapshots = state.debriefTimeline;
  for (let i = 1; i < snapshots.length; i += 1) {
    const tick = snapshots[i].tick;
    const effects = diffEffects(snapshots[i - 1], snapshots[i]);
    const actions = actionsByTick.get(tick) ?? [];

    if (effects.length === 0 && actions.length === 0) {
      continue;
    }

    timeline.push({
      tick,
      clock: tickToClock(scenarioStart, tick),
      actions,
      effects,
    });
  }

  // Aktionen am Tick 0 (vor dem ersten Snapshot-Delta) nicht verlieren.
  const tickZeroActions = actionsByTick.get(0);
  if (tickZeroActions && tickZeroActions.length > 0) {
    timeline.unshift({
      tick: 0,
      clock: tickToClock(scenarioStart, 0),
      actions: tickZeroActions,
      effects: [],
    });
  }

  const energy = state.world.domains.energy?.outcomes;

  return {
    outcome,
    outcomeLabel: outcome === "fixed" ? "Behoben" : "Kollabiert",
    durationTicks: state.world.clock.tick,
    deathsTotal: state.world.outcomes.human_harm.deaths_total,
    deathsByCause: { ...state.world.domains.medical.outcomes.deaths_by_cause },
    economicLoss: energy ? energy.economic_loss : null,
    energyHumanHarm: energy ? energy.human_harm : null,
    timeline,
    summary: buildSummary(state),
  };
}
