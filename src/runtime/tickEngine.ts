import type { GameRuntimeState } from "./runtimeState";
import { appendAuditLog } from "./runtimeState";
import { isHospitalOverloaded } from "./selectors";

/**
 * Deterministic tick engine for game simulation.
 * - Advances clock by 1 tick
 * - Updates hospital risk counters based on overload state
 * - Advances incident timers
 * - Marks incidents as fixed after sufficient ticks in stabilizing state
 * - Logs system audit events
 * - No randomness, no real time, no Game Over
 */

const TICKS_TO_STABILIZE = 10; // Number of ticks needed to transition from stabilizing to fixed

export function advanceTick(runtimeState: GameRuntimeState): GameRuntimeState {
  let nextWorld = { ...runtimeState.world };

  // Advance clock
  nextWorld = {
    ...nextWorld,
    clock: {
      ...nextWorld.clock,
      tick: nextWorld.clock.tick + 1,
    },
  };

  // Update hospital risk counters based on overload state
  const updatedHospitals = { ...nextWorld.domains.medical.hospitals };
  for (const hospitalId of Object.keys(updatedHospitals)) {
    const hospital = updatedHospitals[hospitalId];
    const isOverloaded = isHospitalOverloaded(nextWorld, hospitalId);

    const currentCounters = hospital.risk_counters ?? { overload_ticks: 0, capability_mismatch_ticks: 0 };

    if (isOverloaded) {
      updatedHospitals[hospitalId] = {
        ...hospital,
        risk_counters: {
          ...currentCounters,
          overload_ticks: currentCounters.overload_ticks + 1,
        },
      };
    } else {
      // Reset overload counter when no longer overloaded
      updatedHospitals[hospitalId] = {
        ...hospital,
        risk_counters: {
          ...currentCounters,
          overload_ticks: 0,
        },
      };
    }
  }
  nextWorld = {
    ...nextWorld,
    domains: {
      ...nextWorld.domains,
      medical: { ...nextWorld.domains.medical, hospitals: updatedHospitals },
    },
  };

  // Update incident timers and statuses
  const updatedIncidents = { ...nextWorld.incidents };
  for (const incidentId of Object.keys(updatedIncidents)) {
    const incident = updatedIncidents[incidentId];

    // Advance ticks_since_opened
    let updatedIncident = {
      ...incident,
      ticks_since_opened: incident.ticks_since_opened + 1,
    };

    // Advance ticks_since_safe_apply if not null
    if (updatedIncident.ticks_since_safe_apply !== null) {
      updatedIncident = {
        ...updatedIncident,
        ticks_since_safe_apply: updatedIncident.ticks_since_safe_apply + 1,
      };

      // Transition to fixed after sufficient ticks in stabilizing state
      // Only if all conditions are met: status, safe apply counter, target hospital, and tick threshold
      if (
        updatedIncident.status === "stabilizing" &&
        updatedIncident.ticks_since_safe_apply !== null &&
        updatedIncident.planned_target_hospital_id === "hospital-east-09" &&
        updatedIncident.ticks_since_safe_apply >= TICKS_TO_STABILIZE
      ) {
        updatedIncident = {
          ...updatedIncident,
          status: "fixed",
          fixed_at: nextWorld.clock.scenario_time, // Use current scenario time
        };
      }
    }

    updatedIncidents[incidentId] = updatedIncident;
  }
  nextWorld = { ...nextWorld, incidents: updatedIncidents };

  // Append system audit log entry
  const nextState = appendAuditLog(
    {
      ...runtimeState,
      world: nextWorld,
    },
    "system",
    { raw: "system.tick", name: "system.tick", args: [], flags: {} },
    true,
    `Tick ${nextWorld.clock.tick} completed`
  );

  return nextState;
}
