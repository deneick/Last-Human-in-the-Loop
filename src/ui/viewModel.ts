import type { WorldState } from "../runtime/types";
import type { RuntimeAuditEvent } from "../runtime/runtimeState";
import { getHospitalLoadPercent } from "../runtime/selectors";

/**
 * View-Model für die Operator-UI.
 *
 * Liest ausschließlich beobachtbare Welt: domains.medical und
 * incident.public_signals. world.simulation ist hier bewusst tabu —
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
    text: `${event.command.raw} — ${event.message}`,
  }));
}
