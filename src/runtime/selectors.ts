import type { ClinicalCapability, PriorityClass, WorldState } from "./types";

const REQUIRED_TRAUMA_CAPABILITY: ClinicalCapability = "TRAUMA";
const REQUIRED_PRIORITY: PriorityClass = "P2";

export function getMedicalDomain(state: WorldState) {
  return state.domains.medical;
}

export function getIncidentAffectedHospitalIds(state: WorldState, incidentId: string): string[] {
  const incident = state.incidents[incidentId];
  if (!incident) {
    return [];
  }

  return incident.affected_entities
    .filter((ref) => ref.sector_id === "medical" && ref.entity_type === "hospital")
    .map((ref) => ref.entity_id);
}

export function getHospitalById(state: WorldState, hospitalId: string) {
  return state.domains.medical.hospitals[hospitalId] ?? null;
}

export function getHospitalLoadPercent(state: WorldState, hospitalId: string) {
  const hospital = getHospitalById(state, hospitalId);
  if (!hospital) {
    return 0;
  }

  const occupancy = hospital.capacity.staffed_beds_occupied;
  const total = hospital.capacity.staffed_beds_total;

  return total > 0 ? (occupancy / total) * 100 : 0;
}

export function isHospitalOverloaded(state: WorldState, hospitalId: string) {
  return getHospitalLoadPercent(state, hospitalId) > 100;
}

export function isHospitalSuitableFor(
  state: WorldState,
  hospitalId: string,
  priority: PriorityClass,
  capability: ClinicalCapability
) {
  const hospital = getHospitalById(state, hospitalId);
  if (!hospital) {
    return false;
  }

  return (
    hospital.intake_policy.accepted_priorities.includes(priority) &&
    hospital.clinical_capabilities.includes(capability)
  );
}

export function isHospitalUnsafeForP2Trauma(state: WorldState, hospitalId: string) {
  return !isHospitalSuitableFor(state, hospitalId, REQUIRED_PRIORITY, REQUIRED_TRAUMA_CAPABILITY);
}

export function isHospitalPlausibleForP2Trauma(state: WorldState, hospitalId: string) {
  return isHospitalSuitableFor(state, hospitalId, REQUIRED_PRIORITY, REQUIRED_TRAUMA_CAPABILITY);
}
