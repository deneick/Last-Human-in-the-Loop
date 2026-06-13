import type { GameRuntimeState } from "./runtimeState";
import { appendAuditLog } from "./runtimeState";
import { appendDerivedOpsEvents } from "./opsFeedSensors";
import type { RecordedDeaths, WorldOutcomeState, WorldState } from "./types";

/**
 * Deterministic outcome engine for translating risks into consequences.
 * - Overload deaths: 1 death per 3 overload ticks at the affected hospital
 * - Mismatch deaths: 1 death per 4 capability mismatch ticks at the wrong target
 * - Escalates incidents when deaths reach threshold, collapses at critical threshold
 * - Syncs the sector-agnostic WorldOutcomeState from medical outcomes
 * - Idempotent via simulation.medical.deaths_recorded ledger
 * - No randomness, no real time
 */

const OVERLOAD_TICKS_PER_DEATH = 3;
const MISMATCH_TICKS_PER_DEATH = 4;
const DEATHS_FOR_ESCALATION = 1;
const DEATHS_FOR_COLLAPSE = 3;

function evaluateMedicalDeaths(world: WorldState): {
  world: WorldState;
  newDeaths: number;
  auditEntries: string[];
} {
  const hospitals = world.domains.medical.hospitals;
  const ledger = world.simulation.medical.deaths_recorded;

  const updatedLedger: Record<string, RecordedDeaths> = { ...ledger };
  const updatedOutcomes = { ...world.domains.medical.outcomes };
  const updatedDeathsByCause = { ...updatedOutcomes.deaths_by_cause };
  const updatedDeathsByHospital = { ...updatedOutcomes.deaths_by_hospital };
  const auditEntries: string[] = [];
  let newDeaths = 0;

  for (const hospitalId of Object.keys(hospitals)) {
    const counters = hospitals[hospitalId].risk_counters;
    const recorded = updatedLedger[hospitalId] ?? { overload: 0, capability_mismatch: 0 };

    const expectedOverloadDeaths = Math.floor((counters?.overload_ticks ?? 0) / OVERLOAD_TICKS_PER_DEATH);
    const expectedMismatchDeaths = Math.floor(
      (counters?.capability_mismatch_ticks ?? 0) / MISMATCH_TICKS_PER_DEATH
    );

    const newOverloadDeaths = Math.max(0, expectedOverloadDeaths - recorded.overload);
    const newMismatchDeaths = Math.max(0, expectedMismatchDeaths - recorded.capability_mismatch);

    if (newOverloadDeaths === 0 && newMismatchDeaths === 0) {
      continue;
    }

    updatedLedger[hospitalId] = {
      overload: recorded.overload + newOverloadDeaths,
      capability_mismatch: recorded.capability_mismatch + newMismatchDeaths,
    };

    updatedDeathsByHospital[hospitalId] =
      (updatedDeathsByHospital[hospitalId] ?? 0) + newOverloadDeaths + newMismatchDeaths;
    updatedDeathsByCause.overload += newOverloadDeaths;
    updatedDeathsByCause.capability_mismatch += newMismatchDeaths;
    newDeaths += newOverloadDeaths + newMismatchDeaths;

    if (newOverloadDeaths > 0) {
      auditEntries.push(`${newOverloadDeaths} death(s) from overload at ${hospitalId}`);
    }
    if (newMismatchDeaths > 0) {
      auditEntries.push(`${newMismatchDeaths} death(s) from capability mismatch at ${hospitalId}`);
    }
  }

  if (newDeaths === 0) {
    return { world, newDeaths, auditEntries };
  }

  updatedOutcomes.deaths_total += newDeaths;
  updatedOutcomes.deaths_by_cause = updatedDeathsByCause;
  updatedOutcomes.deaths_by_hospital = updatedDeathsByHospital;

  return {
    world: {
      ...world,
      domains: {
        ...world.domains,
        medical: { ...world.domains.medical, outcomes: updatedOutcomes },
      },
      simulation: {
        ...world.simulation,
        medical: { ...world.simulation.medical, deaths_recorded: updatedLedger },
      },
    },
    newDeaths,
    auditEntries,
  };
}

function escalateIncidents(world: WorldState): WorldState {
  const deathsTotal = world.domains.medical.outcomes.deaths_total;
  const updatedIncidents = { ...world.incidents };
  let changed = false;

  for (const incidentId of Object.keys(updatedIncidents)) {
    const incident = updatedIncidents[incidentId];

    if (deathsTotal >= DEATHS_FOR_COLLAPSE && incident.status !== "fixed" && incident.status !== "collapsed") {
      updatedIncidents[incidentId] = {
        ...incident,
        status: "collapsed",
        collapsed_at_tick: world.clock.tick,
      };
      changed = true;
      continue;
    }

    // Eskalation trifft nur unkontrollierte Incidents; wer aktiv stabilisiert,
    // fällt nicht jede Auswertung erneut zurück.
    if (deathsTotal >= DEATHS_FOR_ESCALATION && incident.status === "open") {
      updatedIncidents[incidentId] = {
        ...incident,
        status: "escalated",
      };
      changed = true;
    }
  }

  return changed ? { ...world, incidents: updatedIncidents } : world;
}

const ENERGY_HARM_FOR_CRITICAL = 4;
const GRID_INSTABILITY_FOR_STRAIN = 2;

export function evaluateWorldOutcomes(world: WorldState): WorldState {
  const medicalOutcomes = world.domains.medical.outcomes;
  const deathsTotal = medicalOutcomes.deaths_total;

  // Energy-Lage fließt über die lokalen Outcomes in das globale Risiko ein —
  // ohne Kopplung der Fachdomänen und ohne den Medical-Death-Counter zu berühren.
  const energyOutcomes = world.domains.energy?.outcomes;
  const energyHumanHarm = energyOutcomes?.human_harm ?? 0;
  const gridInstability = energyOutcomes?.grid_instability ?? 0;

  const collapsedIncident = Object.values(world.incidents).find(
    (incident) => incident.status === "collapsed"
  );
  const anyEscalated = Object.values(world.incidents).some(
    (incident) => incident.status === "escalated"
  );

  let globalRisk: WorldOutcomeState["global_risk"] = "stable";
  if (collapsedIncident) {
    globalRisk = "collapsed";
  } else if (deathsTotal >= 2 || energyHumanHarm >= ENERGY_HARM_FOR_CRITICAL) {
    globalRisk = "critical";
  } else if (
    deathsTotal >= 1 ||
    anyEscalated ||
    energyHumanHarm >= 1 ||
    gridInstability >= GRID_INSTABILITY_FOR_STRAIN
  ) {
    globalRisk = "strained";
  }

  const nextOutcomes: WorldOutcomeState = {
    global_risk: globalRisk,
    collapsed: !!collapsedIncident,
    ...(collapsedIncident
      ? { collapse_reason: `Incident ${collapsedIncident.id} collapsed` }
      : {}),
    human_harm: {
      deaths_total: deathsTotal,
      preventable_deaths: medicalOutcomes.preventable_deaths,
    },
  };

  if (JSON.stringify(nextOutcomes) === JSON.stringify(world.outcomes)) {
    return world;
  }

  return { ...world, outcomes: nextOutcomes };
}

export function evaluateOutcomes(runtimeState: GameRuntimeState): GameRuntimeState {
  const previousWorld = runtimeState.world;
  const deathsResult = evaluateMedicalDeaths(previousWorld);
  let nextWorld = deathsResult.world;

  const incidentsBefore = nextWorld.incidents;
  nextWorld = escalateIncidents(nextWorld);
  nextWorld = evaluateWorldOutcomes(nextWorld);

  if (nextWorld === previousWorld) {
    return runtimeState;
  }

  const auditMessages = [...deathsResult.auditEntries];
  for (const incidentId of Object.keys(nextWorld.incidents)) {
    const before = incidentsBefore[incidentId];
    const after = nextWorld.incidents[incidentId];
    if (before && after && before.status !== after.status) {
      auditMessages.push(`${incidentId} status changed from ${before.status} to ${after.status}`);
    }
  }

  let nextState: GameRuntimeState = {
    ...runtimeState,
    world: nextWorld,
  };

  // Technisches Audit-Log bleibt technisch (Engine-Wortlaut). Es wird nur
  // geschrieben, wenn es etwas zu protokollieren gibt.
  if (auditMessages.length > 0) {
    nextState = appendAuditLog(
      nextState,
      "system",
      "domain_action",
      "system.evaluate_outcomes",
      true,
      auditMessages.join(" | ")
    );
  }

  // Runtime-Sensoren: beobachtbare Outcome-Übergänge (neue Todesfälle,
  // Incident-Eskalation/-Kollaps, globales Risiko) als spielsichtbare OpsEvents.
  // Immer ausgeführt, wenn sich der WorldState geändert hat — auch ohne
  // Audit-Eintrag (z. B. reiner Globalrisiko-Wechsel ohne Incident-Statuswechsel).
  return appendDerivedOpsEvents(nextState, previousWorld, nextWorld);
}
