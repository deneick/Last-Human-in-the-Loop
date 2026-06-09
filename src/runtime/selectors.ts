import type { ClinicalCapability, PriorityClass, WorldState } from "./types";

const REQUIRED_TRAUMA_CAPABILITY: ClinicalCapability = "TRAUMA";
const REQUIRED_PRIORITY: PriorityClass = "P2";

export function getHospitalById(state: WorldState, hospitalId: string) {
  return state.hospitals[hospitalId] ?? null;
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

export function isHospitalUnsafeForP2Trauma(state: WorldState, hospitalId: string) {
  const hospital = getHospitalById(state, hospitalId);
  if (!hospital) {
    return true;
  }

  const lacksP2 = !hospital.intake_policy.accepted_priorities.includes(REQUIRED_PRIORITY);
  const lacksTrauma = !hospital.clinical_capabilities.includes(REQUIRED_TRAUMA_CAPABILITY);

  return lacksP2 || lacksTrauma;
}

export function isHospitalPlausibleForP2Trauma(state: WorldState, hospitalId: string) {
  const hospital = getHospitalById(state, hospitalId);
  if (!hospital) {
    return false;
  }

  return (
    hospital.intake_policy.accepted_priorities.includes(REQUIRED_PRIORITY) &&
    hospital.clinical_capabilities.includes(REQUIRED_TRAUMA_CAPABILITY)
  );
}
