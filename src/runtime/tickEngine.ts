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
import { MINUTES_PER_TICK } from "./scenarioClock";

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

const STABLE_TICKS_TO_FIX = 10;

const ENERGY_STABLE_TICKS_TO_FIX = 3;
const GRID_INSTABILITY_FOR_ESCALATION = 4;
const GRID_INSTABILITY_FOR_COLLAPSE = 8;

// Cross-Sector-Rückkopplungen der Nicht-Strom-Verbraucher auf den Medical-Sektor.
// Wasser kurz → Durchsatz/Clearance sinkt; Zivil/Wohn kurz → mehr Krankenfälle.
const WATER_CLEARANCE_PENALTY = 1;
const CIVIL_EXTRA_CASES_PER_TICK = 1;

/**
 * Verbraucher-Id, deren Stromversorgung die Notfallkapazität der Medical-
 * Hospitals trägt. In der Kombi-Welt versorgt dieser Energy-Verbraucher die
 * ME-7741-Region; in reinen Einzelsektor-Welten existiert er nicht.
 *
 * Diese Kopplung ist die Quelle des Medical-Drucks: Erst wenn dieser Verbraucher
 * unter sein Minimum fällt, entsteht überhaupt ein Routing-Overflow (siehe
 * tickMedicalDomain) und schrumpft die Notfallkapazität (applyCrossSectorEffects).
 */
export const MEDICAL_POWER_CONSUMER_ID = "consumer-medical-east";

// Ein Override ist "aktiv", wenn er existiert und auf ein anderes Haus zeigt:
// dann wandern die Fälle physisch dorthin (Quelle wird entlastet, Ziel geladen).
// Ob sie dort behandelt werden können, ist eine separate Frage (Eignung) und
// entscheidet nur über die Behandelbarkeit — nicht über die Verschiebung selbst.
type RoutingFailureResolution = "controlled" | "mismatch" | "uncontrolled";

function resolveRoutingFailure(world: WorldState, failure: RoutingFailure): RoutingFailureResolution {
  const key = routingOverrideKey(failure.affected_hospital_id, failure.priority, failure.capability);
  const override = world.domains.medical.routing.manual_overrides[key];

  if (!override || override.target_hospital_id === failure.affected_hospital_id) {
    // Kein Override oder Override auf sich selbst: Fälle bleiben an der Quelle.
    return "uncontrolled";
  }

  // Klinische Eignung (Capability + akzeptierte Priorität) entscheidet, ob die
  // umgeleiteten Patienten am Ziel überhaupt behandelt werden können. Freie
  // Kapazität wird hier NICHT geprüft — eine Überlast am Ziel manifestiert sich
  // emergent über die Belegung (Notfall-Overload → Tote), nicht über die
  // Klassifikation. Ein geeignetes, aber zu kleines Ziel läuft also über.
  const targetIsSuitable = isHospitalSuitableFor(
    world,
    override.target_hospital_id,
    failure.priority,
    failure.capability
  );

  return targetIsSuitable ? "controlled" : "mismatch";
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
  const overrides = world.domains.medical.routing.manual_overrides;
  const hospitals = world.domains.medical.hospitals;
  const consumers = world.domains.energy?.consumers;

  // Ist diese Medical-Welt stromgekoppelt? Dann entsteht der Routing-Overflow
  // erst durch Strommangel am speisenden Feed, und die Incident-Stabilisierung
  // greift nur, wenn kein Haus überlastet ist (ME nicht ohne Grid lösbar).
  // Reine Einzelsektor-Medical-Welten (kein Energy-Verbraucher) verhalten sich
  // unverändert.
  const worldCoupled = !!consumers && Object.keys(hospitals).length > 0;

  // Versorgungslage eines beliebigen Feeds (unter Minimum?). Basis für alle
  // Cross-Sector-Rückkopplungen.
  const consumerShort = (consumerId: string | undefined): boolean => {
    if (!consumers || !consumerId) {
      return false;
    }
    const consumer = consumers[consumerId];
    return !!consumer && consumer.current_supply < consumer.minimum_supply;
  };

  // Strom-Feed (Fallback: Standard-Feed). Getrennte Feeds: ein Abwurf trifft nur
  // die daran hängenden Häuser.
  const feedShortFor = (hospitalId: string): boolean => {
    if (!consumers) {
      return false;
    }
    return consumerShort(hospitals[hospitalId]?.power_feed_consumer_id ?? MEDICAL_POWER_CONSUMER_ID);
  };
  // Wasser-Feed kurz → gedrosselte Clearance (langsamerer Durchsatz).
  const waterShortFor = (hospitalId: string): boolean =>
    consumerShort(hospitals[hospitalId]?.water_feed_consumer_id);
  // Zivil-/Wohn-Feed kurz → zusätzliche Krankenfälle (Unruhe), Overflow steigt.
  const civilShortFor = (hospitalId: string): boolean =>
    consumerShort(hospitals[hospitalId]?.civil_feed_consumer_id);

  const resolutions = new Map<string, RoutingFailureResolution>();

  // Pass 1: Failures fortschreiben (Overflow/Umleitung/Mismatch). Der Rückstau
  // eines unkontrollierten Failures wächst nur, wenn sein Strom-Feed
  // unterversorgt ist (in einer ungekoppelten Welt wie bisher immer). So
  // entsteht der Overflow erst durch Strommangel. Zwei weitere Rückkopplungen:
  //  - Wasser kurz → effektive `clearance` gedrosselt (Overflow drainiert
  //    langsamer; bei vollem Wasser ohne Effekt).
  //  - Zivil/Wohn kurz → zusätzliche Krankenfälle je Tick (Unruhe), unabhängig
  //    vom Strom (bei voller Versorgung ohne Effekt).
  // stable_ticks wird erst in Pass 2 gesetzt (hängt von der Overload-Lage ab).
  const advanced = failures.map((failure) => {
    const resolution = resolveRoutingFailure(world, failure);
    resolutions.set(failure.id, resolution);

    const hospitalId = failure.affected_hospital_id;
    const effectiveClearance = waterShortFor(hospitalId)
      ? Math.max(0, failure.clearance_per_tick - WATER_CLEARANCE_PENALTY)
      : failure.clearance_per_tick;
    const civilExtraCases = civilShortFor(hospitalId) ? CIVIL_EXTRA_CASES_PER_TICK : 0;

    if (resolution === "uncontrolled") {
      const accrues = !consumers || feedShortFor(hospitalId);
      const powerOverflow = accrues
        ? Math.max(0, failure.excess_cases_per_tick - effectiveClearance)
        : 0;
      return {
        failure: {
          ...failure,
          overflow_cases: failure.overflow_cases + powerOverflow + civilExtraCases,
        },
        resolution,
      };
    }

    // Aktiver Override (controlled ODER mismatch): die Fälle wandern physisch zum
    // Ziel. Die Quelle wird entlastet, das Ziel über redirected_cases geladen.
    // Bei mismatch landen sie an einem fachlich ungeeigneten Haus — sie zählen
    // dort jeden Tick als unbehandelbar (capability_mismatch), solange der
    // falsche Override besteht. Zivile Unruhe lädt parallel weiter Fälle nach.
    const cleared = Math.min(effectiveClearance, failure.overflow_cases);
    return {
      failure: {
        ...failure,
        overflow_cases: failure.overflow_cases - cleared + civilExtraCases,
        redirected_cases: failure.redirected_cases + cleared,
        mismatch_ticks: resolution === "mismatch" ? failure.mismatch_ticks + 1 : failure.mismatch_ticks,
      },
      resolution,
    };
  });

  // Zurechenbarer Routing-Druck je Hospital aus den fortgeschriebenen Failures:
  // die Quelle trägt ihren Rückstau-Delta gegenüber dem Ausgangswert, ein
  // Override-Ziel die kumuliert umgeleiteten Fälle. Daraus wird unten die
  // sichtbare Belegung abgeleitet und der Overload-Tod rein aus ihr bestimmt.
  const pressureByHospital: Record<string, number> = {};
  const addPressure = (hospitalId: string, delta: number) => {
    pressureByHospital[hospitalId] = (pressureByHospital[hospitalId] ?? 0) + delta;
  };

  // Häuser, die gerade fachlich ungeeignete (unbehandelbare) Fälle halten —
  // unabhängig von ihrer Belegung. Solange ein falscher Override besteht, sammeln
  // sie capability_mismatch-Ticks; das Entfernen des Overrides stoppt es sofort.
  const mismatchTargetHospitalIds = new Set<string>();

  for (const { failure, resolution } of advanced) {
    addPressure(failure.affected_hospital_id, failure.overflow_cases - failure.initial_overflow_cases);

    if (resolution === "uncontrolled") {
      continue;
    }

    const key = routingOverrideKey(failure.affected_hospital_id, failure.priority, failure.capability);
    const override = overrides[key];
    if (!override) {
      continue;
    }

    // Aktiver Override: das Ziel trägt die umgeleitete Last.
    addPressure(override.target_hospital_id, failure.redirected_cases);
    if (resolution === "mismatch") {
      mismatchTargetHospitalIds.add(override.target_hospital_id);
    }
  }

  const baselines = world.simulation.medical.capacity_baseline;

  const nextHospitals = { ...hospitals };
  let anyOverloaded = false;
  for (const hospitalId of Object.keys(nextHospitals)) {
    const hospital = nextHospitals[hospitalId];
    const counters: HospitalRiskCounters = hospital.risk_counters ?? {
      overload_ticks: 0,
      capability_mismatch_ticks: 0,
    };

    // Sichtbare Belegung jeden Tick neu aus interner Wahrheit ableiten:
    // Ausgangsbelegung + zurechenbarer Druck. Sowohl Notfallslots als auch
    // Betten bewegen sich beobachtbar.
    const baseline = baselines[hospitalId];
    const pressure = pressureByHospital[hospitalId] ?? 0;
    const emergencyOccupied = Math.max(
      0,
      (baseline?.emergency_slots_occupied ?? hospital.capacity.emergency_slots_occupied) + pressure
    );
    const staffedOccupied = Math.max(
      0,
      (baseline?.staffed_beds_occupied ?? hospital.capacity.staffed_beds_occupied) + pressure
    );

    // Tote hängen rein am Zustand des Krankenhauses, nicht am Override selbst:
    //  - Überlast = Notfallkapazität überschritten. In der gekoppelten Welt sinkt
    //    diese Kapazität erst durch Strommangel (applyCrossSectorEffects).
    //  - Capability-Mismatch = das Haus hält unbehandelbare Fälle.
    // Ein Override wirkt nur indirekt, indem er diese Belegung verschiebt.
    const overloaded = emergencyOccupied > hospital.capacity.emergency_slots_total;
    if (overloaded) {
      anyOverloaded = true;
    }

    nextHospitals[hospitalId] = {
      ...hospital,
      capacity: {
        ...hospital.capacity,
        emergency_slots_occupied: emergencyOccupied,
        staffed_beds_occupied: staffedOccupied,
      },
      risk_counters: {
        overload_ticks: overloaded ? counters.overload_ticks + 1 : 0,
        capability_mismatch_ticks: mismatchTargetHospitalIds.has(hospitalId)
          ? counters.capability_mismatch_ticks + 1
          : 0,
      },
    };
  }

  // Pass 2: stable_ticks (Incident-Stabilisierung). Eine korrekte Umleitung
  // stabilisiert nur, wenn kein Haus überlastet ist — in der gekoppelten Welt
  // heißt das: der Strom muss zurück sein. So ist ME emergent NICHT allein durch
  // richtiges Routing lösbar, sondern nur in Verbindung mit dem Grid.
  const nextFailures = advanced.map(({ failure, resolution }) => {
    const stabilizes = resolution === "controlled" && (!worldCoupled || !anyOverloaded);
    return {
      ...failure,
      stable_ticks: stabilizes ? failure.stable_ticks + 1 : 0,
    };
  });

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

  // Verbraucher, die tatsächlich Hospitals mit Strom versorgen, zählen NICHT als
  // direkter human_harm: ihr menschlicher Preis entsteht ausschließlich über die
  // Kopplung Strommangel → schrumpfende Notfallkapazität → Overload → Tote
  // (applyCrossSectorEffects / tickMedicalDomain / outcomeEngine). In Welten ohne
  // Hospitals (reine Energy-Einzelwelt) bleibt der lokale human_harm dagegen
  // erhalten — dort gibt es keinen Bett-Pfad, über den der Preis sichtbar würde.
  const medicalFeedConsumerIds = new Set<string>();
  for (const hospital of Object.values(world.domains.medical.hospitals)) {
    medicalFeedConsumerIds.add(hospital.power_feed_consumer_id ?? MEDICAL_POWER_CONSUMER_ID);
  }

  for (const consumer of Object.values(nextConsumers)) {
    const belowMinimum = consumer.current_supply < consumer.minimum_supply;
    const reduced = consumer.current_supply < consumer.demand;

    if (
      belowMinimum &&
      !medicalFeedConsumerIds.has(consumer.id) &&
      (consumer.criticality === "human-life" || consumer.criticality === "public-supply")
    ) {
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
    }
  }

  // Instabilität ist die globale Doom-Clock und bewusst node-ZAHL-unabhängig:
  // +1 je Tick, solange IRGENDEIN Knoten überlastet ist (nicht je Knoten). So
  // bleibt das Collapse-Timing gleich, egal über wie viele Regionen die Last
  // verteilt ist — mehr Regionen machen das Netz nicht automatisch schneller tot.
  if (anyNodeOverloaded) {
    gridInstabilityDelta += 1;
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
 *
 * Aktive Kopplung: Energy → Medical, jetzt pro Stromfeed. Jedes Hospital folgt
 * seinem `power_feed_consumer_id` (Fallback: `MEDICAL_POWER_CONSUMER_ID`). Fällt
 * der speisende Verbraucher unter sein `minimum_supply`, sinkt die sichtbare
 * Notfallkapazität (`emergency_slots_total`) genau dieses Hauses proportional
 * unter die Basis (`capacity_baseline.emergency_slots_total`). Damit trifft ein
 * Strom-Lastabwurf nur die Häuser am betroffenen Feed — Umleiten an ein Haus mit
 * gesundem Feed bleibt ein echter Hebel. Kehrt die Versorgung zurück, erholt
 * sich die Kapazität.
 *
 * In Welten ohne Energy-Verbraucher oder ohne Hospitals ist die Stufe ein
 * referenzgleicher No-op (Einzelsektor-Welten bleiben unverändert).
 */
export function applyCrossSectorEffects(world: WorldState): WorldState {
  const consumers = world.domains.energy?.consumers;
  const hospitals = world.domains.medical.hospitals;
  if (!consumers || Object.keys(hospitals).length === 0) {
    return world;
  }

  const baselines = world.simulation.medical.capacity_baseline;
  const nextHospitals = { ...hospitals };
  let changed = false;

  for (const hospitalId of Object.keys(nextHospitals)) {
    const hospital = nextHospitals[hospitalId];
    const feedId = hospital.power_feed_consumer_id ?? MEDICAL_POWER_CONSUMER_ID;
    const consumer = consumers[feedId];
    if (!consumer) {
      // Kein speisender Verbraucher → keine Kopplung für dieses Haus.
      continue;
    }

    // Versorgungsadäquanz: volle Kapazität bei supply ≥ minimum, sonst linear
    // herunter bis 0. Deterministisch, keine Zeit/Zufall.
    const factor =
      consumer.minimum_supply > 0
        ? Math.max(0, Math.min(1, consumer.current_supply / consumer.minimum_supply))
        : 1;

    const baseTotal =
      baselines[hospitalId]?.emergency_slots_total ?? hospital.capacity.emergency_slots_total;
    const reducedTotal = Math.ceil(baseTotal * factor);

    if (reducedTotal !== hospital.capacity.emergency_slots_total) {
      nextHospitals[hospitalId] = {
        ...hospital,
        capacity: { ...hospital.capacity, emergency_slots_total: reducedTotal },
      };
      changed = true;
    }
  }

  if (!changed) {
    return world;
  }

  return {
    ...world,
    domains: {
      ...world.domains,
      medical: { ...world.domains.medical, hospitals: nextHospitals },
    },
  };
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
