import type { GameRuntimeState } from "./runtimeState";
import { appendAuditLog } from "./runtimeState";
import type {
  HospitalRiskCounters,
  IncidentState,
  RoutingFailure,
  WorldState,
} from "./types";
import { routingOverrideKey } from "./medicalCommands";
import { isHospitalSuitableFor } from "./selectors";

/**
 * Deterministic sector-agnostic tick pipeline:
 *
 *   advanceClock
 *   → tickMedicalDomain      (Fachsimulation Medical)
 *   → applyCrossSectorEffects (no-op für den MVP, aber fester Pipeline-Schritt)
 *   → evaluateIncidents      (sektoragnostische Incident-Statuslogik)
 *
 * Die Fachdomänen kennen einander nicht. Sektoren interagieren später
 * ausschließlich über applyCrossSectorEffects.
 * No randomness, no real time.
 */

const MINUTES_PER_TICK = 10;
const STABLE_TICKS_TO_FIX = 10;

type RoutingFailureResolution = "controlled" | "mismatch" | "uncontrolled";

function resolveRoutingFailure(world: WorldState, failure: RoutingFailure): RoutingFailureResolution {
  const key = routingOverrideKey(failure.affected_hospital_id, failure.priority, failure.capability);
  const override = world.domains.medical.routing.manual_overrides[key];

  if (!override || override.target_hospital_id === failure.affected_hospital_id) {
    // Kein Override oder Override auf sich selbst: keine Verbesserung.
    return "uncontrolled";
  }

  const target = world.domains.medical.hospitals[override.target_hospital_id];
  const targetHasFreeCapacity =
    !!target && target.capacity.staffed_beds_occupied < target.capacity.staffed_beds_total;
  const targetIsSuitable = isHospitalSuitableFor(
    world,
    override.target_hospital_id,
    failure.priority,
    failure.capability
  );

  return targetIsSuitable && targetHasFreeCapacity ? "controlled" : "mismatch";
}

function advanceClock(world: WorldState): WorldState {
  return {
    ...world,
    clock: {
      ...world.clock,
      tick: world.clock.tick + 1,
      elapsed_minutes: world.clock.elapsed_minutes + MINUTES_PER_TICK,
    },
  };
}

export function tickMedicalDomain(world: WorldState): WorldState {
  const failures = world.simulation.medical.routing_failures;
  const resolutions = new Map<string, RoutingFailureResolution>();

  const nextFailures = failures.map((failure) => {
    const resolution = resolveRoutingFailure(world, failure);
    resolutions.set(failure.id, resolution);

    if (resolution === "controlled") {
      return {
        ...failure,
        overflow_cases: Math.max(0, failure.overflow_cases - failure.clearance_per_tick),
        stable_ticks: failure.stable_ticks + 1,
      };
    }

    if (resolution === "mismatch") {
      // Quelle wird teilweise entlastet, aber die Fälle landen am falschen Ziel.
      return {
        ...failure,
        mismatch_ticks: failure.mismatch_ticks + 1,
        stable_ticks: 0,
      };
    }

    return {
      ...failure,
      overflow_cases:
        failure.overflow_cases + Math.max(0, failure.excess_cases_per_tick - failure.clearance_per_tick),
      stable_ticks: 0,
    };
  });

  // Hospital-Risikozähler aus den Routing Failures ableiten.
  // Nur kritische unkontrollierte Failures erzeugen Overload-Druck.
  const overloadedHospitalIds = new Set<string>();
  const mismatchTargetHospitalIds = new Set<string>();

  for (const failure of failures) {
    const resolution = resolutions.get(failure.id);
    if (resolution === "uncontrolled" && failure.severity === "critical") {
      overloadedHospitalIds.add(failure.affected_hospital_id);
    }
    if (resolution === "mismatch") {
      const key = routingOverrideKey(failure.affected_hospital_id, failure.priority, failure.capability);
      const override = world.domains.medical.routing.manual_overrides[key];
      if (override) {
        mismatchTargetHospitalIds.add(override.target_hospital_id);
      }
    }
  }

  const nextHospitals = { ...world.domains.medical.hospitals };
  for (const hospitalId of Object.keys(nextHospitals)) {
    const hospital = nextHospitals[hospitalId];
    const counters: HospitalRiskCounters = hospital.risk_counters ?? {
      overload_ticks: 0,
      capability_mismatch_ticks: 0,
    };

    nextHospitals[hospitalId] = {
      ...hospital,
      risk_counters: {
        overload_ticks: overloadedHospitalIds.has(hospitalId) ? counters.overload_ticks + 1 : 0,
        capability_mismatch_ticks: mismatchTargetHospitalIds.has(hospitalId)
          ? counters.capability_mismatch_ticks + 1
          : 0,
      },
    };
  }

  return {
    ...world,
    domains: {
      ...world.domains,
      medical: {
        ...world.domains.medical,
        hospitals: nextHospitals,
      },
    },
    simulation: {
      ...world.simulation,
      medical: {
        ...world.simulation.medical,
        routing_failures: nextFailures,
      },
    },
  };
}

/**
 * Cross-Sector-Stufe der Tick-Pipeline.
 * Für den MVP ein no-op; später verbinden hier explizite Effekte die Sektoren
 * (z. B. Energy outage → Hospital intake capacity drops).
 */
export function applyCrossSectorEffects(world: WorldState): WorldState {
  return world;
}

function evaluateIncident(world: WorldState, incident: IncidentState): IncidentState {
  if (incident.status === "fixed" || incident.status === "collapsed") {
    return incident;
  }

  const criticalFailures = world.simulation.medical.routing_failures.filter(
    (failure) => failure.incident_id === incident.id && failure.severity === "critical"
  );

  if (criticalFailures.length === 0) {
    return incident;
  }

  // stable_ticks > 0 bedeutet: Der Failure war im letzten Tick unter Kontrolle.
  const allControlled = criticalFailures.every((failure) => failure.stable_ticks > 0);

  if (allControlled && criticalFailures.every((failure) => failure.stable_ticks >= STABLE_TICKS_TO_FIX)) {
    return {
      ...incident,
      status: "fixed",
      fixed_at_tick: world.clock.tick,
    };
  }

  if (allControlled && incident.status === "open") {
    return { ...incident, status: "stabilizing" };
  }

  if (!allControlled && incident.status === "stabilizing") {
    return { ...incident, status: "open" };
  }

  return incident;
}

export function evaluateIncidents(world: WorldState): WorldState {
  const nextIncidents = { ...world.incidents };
  let changed = false;

  for (const incidentId of Object.keys(nextIncidents)) {
    const next = evaluateIncident(world, nextIncidents[incidentId]);
    if (next !== nextIncidents[incidentId]) {
      nextIncidents[incidentId] = next;
      changed = true;
    }
  }

  return changed ? { ...world, incidents: nextIncidents } : world;
}

export function tickWorld(world: WorldState): WorldState {
  let next = advanceClock(world);

  next = tickMedicalDomain(next);

  next = applyCrossSectorEffects(next);

  next = evaluateIncidents(next);

  return next;
}

export function advanceTick(runtimeState: GameRuntimeState): GameRuntimeState {
  const nextWorld = tickWorld(runtimeState.world);

  return appendAuditLog(
    {
      ...runtimeState,
      world: nextWorld,
    },
    "system",
    { raw: "system.tick", name: "system.tick", args: [], flags: {} },
    true,
    `Tick ${nextWorld.clock.tick} completed`
  );
}
