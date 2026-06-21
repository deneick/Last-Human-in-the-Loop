import type { WorldState } from "../runtime/types";
import type { OpsEvent, OpsSector, OpsSeverity } from "../runtime/opsFeed";
import { getHospitalLoadPercent } from "../runtime/selectors";
import { getEnergyDomain, getNodeLoadPercent } from "../runtime/energySelectors";

/**
 * View-Model für die Operator-UI.
 *
 * Liest ausschließlich beobachtbare Welt: domains.medical, domains.energy und
 * die Incident-Stammdaten. world.simulation ist hier bewusst tabu — die UI darf
 * keine interne Simulationswahrheit leaken. Lage-/Situationssignale sind kein
 * Incident-Feld mehr: Sie erscheinen ausschließlich in der UI-„Log"-Liste
 * (opsFeed-Projektion, siehe `buildOpsFeedLines`).
 */

export type IncidentView = {
  id: string;
  title: string;
  status: string;
  statusLabel: string;
  sectorId: string;
  openedAtTick: number;
  fixedAtTick: number | null;
  collapsedAtTick: number | null;
  affectedEntityIds: string[];
  isFinal: boolean;
};

const INCIDENT_STATUS_LABELS: Record<string, string> = {
  open: "Offen",
  stabilizing: "Stabilisiert sich",
  escalated: "Eskaliert",
  fixed: "Behoben",
  collapsed: "Kollabiert",
};

export function buildIncidentView(world: WorldState, incidentId: string): IncidentView | null {
  const incident = world.incidents[incidentId];
  if (!incident) {
    return null;
  }

  return {
    id: incident.id,
    title: incident.title,
    status: incident.status,
    statusLabel: INCIDENT_STATUS_LABELS[incident.status] ?? incident.status,
    sectorId: incident.sector_id,
    openedAtTick: incident.opened_at_tick,
    fixedAtTick: incident.fixed_at_tick ?? null,
    collapsedAtTick: incident.collapsed_at_tick ?? null,
    affectedEntityIds: incident.affected_entities.map((ref) => ref.entity_id),
    isFinal: incident.status === "fixed" || incident.status === "collapsed",
  };
}

export type GlobalOutcomeView = {
  globalRisk: string;
  riskLabel: string;
  deathsTotal: number;
  collapsed: boolean;
  collapseReason: string | null;
};

const RISK_LABELS: Record<string, string> = {
  stable: "Stabil",
  strained: "Angespannt",
  critical: "Kritisch",
  collapsed: "Kollabiert",
};

export function buildGlobalOutcomeView(world: WorldState): GlobalOutcomeView {
  const outcomes = world.outcomes;

  return {
    globalRisk: outcomes.global_risk,
    riskLabel: RISK_LABELS[outcomes.global_risk] ?? outcomes.global_risk,
    deathsTotal: outcomes.human_harm.deaths_total,
    collapsed: outcomes.collapsed,
    collapseReason: outcomes.collapse_reason ?? null,
  };
}

/**
 * Gruppiert region-behaftete Views (Hospitals, Nodes, Consumers) für die
 * Panel-Darstellung der 4-Regionen-Karte — Reihenfolge bleibt stabil
 * (erste Begegnung je Region gewinnt).
 */
export type RegionGroup<T> = { regionId: string; regionLabel: string; items: T[] };

export function groupByRegion<T extends { regionId: string; regionLabel: string }>(
  items: T[]
): RegionGroup<T>[] {
  const groups = new Map<string, RegionGroup<T>>();
  for (const item of items) {
    const existing = groups.get(item.regionId);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(item.regionId, {
        regionId: item.regionId,
        regionLabel: item.regionLabel,
        items: [item],
      });
    }
  }
  return [...groups.values()];
}

/**
 * Aggregierte Regionssicht für die Lagekarte: bündelt Netzknoten, Verbraucher,
 * Hospitäler und die ein-/ausgehenden Routing-Overrides je Region zu einer
 * Kachel. Verbindet die getrennten Medical- (`medical-<key>`) und Energy-Region-
 * Ids (`energy-region-<key>`) über den Kompass-Key (east/north/west/south).
 * Liest ausschließlich die öffentliche Sicht (kein `world.simulation`).
 */
export type RegionMapView = {
  key: string;
  label: string;
  node: GridNodeView | null;
  consumers: ConsumerView[];
  hospitals: HospitalView[];
  /** Overrides, deren Quelle in dieser Region liegt (Fälle gehen hinaus). */
  outgoingOverrides: OverrideView[];
  /** Overrides, deren Ziel in dieser Region liegt (Fälle kommen herein). */
  incomingOverrides: OverrideView[];
};

// Stabile Kompass-Reihenfolge für das 2x2-Raster (Nord oben-links, Ost oben-rechts,
// West unten-links, Süd unten-rechts); unbekannte Keys danach in Fundreihenfolge.
const REGION_ORDER = ["north", "east", "west", "south"];

function regionKeyOf(id: string): string {
  return id.replace(/^medical-/, "").replace(/^energy-region-/, "");
}

export function buildRegionMapViews(world: WorldState): RegionMapView[] {
  const hospitals = buildHospitalViews(world);
  const consumers = buildConsumerViews(world);
  const nodes = buildGridNodeViews(world);
  const overrides = buildOverrideViews(world);

  // Hospital-Id → Region-Key, um Overrides ihren Regionen zuzuordnen.
  const regionOfHospital = new Map<string, string>();
  for (const hospital of hospitals) {
    regionOfHospital.set(hospital.id, regionKeyOf(hospital.regionId));
  }

  const byKey = new Map<string, RegionMapView>();
  const ensure = (key: string, label: string): RegionMapView => {
    let region = byKey.get(key);
    if (!region) {
      region = {
        key,
        label,
        node: null,
        consumers: [],
        hospitals: [],
        outgoingOverrides: [],
        incomingOverrides: [],
      };
      byKey.set(key, region);
    }
    return region;
  };

  for (const hospital of hospitals) {
    ensure(regionKeyOf(hospital.regionId), hospital.regionLabel).hospitals.push(hospital);
  }
  for (const consumer of consumers) {
    ensure(regionKeyOf(consumer.regionId), consumer.regionLabel).consumers.push(consumer);
  }
  for (const node of nodes) {
    const region = ensure(regionKeyOf(node.regionId), node.regionLabel);
    // Erster Knoten der Region trägt die Kachel-Last (eine Region = ein Knoten).
    region.node ??= node;
  }
  for (const override of overrides) {
    const sourceKey = regionOfHospital.get(override.sourceHospitalId);
    const targetKey = regionOfHospital.get(override.targetHospitalId);
    if (sourceKey && byKey.has(sourceKey)) byKey.get(sourceKey)!.outgoingOverrides.push(override);
    if (targetKey && byKey.has(targetKey) && targetKey !== sourceKey)
      byKey.get(targetKey)!.incomingOverrides.push(override);
  }

  return [...byKey.values()].sort((a, b) => {
    const ai = REGION_ORDER.indexOf(a.key);
    const bi = REGION_ORDER.indexOf(b.key);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}

export type HospitalView = {
  id: string;
  name: string;
  regionId: string;
  regionLabel: string;
  loadPercent: number;
  overloaded: boolean;
  bedsOccupied: number;
  bedsTotal: number;
  emergencySlotsOccupied: number;
  emergencySlotsTotal: number;
  waitingTotal: number;
  waitingByPriority: Record<string, number>;
  acceptedPriorities: string[];
  clinicalCapabilities: string[];
};

export function buildHospitalViews(world: WorldState): HospitalView[] {
  const regions = world.domains.medical.regions;
  return Object.values(world.domains.medical.hospitals).map((hospital) => {
    const loadPercent = getHospitalLoadPercent(world, hospital.id);
    const waiting = hospital.current_case_mix.waiting_cases;
    const waitingTotal = Object.values(waiting).reduce((sum, count) => sum + count, 0);

    return {
      id: hospital.id,
      name: hospital.name,
      regionId: hospital.region_id,
      regionLabel: regions[hospital.region_id]?.label ?? hospital.region_id,
      loadPercent,
      overloaded: loadPercent > 100,
      bedsOccupied: hospital.capacity.staffed_beds_occupied,
      bedsTotal: hospital.capacity.staffed_beds_total,
      emergencySlotsOccupied: hospital.capacity.emergency_slots_occupied,
      emergencySlotsTotal: hospital.capacity.emergency_slots_total,
      waitingTotal,
      waitingByPriority: { ...waiting },
      acceptedPriorities: [...hospital.intake_policy.accepted_priorities],
      clinicalCapabilities: [...hospital.clinical_capabilities],
    };
  });
}

export type OverrideView = {
  id: string;
  key: string;
  sourceHospitalId: string;
  targetHospitalId: string;
  priority: string;
  capability: string;
  activeSinceTick: number;
  createdBy: string;
};

export function buildOverrideViews(world: WorldState): OverrideView[] {
  return Object.entries(world.domains.medical.routing.manual_overrides).map(
    ([key, override]) => ({
      id: override.id,
      key,
      sourceHospitalId: override.source_hospital_id,
      targetHospitalId: override.target_hospital_id,
      priority: override.priority,
      capability: override.capability,
      activeSinceTick: override.active_since_tick,
      createdBy: override.created_by,
    })
  );
}

export type GridNodeView = {
  id: string;
  label: string;
  regionId: string;
  regionLabel: string;
  load: number;
  safeCapacity: number;
  loadPercent: number;
  overloaded: boolean;
  status: string;
  statusLabel: string;
};

const NODE_STATUS_LABELS: Record<string, string> = {
  nominal: "Nominal",
  strained: "Angespannt",
  critical: "Kritisch",
  offline: "Offline",
};

export function buildGridNodeViews(world: WorldState): GridNodeView[] {
  const energy = getEnergyDomain(world);
  if (!energy) {
    return [];
  }

  return Object.values(energy.nodes).map((node) => {
    const loadPercent = getNodeLoadPercent(world, node.id);
    return {
      id: node.id,
      label: node.label,
      regionId: node.region_id,
      regionLabel: energy.regions[node.region_id]?.label ?? node.region_id,
      load: node.load,
      safeCapacity: node.safe_capacity,
      loadPercent,
      overloaded: loadPercent > 100,
      status: node.status,
      statusLabel: NODE_STATUS_LABELS[node.status] ?? node.status,
    };
  });
}

export type ConsumerView = {
  id: string;
  label: string;
  nodeId: string;
  regionId: string;
  regionLabel: string;
  criticality: string;
  criticalityLabel: string;
  priorityClass: string;
  demand: number;
  currentSupply: number;
  minimumSupply: number;
  status: string;
  statusLabel: string;
  reductionConsequence: string;
  priorityLastChangedBy: string | null;
};

const CRITICALITY_LABELS: Record<string, string> = {
  "human-life": "Menschenleben",
  "public-supply": "Öffentliche Versorgung",
  "civil-stability": "Zivile Stabilität",
  economic: "Wirtschaftlich",
};

const CONSUMER_STATUS_LABELS: Record<string, string> = {
  nominal: "Nominal",
  reduced: "Reduziert",
  offline: "Offline",
};

export function buildConsumerViews(world: WorldState): ConsumerView[] {
  const energy = getEnergyDomain(world);
  if (!energy) {
    return [];
  }

  return Object.values(energy.consumers).map((consumer) => ({
    id: consumer.id,
    label: consumer.label,
    nodeId: consumer.node_id,
    regionId: consumer.region_id,
    regionLabel: energy.regions[consumer.region_id]?.label ?? consumer.region_id,
    criticality: consumer.criticality,
    criticalityLabel: CRITICALITY_LABELS[consumer.criticality] ?? consumer.criticality,
    priorityClass: consumer.priority_class,
    demand: consumer.demand,
    currentSupply: consumer.current_supply,
    minimumSupply: consumer.minimum_supply,
    status: consumer.status,
    statusLabel: CONSUMER_STATUS_LABELS[consumer.status] ?? consumer.status,
    reductionConsequence: consumer.reduction_consequence,
    priorityLastChangedBy: consumer.priority_last_changed_by ?? null,
  }));
}

export type SheddingPlanView = {
  id: string;
  targetConsumerId: string;
  amount: number;
  delay: number;
  duration: number;
  createdAtTick: number;
  createdBy: string;
  status: string;
  statusLabel: string;
};

const SHEDDING_STATUS_LABELS: Record<string, string> = {
  scheduled: "Geplant",
  active: "Aktiv",
  completed: "Abgeschlossen",
  cancelled: "Abgebrochen",
};

export function buildSheddingViews(world: WorldState): SheddingPlanView[] {
  const energy = getEnergyDomain(world);
  if (!energy) {
    return [];
  }

  return Object.values(energy.shedding.plans).map((plan) => ({
    id: plan.id,
    targetConsumerId: plan.target_consumer_id,
    amount: plan.amount,
    delay: plan.delay,
    duration: plan.duration,
    createdAtTick: plan.created_at_tick,
    createdBy: plan.created_by,
    status: plan.status,
    statusLabel: SHEDDING_STATUS_LABELS[plan.status] ?? plan.status,
  }));
}

export type EnergyOutcomesView = {
  humanHarm: number;
  economicLoss: number;
  civilUnrest: number;
  gridInstability: number;
};

/**
 * Lokale Energy-Outcomes für das Ergebnis-Banner: beide Preise
 * (menschlich und wirtschaftlich) nebeneinander, ohne Moralwertung.
 */
export function buildEnergyOutcomesView(world: WorldState): EnergyOutcomesView | null {
  const energy = getEnergyDomain(world);
  if (!energy) {
    return null;
  }

  return {
    humanHarm: energy.outcomes.human_harm,
    economicLoss: energy.outcomes.economic_loss,
    civilUnrest: energy.outcomes.civil_unrest,
    gridInstability: energy.outcomes.grid_instability,
  };
}

/**
 * Eine Zeile der UI-„Log"-Liste: die operator-sichtbare Projektion des
 * opsFeed. `sector` steuert die Zeilenfarbe (Akzent), `severity` das Badge.
 */
export type OpsFeedLineView = {
  id: string;
  tick: number;
  sector: OpsSector;
  severity: OpsSeverity;
  summary: string;
  details: string | null;
};

const SEVERITY_BADGE_LABELS: Record<OpsSeverity, string> = {
  info: "Info",
  warning: "Warnung",
  critical: "Kritisch",
  success: "Erfolg",
};

export function severityBadgeLabel(severity: OpsSeverity): string {
  return SEVERITY_BADGE_LABELS[severity];
}

/**
 * Operator-sichtbare opsFeed-Einträge als eine kombinierte Liste. auditLog
 * ist hier bewusst NICHT die Quelle — die normale UI zeigt den opsFeed.
 */
export function buildOpsFeedLines(opsFeed: OpsEvent[]): OpsFeedLineView[] {
  return opsFeed
    .filter((event) => event.visibility.operator)
    .map((event) => ({
      id: event.id,
      tick: event.tick,
      sector: event.sector,
      severity: event.severity,
      summary: event.summary,
      details: event.details ?? null,
    }));
}
