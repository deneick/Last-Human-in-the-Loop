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
  id: string;
  label: string;
  hospital_ids: string[];
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

export type HospitalState = {
  id: string;
  name: string;
  region_id: string;
  capacity: HospitalCapacityState;
  intake_policy: HospitalIntakePolicyState;
  clinical_capabilities: ClinicalCapability[];
  current_case_mix: HospitalCaseMixState;
  operational: HospitalOperationalState;
  routing: HospitalRoutingState;
};

export type IncidentStatus = "open" | "stabilizing" | "escalated" | "fixed" | "collapsed";

export type IncidentState = {
  id: string;
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
};

export type PatientOutcomeState = {
  deaths_total: number;
  deaths_by_cause: {
    overload: number;
    capability_mismatch: number;
    transport_delay: number;
  };
  deaths_by_hospital: Record<string, number>;
  preventable_deaths: number;
};

export type TransportState = {
  id: string;
  from_hospital_id: string;
  to_hospital_id: string;
  active: boolean;
};

export type MedicalRoutingState = {
  active_profile: string;
  override: {
    exclude_active_transports: boolean;
  };
};

export type WorldState = {
  clock: ClockState;
  medicalRegions: Record<string, MedicalRegionState>;
  hospitals: Record<string, HospitalState>;
  transports: Record<string, TransportState>;
  routing: Record<string, MedicalRoutingState>;
  incidents: Record<string, IncidentState>;
  patient_outcomes: PatientOutcomeState;
};
