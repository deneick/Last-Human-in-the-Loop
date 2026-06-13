import type { GameRuntimeState } from "./runtimeState";
import { appendAuditLog } from "./runtimeState";
import { emitDueScenarioSignals } from "./scenarioSignals";
import { appendDerivedOpsEvents } from "./opsFeedSensors";
import type {
  EnergyConsumerState,
  GridNodeState,
  HospitalRiskCounters,
  IncidentState,
  RoutingFailure,
  SheddingPlan,
  SheddingPlanStatus,
  WorldState,
} from "./types";
import { routingOverrideKey } from "../domain/medicalActions";
import { isHospitalSuitableFor } from "./selectors";

/**
 * Deterministic sector-agnostic tick pipeline:
 *
 *   advanceClock
 *   → tickMedicalDomain      (Fachsimulation Medical)
 *   → tickEnergyDomain       (Fachsimulation Energy)
 *   → applyCrossSectorEffects (no-op für den MVP, aber fester Pipeline-Schritt)
 *   → evaluateIncidents      (sektoragnostische Incident-Statuslogik)
 *
 * Die Fachdomänen kennen einander nicht. Sektoren interagieren später
 * ausschließlich über applyCrossSectorEffects.
 * No randomness, no real time.
 */

const MINUTES_PER_TICK = 10;
const STABLE_TICKS_TO_FIX = 10;

const ENERGY_STABLE_TICKS_TO_FIX = 3;
const GRID_INSTABILITY_FOR_ESCALATION = 4;
const GRID_INSTABILITY_FOR_COLLAPSE = 8;

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
 * Liefert den Plan-Status, der sich rein aus dem Zeitfenster ergibt:
 * scheduled vor created_at_tick + delay, active für duration Ticks, danach
 * completed. Abgebrochene Pläne bleiben abgebrochen.
 */
function deriveSheddingPlanStatus(plan: SheddingPlan, tick: number): SheddingPlanStatus {
  if (plan.status === "cancelled") {
    return "cancelled";
  }

  const startTick = plan.created_at_tick + plan.delay;
  if (tick < startTick) {
    return "scheduled";
  }
  if (tick < startTick + plan.duration) {
    return "active";
  }
  return "completed";
}

/**
 * Fachsimulation Energy: aktiviert Shedding-Pläne zeitverzögert, leitet
 * Versorgung, Verbraucher-Status und Knotenlast deterministisch daraus ab
 * und schreibt die lokalen Energy-Outcomes fort. Keine Kopplung zur
 * Medical-Domain — menschliche Folgen entstehen lokal als human_harm.
 */
export function tickEnergyDomain(world: WorldState): WorldState {
  const energy = world.domains.energy;
  if (!energy) {
    return world;
  }

  const tick = world.clock.tick;

  const nextPlans: Record<string, SheddingPlan> = {};
  for (const plan of Object.values(energy.shedding.plans)) {
    const status = deriveSheddingPlanStatus(plan, tick);
    nextPlans[plan.id] = status === plan.status ? plan : { ...plan, status };
  }

  // Versorgung folgt vollständig aus den gerade aktiven Plänen:
  // ein abgebrochener Plan verliert seine Wirkung damit zum nächsten Tick.
  const nextConsumers: Record<string, EnergyConsumerState> = {};
  for (const consumer of Object.values(energy.consumers)) {
    const shedTotal = Object.values(nextPlans)
      .filter((plan) => plan.status === "active" && plan.target_consumer_id === consumer.id)
      .reduce((sum, plan) => sum + plan.amount, 0);

    const currentSupply = Math.max(0, consumer.demand - shedTotal);
    nextConsumers[consumer.id] = {
      ...consumer,
      current_supply: currentSupply,
      status: shedTotal === 0 ? "nominal" : currentSupply > 0 ? "reduced" : "offline",
    };
  }

  // Lokale Outcomes — pro Tick genau einmal fortgeschrieben (die Zählung
  // lebt nur in dieser Pipeline-Stufe, nicht in der Outcome-Auswertung).
  let humanHarmDelta = 0;
  let economicLossDelta = 0;
  let civilUnrestDelta = 0;
  let gridInstabilityDelta = 0;

  for (const consumer of Object.values(nextConsumers)) {
    const belowMinimum = consumer.current_supply < consumer.minimum_supply;
    const reduced = consumer.current_supply < consumer.demand;

    if (belowMinimum && (consumer.criticality === "human-life" || consumer.criticality === "public-supply")) {
      humanHarmDelta += 1;
    }
    if (reduced && consumer.criticality === "economic") {
      economicLossDelta += 1;
    }
    if (reduced && consumer.criticality === "civil-stability") {
      civilUnrestDelta += 1;
    }
  }

  const nodeLoads: Record<string, number> = {};
  let anyNodeOverloaded = false;
  for (const node of Object.values(energy.nodes)) {
    const load = Object.values(nextConsumers)
      .filter((consumer) => consumer.node_id === node.id)
      .reduce((sum, consumer) => sum + consumer.current_supply, 0);
    nodeLoads[node.id] = load;

    if (load > node.safe_capacity) {
      anyNodeOverloaded = true;
      gridInstabilityDelta += 1;
    }
  }

  const nextInstability = energy.outcomes.grid_instability + gridInstabilityDelta;

  const nextNodes: Record<string, GridNodeState> = {};
  for (const node of Object.values(energy.nodes)) {
    const load = nodeLoads[node.id];
    const overloaded = load > node.safe_capacity;
    nextNodes[node.id] = {
      ...node,
      load,
      status: !overloaded
        ? "nominal"
        : nextInstability >= GRID_INSTABILITY_FOR_ESCALATION
          ? "critical"
          : "strained",
    };
  }

  const previousStableTicks = world.simulation.energy?.stable_ticks ?? 0;

  return {
    ...world,
    domains: {
      ...world.domains,
      energy: {
        ...energy,
        nodes: nextNodes,
        consumers: nextConsumers,
        shedding: { ...energy.shedding, plans: nextPlans },
        outcomes: {
          human_harm: energy.outcomes.human_harm + humanHarmDelta,
          economic_loss: energy.outcomes.economic_loss + economicLossDelta,
          civil_unrest: energy.outcomes.civil_unrest + civilUnrestDelta,
          grid_instability: nextInstability,
        },
      },
    },
    simulation: {
      ...world.simulation,
      energy: {
        stable_ticks: anyNodeOverloaded ? 0 : previousStableTicks + 1,
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

/**
 * Energy-Incident-Status aus dem öffentlichen Energy-Zustand plus dem
 * internen stable_ticks-Zähler: anhaltende Überlast eskaliert und kollabiert
 * über grid_instability; genügend überlastfreie Ticks in Folge fixieren.
 * "fixed" heißt: Grid stabilisiert nach Engine-Kriterien — nicht, dass kein
 * menschlicher oder wirtschaftlicher Preis bezahlt wurde.
 */
function evaluateEnergyIncident(world: WorldState, incident: IncidentState): IncidentState {
  const energy = world.domains.energy;
  if (!energy) {
    return incident;
  }

  if (energy.outcomes.grid_instability >= GRID_INSTABILITY_FOR_COLLAPSE) {
    return {
      ...incident,
      status: "collapsed",
      collapsed_at_tick: world.clock.tick,
    };
  }

  const stableTicks = world.simulation.energy?.stable_ticks ?? 0;

  if (stableTicks >= ENERGY_STABLE_TICKS_TO_FIX) {
    return {
      ...incident,
      status: "fixed",
      fixed_at_tick: world.clock.tick,
    };
  }

  if (stableTicks > 0) {
    return incident.status === "open" || incident.status === "escalated"
      ? { ...incident, status: "stabilizing" }
      : incident;
  }

  // Aktuell überlastet: Stabilisierung fällt zurück, anhaltende Instabilität eskaliert.
  if (incident.status === "stabilizing") {
    return { ...incident, status: "open" };
  }

  if (incident.status === "open" && energy.outcomes.grid_instability >= GRID_INSTABILITY_FOR_ESCALATION) {
    return { ...incident, status: "escalated" };
  }

  return incident;
}

function evaluateIncident(world: WorldState, incident: IncidentState): IncidentState {
  if (incident.status === "fixed" || incident.status === "collapsed") {
    return incident;
  }

  if (incident.sector_id === "energy") {
    return evaluateEnergyIncident(world, incident);
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

  next = tickEnergyDomain(next);

  next = applyCrossSectorEffects(next);

  next = evaluateIncidents(next);

  return next;
}

export function advanceTick(runtimeState: GameRuntimeState): GameRuntimeState {
  const previousWorld = runtimeState.world;
  const nextWorld = tickWorld(previousWorld);

  const audited = appendAuditLog(
    {
      ...runtimeState,
      world: nextWorld,
    },
    "system",
    "domain_action",
    "system.tick",
    true,
    `Tick ${nextWorld.clock.tick} completed`
  );

  // Runtime-Sensoren: beobachtbare Übergänge dieses Ticks (Incident-Status,
  // Energy-Knoten/-Verbraucher, Hospital-Auslastung) als OpsEvents — über
  // denselben appendOpsEvent-Projektionspfad, genau einmal je Übergang.
  const sensed = appendDerivedOpsEvents(audited, previousWorld, nextWorld);

  // Fällige Szenario-Signale (emitAtTick erreicht) erscheinen jetzt — und zwar
  // ausschließlich über die normale opsFeed-Projektion, genau einmal.
  return emitDueScenarioSignals(sensed);
}
