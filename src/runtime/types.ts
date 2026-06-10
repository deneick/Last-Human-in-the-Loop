export type SectorId =
  | "medical"
  | "energy"
  | "logistics"
  | "media"
  | "finance"
  | "identity"
  | "security"
  | "policy";

export type IncidentId = string;
export type MedicalRegionId = string;
export type HospitalId = string;
export type TransportId = string;

export type PriorityClass = "P1" | "P2" | "P3" | "P4";
export type ClinicalCapability = "GEN" | "TRAUMA" | "NEURO" | "PED";
export type DiversionMode = "soft" | "hard" | "none";

export type ClockState = {
  scenario_time: string;
  elapsed_minutes: number;
  tick: number;
};

export type RegionalDemandState = {
  incoming_cases_per_10min: number;
  priority_mix: Record<PriorityClass, number>;
  capability_mix: Record<ClinicalCapability, number>;
};

export type MedicalRegionState = {
  id: MedicalRegionId;
  label: string;
  hospital_ids: HospitalId[];
  demand: RegionalDemandState;
};

export type HospitalCapacityState = {
  staffed_beds_total: number;
  staffed_beds_occupied: number;
  emergency_slots_total: number;
  emergency_slots_occupied: number;
  triage_slots_total: number;
  triage_slots_occupied: number;
};

export type HospitalIntakePolicyState = {
  accepted_priorities: PriorityClass[];
  accepted_capabilities: ClinicalCapability[];
  diversion_mode: DiversionMode;
  accepts_overflow: boolean;
};

export type HospitalCaseMixState = {
  waiting_cases: Record<PriorityClass, number>;
  active_cases: Record<PriorityClass, number>;
  capability_load: Record<ClinicalCapability, number>;
};

export type HospitalOperationalState = {
  accepts_new_intake: boolean;
  ambulance_bay_available: boolean;
  triage_system_online: boolean;
  local_router_online: boolean;
};

export type HospitalRoutingState = {
  routing_weight: number;
  incoming_rate_per_10min: number;
  outgoing_rate_per_10min: number;
  last_routing_update: string;
};

export type HospitalRiskCounters = {
  overload_ticks: number;
  capability_mismatch_ticks: number;
};

export type HospitalState = {
  id: HospitalId;
  name: string;
  region_id: MedicalRegionId;
  capacity: HospitalCapacityState;
  intake_policy: HospitalIntakePolicyState;
  clinical_capabilities: ClinicalCapability[];
  current_case_mix: HospitalCaseMixState;
  operational: HospitalOperationalState;
  routing: HospitalRoutingState;
  risk_counters?: HospitalRiskCounters;
};

export type IncidentStatus = "open" | "stabilizing" | "escalated" | "fixed" | "collapsed";

export type IncidentState = {
  id: IncidentId;
  region_id: string;
  source_hospital_id: string;
  status: IncidentStatus;
  opened_at: string;
  fixed_at: string | null;
  collapse_at: string | null;
  applied_override_ids: string[];
  unsafe_action_count: number;
  safe_action_count: number;
  ticks_since_opened: number;
  ticks_since_safe_apply: number | null;
  ticks_since_unsafe_apply: number | null;
  planned_target_hospital_id?: string;
};

export type PatientOutcomeState = {
  deaths_total: number;
  deaths_by_cause: {
    overload: number;
    capability_mismatch: number;
    transport_delay: number;
  };
  deaths_by_hospital: Record<HospitalId, number>;
  preventable_deaths: number;
};

export type TransportState = {
  id: TransportId;
  from_hospital_id: HospitalId;
  to_hospital_id: HospitalId;
  active: boolean;
};

export type MedicalRoutingState = {
  active_profile: string;
  override: {
    exclude_active_transports: boolean;
  };
};

/**
 * Fachzustand des Medical-Sektors. Bewusst medizinisch konkret:
 * Krankenhäuser bleiben Krankenhäuser, Transporte bleiben Transporte.
 */
export type MedicalDomainState = {
  regions: Record<MedicalRegionId, MedicalRegionState>;
  hospitals: Record<HospitalId, HospitalState>;
  transports: Record<TransportId, TransportState>;
  routing: Record<MedicalRegionId, MedicalRoutingState>;
  outcomes: PatientOutcomeState;
};

/**
 * Platzhalter für die spätere Energy-Domain (GRID-1182).
 * Architektonisch vorbereitet, fachlich noch nicht modelliert.
 */
export type EnergyDomainState = never;

export type DomainState = {
  medical: MedicalDomainState;
  energy?: EnergyDomainState;
};

/**
 * Interner Simulationszustand des Medical-Sektors.
 * Nicht über Read-only Commands abrufbar — nur die Engine kennt diese Wahrheit.
 */
export type RoutingFailure = {
  id: string;
  incident_id: IncidentId;
  affected_hospital_id: HospitalId;
  priority: PriorityClass;
  capability: ClinicalCapability;
  excess_cases_per_tick: number;
  overflow_cases: number;
  clearance_per_tick: number;
  stable_ticks: number;
  mismatch_ticks: number;
  severity: "moderate" | "critical";
};

export type MedicalSimulationState = {
  routing_failures: RoutingFailure[];
};

export type CrossSectorEffectLogEntry = {
  tick: number;
  source_sector: SectorId;
  target_sector: SectorId;
  description: string;
};

export type CrossSectorSimulationState = {
  effects_applied: CrossSectorEffectLogEntry[];
};

export type SimulationState = {
  medical: MedicalSimulationState;
  cross_sector: CrossSectorSimulationState;
};

/**
 * Globaler, sektorübergreifender Outcome-Bereich.
 * Sektorspezifische Outcomes (z. B. Patienten) bleiben in der jeweiligen Domain.
 */
export type WorldOutcomeState = {
  global_risk: "stable" | "strained" | "critical" | "collapsed";
  collapsed: boolean;
  collapse_reason?: string;
  human_harm: {
    deaths_total: number;
    preventable_deaths: number;
  };
};

export type WorldState = {
  clock: ClockState;
  domains: DomainState;
  incidents: Record<IncidentId, IncidentState>;
  outcomes: WorldOutcomeState;
  simulation: SimulationState;
  runtime_logs?: string[];
};
