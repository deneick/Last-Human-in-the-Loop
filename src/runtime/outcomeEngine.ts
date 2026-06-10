import type { GameRuntimeState } from "./runtimeState";
import { appendAuditLog } from "./runtimeState";
import type { WorldState } from "./types";

/**
 * Deterministic outcome engine for translating risks into consequences.
 * - Calculates deaths from hospital overload (1 death per 3 overload ticks)
 * - Escalates incidents when deaths reach threshold
 * - Collapses incidents at critical death threshold
 * - Idempotent: multiple calls with same state produce no duplicate deaths
 * - No randomness, no real time, no Game Over
 */

const OVERLOAD_TICKS_PER_DEATH = 3; // 1 death per 3 overload ticks
const DEATHS_FOR_ESCALATION = 1; // deaths_total >= 1 triggers escalation
const DEATHS_FOR_COLLAPSE = 3; // deaths_total >= 3 triggers collapse

/**
 * Evaluate outcomes based on current hospital risk counters and incident states.
 * Idempotent: comparing expected vs current deaths prevents duplicate counting.
 */
export function evaluateOutcomes(runtimeState: GameRuntimeState): GameRuntimeState {
  let nextWorld = { ...runtimeState.world };
  let nextState = runtimeState;
  let hasChanges = false;

  // Step 1: Calculate and apply deaths from hospital overload
  const deathsAuditEntries: string[] = [];
  const updatedOutcomes = { ...nextWorld.domains.medical.outcomes };
  const updatedDeathsByCause = { ...updatedOutcomes.deaths_by_cause };
  const updatedDeathsByHospital = { ...updatedOutcomes.deaths_by_hospital };
  let totalNewDeaths = 0;

  for (const hospitalId of Object.keys(nextWorld.domains.medical.hospitals)) {
    const hospital = nextWorld.domains.medical.hospitals[hospitalId];
    const overloadTicks = hospital.risk_counters?.overload_ticks ?? 0;

    // Calculate expected deaths based on current overload ticks
    const expectedDeaths = Math.floor(overloadTicks / OVERLOAD_TICKS_PER_DEATH);

    // Get current deaths for this hospital
    const currentDeaths = updatedDeathsByHospital[hospitalId] ?? 0;

    // Idempotent check: only add new deaths if expected > current
    if (expectedDeaths > currentDeaths) {
      const newDeaths = expectedDeaths - currentDeaths;
      totalNewDeaths += newDeaths;
      updatedDeathsByHospital[hospitalId] = expectedDeaths;
      deathsAuditEntries.push(`${newDeaths} death(s) from overload at ${hospitalId}`);
    }
  }

  // Apply death totals if any new deaths occurred
  if (totalNewDeaths > 0) {
    hasChanges = true;
    updatedOutcomes.deaths_total += totalNewDeaths;
    updatedDeathsByCause.overload += totalNewDeaths;
    updatedOutcomes.deaths_by_cause = updatedDeathsByCause;
    updatedOutcomes.deaths_by_hospital = updatedDeathsByHospital;
    nextWorld = {
      ...nextWorld,
      domains: {
        ...nextWorld.domains,
        medical: { ...nextWorld.domains.medical, outcomes: updatedOutcomes },
      },
    };
  }

  // Step 2: Escalate/collapse incidents based on death totals
  const updatedIncidents = { ...nextWorld.incidents };

  for (const incidentId of Object.keys(updatedIncidents)) {
    const incident = updatedIncidents[incidentId];
    let updatedIncident = incident;
    let escalationAction = "";

    // Escalate: deaths >= 1 and incident is open
    if (updatedOutcomes.deaths_total >= DEATHS_FOR_ESCALATION && incident.status === "open") {
      updatedIncident = {
        ...updatedIncident,
        status: "escalated",
      };
      escalationAction = "escalated";
      hasChanges = true;
    }

    // Collapse: deaths >= 3, incident not fixed, and not already collapsed
    if (
      updatedOutcomes.deaths_total >= DEATHS_FOR_COLLAPSE &&
      incident.status !== "fixed" &&
      incident.status !== "collapsed"
    ) {
      updatedIncident = {
        ...updatedIncident,
        status: "collapsed",
        collapsed_at_tick: nextWorld.clock.tick,
      };
      escalationAction = "collapsed";
      hasChanges = true;
    }

    if (escalationAction) {
      updatedIncidents[incidentId] = updatedIncident;
    }
  }

  if (Object.keys(updatedIncidents).some((id) => updatedIncidents[id] !== nextWorld.incidents[id])) {
    nextWorld = { ...nextWorld, incidents: updatedIncidents };
  }

  // Step 3: Append audit log entries if anything changed
  if (hasChanges) {
    nextState = {
      ...nextState,
      world: nextWorld,
    };

    const auditMessages = [];
    if (totalNewDeaths > 0) {
      auditMessages.push(`${totalNewDeaths} new overload death(s): ${deathsAuditEntries.join("; ")}`);
    }

    // Check for incident status changes
    for (const incidentId of Object.keys(updatedIncidents)) {
      const before = runtimeState.world.incidents[incidentId];
      const after = updatedIncidents[incidentId];
      if (before && after && before.status !== after.status) {
        auditMessages.push(`${incidentId} status changed from ${before.status} to ${after.status}`);
      }
    }

    const message = auditMessages.join(" | ");
    nextState = appendAuditLog(
      nextState,
      "system",
      { raw: "system.evaluate_outcomes", name: "system.evaluate_outcomes", args: [], flags: {} },
      true,
      message
    );
  }

  return nextState;
}
