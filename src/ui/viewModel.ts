import type { WorldState } from "../runtime/types";
import type { RuntimeAuditEvent } from "../runtime/runtimeState";
import type { OpsEvent, OpsSector, OpsSeverity } from "../runtime/opsFeed";
import { getHospitalLoadPercent } from "../runtime/selectors";
import { getEnergyDomain, getNodeLoadPercent } from "../runtime/energySelectors";

/**
 * View-Model für die Operator-UI.
 *
 * Liest ausschließlich beobachtbare Welt: domains.medical, domains.energy
 * und incident.public_signals. world.simulation ist hier bewusst tabu —
 * die UI darf keine interne Simulationswahrheit leaken.
 */

export type IncidentSignalView = {
  code: string;
  message: string;
  firstSeenAtTick: number;
};

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
  signals: IncidentSignalView[];
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
    signals: incident.public_signals.map((signal) => ({
      code: signal.code,
      message: signal.message,
      firstSeenAtTick: signal.first_seen_at_tick,
    })),
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

export type HospitalView = {
  id: string;
  name: string;
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
  return Object.values(world.domains.medical.hospitals).map((hospital) => {
    const loadPercent = getHospitalLoadPercent(world, hospital.id);
    const waiting = hospital.current_case_mix.waiting_cases;
    const waitingTotal = Object.values(waiting).reduce((sum, count) => sum + count, 0);

    return {
      id: hospital.id,
      name: hospital.name,
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

export type AuditLogLineView = {
  id: string;
  tick: number;
  source: string;
  success: boolean;
  text: string;
};

export function buildAuditLogLines(auditLog: RuntimeAuditEvent[]): AuditLogLineView[] {
  return auditLog.map((event) => ({
    id: event.id,
    tick: event.tick,
    source: event.source,
    success: event.success,
    text: `${event.description} — ${event.message}`,
  }));
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
