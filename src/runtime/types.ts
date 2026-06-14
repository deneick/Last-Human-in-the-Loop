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

/**
 * Sektorübergreifende Referenz auf eine Fachentität,
 * z. B. { medical, hospital, hospital-east-04 } oder { energy, grid-node, grid-east-3 }.
 */
export type EntityRef = {
  sector_id: SectorId;
  entity_type: string;
  entity_id: string;
};

export type IncidentState = {
  id: IncidentId;
  sector_id: SectorId;
  title: string;
  status: IncidentStatus;

  opened_at_tick: number;
  fixed_at_tick?: number;
  collapsed_at_tick?: number;
  reopened_at_tick?: number;

  affected_entities: EntityRef[];
  linked_incidents: IncidentId[];

  unsafe_action_count: number;
  safe_action_count: number;
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

export type RoutingOverrideId = string;

/**
 * Manuelle Routing-Override-Regel. Der Key im manual_overrides-Record
 * (der "Slot") ergibt sich aus source_hospital_id + priority + capability,
 * z. B. "hospital-east-04:P2:TRAUMA". Die `id` ist die stabile Kennung
 * dieser konkreten Override-Instanz und überlebt nicht das Ersetzen
 * desselben Slots durch einen neuen Override.
 */
export type ManualRoutingOverride = {
  id: RoutingOverrideId;
  source_hospital_id: HospitalId;
  target_hospital_id: HospitalId;
  priority: PriorityClass;
  capability: ClinicalCapability;
  active_since_tick: number;
  created_by: "player" | "aurora";
};

export type MedicalRoutingState = {
  manual_overrides: Record<string, ManualRoutingOverride>;
  next_override_id: number;
};

/**
 * Fachzustand des Medical-Sektors. Bewusst medizinisch konkret:
 * Krankenhäuser bleiben Krankenhäuser, Transporte bleiben Transporte.
 */
export type MedicalDomainState = {
  regions: Record<MedicalRegionId, MedicalRegionState>;
  hospitals: Record<HospitalId, HospitalState>;
  transports: Record<TransportId, TransportState>;
  routing: MedicalRoutingState;
  outcomes: PatientOutcomeState;
};

export type EnergyRegionId = string;
export type GridNodeId = string;
export type EnergyConsumerId = string;
export type SheddingPlanId = string;

/**
 * Menschliche/fachliche Kritikalität eines Verbrauchers:
 * Was passiert Menschen bzw. der Gesellschaft, wenn hier der Strom ausfällt.
 * Bewusst getrennt von priority_class — menschlich kritisch heißt nicht
 * automatisch systemisch geschützt.
 */
export type ConsumerCriticality = "human-life" | "public-supply" | "civil-stability" | "economic";

/**
 * Wie das Energy-System den Verbraucher bei Drosselungs-/Abwurfentscheidungen
 * priorisiert. Folgt der Betreiberkonfiguration, nicht der menschlichen Sicht.
 */
export type EnergyPriorityClass = "protected-continuity" | "civil-priority" | "standard" | "curtailable";

export type GridNodeStatus = "nominal" | "strained" | "critical" | "offline";
export type ConsumerSupplyStatus = "nominal" | "reduced" | "offline";

export type EnergyRegionState = {
  id: EnergyRegionId;
  label: string;
  node_ids: GridNodeId[];
  consumer_ids: EnergyConsumerId[];
};

export type GridNodeState = {
  id: GridNodeId;
  region_id: EnergyRegionId;
  label: string;
  load: number;
  safe_capacity: number;
  status: GridNodeStatus;
};

export type EnergyConsumerState = {
  id: EnergyConsumerId;
  label: string;
  region_id: EnergyRegionId;
  node_id: GridNodeId;
  demand: number;
  current_supply: number;
  minimum_supply: number;
  criticality: ConsumerCriticality;
  priority_class: EnergyPriorityClass;
  /**
   * Wer die priority_class zuletzt geändert hat. Fehlt das Feld, gilt die
   * unveränderte Betreiberkonfiguration aus dem initialen WorldState.
   */
  priority_last_changed_by?: "player" | "aurora";
  status: ConsumerSupplyStatus;
  /** Öffentlich formulierte Folge, falls die Versorgung reduziert wird. */
  reduction_consequence: string;
};

export type SheddingPlanStatus = "scheduled" | "active" | "completed" | "cancelled";

/**
 * Geplante Drosselung eines Verbrauchers. In diesem Slice nur Datenstruktur:
 * Pläne werden noch nicht durch die Tick-Pipeline ausgeführt.
 */
export type SheddingPlan = {
  id: SheddingPlanId;
  target_consumer_id: EnergyConsumerId;
  amount: number;
  delay: number;
  duration: number;
  created_at_tick: number;
  created_by: "player" | "aurora" | "system";
  status: SheddingPlanStatus;
};

export type EnergySheddingState = {
  plans: Record<SheddingPlanId, SheddingPlan>;
  next_shedding_id: number;
};

/**
 * Lokale Energy-Outcomes. human_harm ist ein lokaler GRID-1182-Wert,
 * kein ME-7741-Death-Counter — es gibt keine Kopplung zur Medical-Domain.
 */
export type EnergyOutcomeState = {
  human_harm: number;
  economic_loss: number;
  civil_unrest: number;
  grid_instability: number;
};

/**
 * Fachzustand des Energy-Sektors (GRID-1182). Bewusst energietechnisch konkret:
 * Grid Nodes bleiben Grid Nodes, Verbraucher bleiben Verbraucher.
 */
export type EnergyDomainState = {
  regions: Record<EnergyRegionId, EnergyRegionState>;
  nodes: Record<GridNodeId, GridNodeState>;
  consumers: Record<EnergyConsumerId, EnergyConsumerState>;
  shedding: EnergySheddingState;
  outcomes: EnergyOutcomeState;
};

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
  /**
   * Ausgangsrückstau dieses Failures. Anker für die Kapazitätsprojektion:
   * sichtbare Belegung der Quelle = Baseline + (overflow_cases − initial_overflow_cases).
   */
  initial_overflow_cases: number;
  /**
   * Kumuliert auf das Override-Ziel umgeleitete Fälle. Lädt — solange ein
   * geeigneter (controlled) Override aktiv ist — die sichtbare Belegung des
   * Ziels und kann es über seine Kapazität treiben.
   */
  redirected_cases: number;
  clearance_per_tick: number;
  stable_ticks: number;
  mismatch_ticks: number;
  severity: "moderate" | "critical";
};

/**
 * Ausgangsbelegung eines Hospitals (interne Wahrheit, Anker der
 * Kapazitätsprojektion). Die sichtbaren capacity-Felder werden jeden Tick aus
 * dieser Baseline plus dem zurechenbaren Routing-Druck neu abgeleitet.
 */
export type HospitalCapacityBaseline = {
  emergency_slots_occupied: number;
  staffed_beds_occupied: number;
};

/**
 * Internes Abrechnungsbuch der OutcomeEngine pro Hospital.
 * Verhindert doppelte Todesfälle bei mehrfacher Auswertung.
 */
export type RecordedDeaths = {
  overload: number;
  capability_mismatch: number;
};

export type MedicalSimulationState = {
  routing_failures: RoutingFailure[];
  deaths_recorded: Record<HospitalId, RecordedDeaths>;
  /**
   * Ausgangsbelegung je Hospital. Anker für die jede-Tick-Neuableitung der
   * sichtbaren capacity-Belegung aus dem internen Overflow. Wie der restliche
   * simulation-Bereich tabu für UI, ViewModel, Read-only Commands und Director.
   */
  capacity_baseline: Record<HospitalId, HospitalCapacityBaseline>;
};

/**
 * Interner Simulationszustand des Energy-Sektors.
 * stable_ticks zählt, wie viele Ticks in Folge kein Grid Node überlastet war —
 * die Engine-Wahrheit hinter dem Statuswechsel zu "fixed". Wie
 * simulation.medical tabu für UI, ViewModel, Read-only Commands und Director.
 */
export type EnergySimulationState = {
  stable_ticks: number;
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
  energy?: EnergySimulationState;
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
