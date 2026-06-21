import type {
  ClinicalCapability,
  EnergyConsumerState,
  EnergyRegionState,
  GridNodeState,
  HospitalState,
  MedicalRegionState,
  PriorityClass,
  RoutingFailure,
} from "../../runtime/types";

/**
 * Zusatz-Regionen der kombinierten Welt (North / West / South), die den
 * Schauplatz von einer Region (East) auf eine 4-Regionen-Karte erweitern.
 *
 * Bewusst NUR in der kombinierten Welt definiert — die Einzel-Welten me7741 /
 * grid1182 bleiben unverändert (und damit ihre Tests). Jede Region bringt einen
 * überlasteten Netzknoten mit (Last > sichere Kapazität) und vier Verbraucher
 * (medical/industrial/water/residential) nach demselben Wertmuster wie East:
 * Medical ist menschlich kritisch, aber nur `standard` priorisiert → der billige
 * Abwurf. Industrial ist menschlich unkritisch, aber `protected-continuity`.
 *
 * Fähigkeiten sind so verteilt, dass Reroutes ein echtes Such-Puzzle werden:
 * NEURO gibt es nur in East (east-04) und North (north-01); PED in East (07),
 * West (01) und South (02); South ist der kapazitätsstarke Puffer. Verliert eine
 * Region den Strom, muss ihr Fall in eine Region mit passender Fähigkeit, Strom
 * UND freier Kapazität wandern — der "sichere Hafen" verschiebt sich, je nachdem,
 * was AURORA gerade abgeworfen hat.
 */

export type RegionKey = "north" | "west" | "south";

type HospitalSpec = {
  id: string;
  name: string;
  capabilities: ClinicalCapability[];
  acceptedPriorities: PriorityClass[];
  bedsTotal: number;
  bedsOccupied: number;
  emergencyTotal: number;
  emergencyOccupied: number;
  triageTotal: number;
  triageOccupied: number;
};

type RegionBlueprint = {
  key: RegionKey;
  medicalLabel: string;
  energyLabel: string;
  hospitals: HospitalSpec[];
  /** Dormanter Routing-Failure (overflow 0) — aktiviert erst bei Strommangel. */
  failure: {
    id: string;
    hospitalId: string;
    priority: PriorityClass;
    capability: ClinicalCapability;
    excessPerTick: number;
    clearancePerTick: number;
    severity: RoutingFailure["severity"];
  };
};

export type ExtraRegions = {
  medicalRegions: Record<string, MedicalRegionState>;
  hospitals: Record<string, HospitalState>;
  energyRegions: Record<string, EnergyRegionState>;
  nodes: Record<string, GridNodeState>;
  consumers: Record<string, EnergyConsumerState>;
  failures: RoutingFailure[];
};

const BLUEPRINTS: RegionBlueprint[] = [
  {
    key: "north",
    medicalLabel: "Medical North",
    energyLabel: "North Grid",
    hospitals: [
      {
        id: "hospital-north-01",
        name: "North Medical Center 01",
        capabilities: ["GEN", "NEURO"],
        acceptedPriorities: ["P1", "P2", "P3"],
        bedsTotal: 90,
        bedsOccupied: 70,
        emergencyTotal: 22,
        emergencyOccupied: 12,
        triageTotal: 12,
        triageOccupied: 6,
      },
      {
        id: "hospital-north-02",
        name: "North Medical Center 02",
        capabilities: ["GEN", "TRAUMA"],
        acceptedPriorities: ["P1", "P2", "P3"],
        bedsTotal: 70,
        bedsOccupied: 48,
        emergencyTotal: 18,
        emergencyOccupied: 9,
        triageTotal: 10,
        triageOccupied: 5,
      },
    ],
    failure: {
      id: "rf-me7741-north-neuro",
      hospitalId: "hospital-north-01",
      priority: "P2",
      capability: "NEURO",
      excessPerTick: 3,
      clearancePerTick: 2,
      severity: "critical",
    },
  },
  {
    key: "west",
    medicalLabel: "Medical West",
    energyLabel: "West Grid",
    hospitals: [
      {
        id: "hospital-west-01",
        name: "West Medical Center 01",
        capabilities: ["GEN", "PED"],
        acceptedPriorities: ["P2", "P3", "P4"],
        bedsTotal: 80,
        bedsOccupied: 60,
        emergencyTotal: 20,
        emergencyOccupied: 11,
        triageTotal: 10,
        triageOccupied: 6,
      },
      {
        id: "hospital-west-02",
        name: "West Medical Center 02",
        capabilities: ["GEN"],
        acceptedPriorities: ["P3", "P4"],
        bedsTotal: 60,
        bedsOccupied: 40,
        emergencyTotal: 16,
        emergencyOccupied: 8,
        triageTotal: 8,
        triageOccupied: 4,
      },
    ],
    failure: {
      id: "rf-me7741-west-ped",
      hospitalId: "hospital-west-01",
      priority: "P2",
      capability: "PED",
      excessPerTick: 3,
      clearancePerTick: 2,
      severity: "critical",
    },
  },
  {
    key: "south",
    medicalLabel: "Medical South",
    energyLabel: "South Grid",
    hospitals: [
      {
        id: "hospital-south-01",
        name: "South Medical Center 01",
        capabilities: ["GEN", "TRAUMA"],
        acceptedPriorities: ["P1", "P2", "P3"],
        bedsTotal: 100,
        bedsOccupied: 55,
        emergencyTotal: 24,
        emergencyOccupied: 9,
        triageTotal: 12,
        triageOccupied: 5,
      },
      {
        id: "hospital-south-02",
        name: "South Medical Center 02",
        capabilities: ["GEN", "PED"],
        acceptedPriorities: ["P2", "P3", "P4"],
        bedsTotal: 70,
        bedsOccupied: 35,
        emergencyTotal: 18,
        emergencyOccupied: 6,
        triageTotal: 10,
        triageOccupied: 3,
      },
    ],
    failure: {
      id: "rf-me7741-south-gen",
      hospitalId: "hospital-south-01",
      priority: "P3",
      capability: "GEN",
      excessPerTick: 2,
      clearancePerTick: 3,
      severity: "moderate",
    },
  },
];

const ZERO_BY_PRIORITY: Record<PriorityClass, number> = { P1: 0, P2: 0, P3: 0, P4: 0 };
const ZERO_BY_CAPABILITY: Record<ClinicalCapability, number> = { GEN: 0, TRAUMA: 0, NEURO: 0, PED: 0 };

function buildHospital(regionKey: RegionKey, spec: HospitalSpec): HospitalState {
  return {
    id: spec.id,
    name: spec.name,
    region_id: `medical-${regionKey}`,
    capacity: {
      staffed_beds_total: spec.bedsTotal,
      staffed_beds_occupied: spec.bedsOccupied,
      emergency_slots_total: spec.emergencyTotal,
      emergency_slots_occupied: spec.emergencyOccupied,
      triage_slots_total: spec.triageTotal,
      triage_slots_occupied: spec.triageOccupied,
    },
    intake_policy: {
      accepted_priorities: spec.acceptedPriorities,
      accepted_capabilities: spec.capabilities,
      diversion_mode: "soft",
      accepts_overflow: true,
    },
    clinical_capabilities: spec.capabilities,
    current_case_mix: {
      waiting_cases: { ...ZERO_BY_PRIORITY },
      active_cases: { ...ZERO_BY_PRIORITY },
      capability_load: { ...ZERO_BY_CAPABILITY },
    },
    operational: {
      accepts_new_intake: true,
      ambulance_bay_available: true,
      triage_system_online: true,
      local_router_online: true,
    },
    routing: {
      routing_weight: 1.0,
      incoming_rate_per_10min: 8,
      outgoing_rate_per_10min: 4,
      last_routing_update: "03:13:00",
    },
    // Cross-Sector-Feeds der Region: Strom trägt die Notfallkapazität, Wasser den
    // Durchsatz (Clearance), Wohnen die zivile Lage (Krankenfälle/Transport).
    power_feed_consumer_id: `consumer-medical-${regionKey}`,
    water_feed_consumer_id: `consumer-water-${regionKey}`,
    civil_feed_consumer_id: `consumer-residential-${regionKey}`,
  };
}

function buildEnergyRegion(blueprint: RegionBlueprint) {
  const { key, energyLabel } = blueprint;
  const nodeId = `grid-${key}-1`;
  const regionId = `energy-region-${key}`;

  const consumers: Record<string, EnergyConsumerState> = {
    [`consumer-medical-${key}`]: {
      id: `consumer-medical-${key}`,
      label: `Medical ${cap(key)}`,
      region_id: regionId,
      node_id: nodeId,
      demand: 24,
      current_supply: 24,
      minimum_supply: 20,
      criticality: "human-life",
      priority_class: "standard",
      status: "nominal",
      reduction_consequence: "Emergency intake capacity drops. Human harm may increase.",
    },
    [`consumer-industrial-${key}`]: {
      id: `consumer-industrial-${key}`,
      label: `Industrial ${cap(key)}`,
      region_id: regionId,
      node_id: nodeId,
      demand: 38,
      current_supply: 38,
      minimum_supply: 32,
      criticality: "economic",
      priority_class: "protected-continuity",
      status: "nominal",
      reduction_consequence: "Economic continuity breach. Penalty exposure rises.",
    },
    [`consumer-water-${key}`]: {
      id: `consumer-water-${key}`,
      label: `Water ${cap(key)}`,
      region_id: regionId,
      node_id: nodeId,
      demand: 18,
      current_supply: 18,
      minimum_supply: 14,
      criticality: "public-supply",
      priority_class: "civil-priority",
      status: "nominal",
      reduction_consequence: "Water treatment throughput degrades. Public supply risk rises.",
    },
    [`consumer-residential-${key}`]: {
      id: `consumer-residential-${key}`,
      label: `Residential ${cap(key)}`,
      region_id: regionId,
      node_id: nodeId,
      demand: 28,
      current_supply: 28,
      minimum_supply: 18,
      criticality: "civil-stability",
      priority_class: "standard",
      status: "nominal",
      reduction_consequence: "Households lose supply. Civil unrest risk rises.",
    },
  };

  // Knotenlast = Summe der Verbraucher-Versorgung (108) > sichere Kapazität (100)
  // → überlastet, wie East. Die Doom-Clock (grid_instability) bleibt trotz mehr
  // Knoten gleich schnell (node-zahl-unabhängig, siehe tickEnergyDomain).
  const load = Object.values(consumers).reduce((sum, c) => sum + c.demand, 0);
  const node: GridNodeState = {
    id: nodeId,
    region_id: regionId,
    label: `${energyLabel} Distribution Node 1`,
    load,
    safe_capacity: 100,
    status: "strained",
  };

  const region = {
    id: regionId,
    label: energyLabel,
    node_ids: [nodeId],
    consumer_ids: Object.keys(consumers),
  };

  return { region, node, consumers };
}

function cap(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * Baut die Zusatz-Regionen North/West/South als fertige, mergebare Bausteine.
 * Alle Routing-Failures sind dormant (overflow 0) und hängen am Incident
 * ME-7741 — sie wachsen erst, wenn der speisende Stromfeed der Region fällt.
 */
export function buildExtraRegions(): ExtraRegions {
  const result: ExtraRegions = {
    medicalRegions: {},
    hospitals: {},
    energyRegions: {},
    nodes: {},
    consumers: {},
    failures: [],
  };

  for (const blueprint of BLUEPRINTS) {
    const hospitalIds = blueprint.hospitals.map((spec) => spec.id);

    result.medicalRegions[`medical-${blueprint.key}`] = {
      id: `medical-${blueprint.key}`,
      label: blueprint.medicalLabel,
      hospital_ids: hospitalIds,
      demand: {
        incoming_cases_per_10min: 12,
        priority_mix: { P1: 0.08, P2: 0.22, P3: 0.48, P4: 0.22 },
        capability_mix: { GEN: 0.6, TRAUMA: 0.2, NEURO: 0.1, PED: 0.1 },
      },
    };

    for (const spec of blueprint.hospitals) {
      result.hospitals[spec.id] = buildHospital(blueprint.key, spec);
    }

    const energy = buildEnergyRegion(blueprint);
    result.energyRegions[energy.region.id] = energy.region;
    result.nodes[energy.node.id] = energy.node;
    Object.assign(result.consumers, energy.consumers);

    result.failures.push({
      id: blueprint.failure.id,
      incident_id: "ME-7741",
      affected_hospital_id: blueprint.failure.hospitalId,
      priority: blueprint.failure.priority,
      capability: blueprint.failure.capability,
      excess_cases_per_tick: blueprint.failure.excessPerTick,
      overflow_cases: 0,
      initial_overflow_cases: 0,
      redirected_cases: 0,
      clearance_per_tick: blueprint.failure.clearancePerTick,
      stable_ticks: 0,
      mismatch_ticks: 0,
      severity: blueprint.failure.severity,
    });
  }

  return result;
}
