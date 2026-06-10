import type { ClinicalCapability, PriorityClass, WorldState } from "./types";

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

/**
 * Engine-interne fachliche Eignungsprüfung. Wird von der Simulation genutzt,
 * darf aber nicht als fertige Bewertung über Read-only Commands ausgegeben werden.
 */
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
