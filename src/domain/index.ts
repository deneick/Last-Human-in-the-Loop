import { DomainActionRegistry } from "./actions";
import { registerMedicalActions } from "./medicalActions";
import { registerEnergyActions } from "./energyActions";

export * from "./actions";
export * from "./medicalActions";
export * from "./energyActions";

/** Standard-Registry mit allen fachlichen Medical- und Energy-Actions. */
export function createDomainActionRegistry(): DomainActionRegistry {
  const registry = new DomainActionRegistry();
  registerMedicalActions(registry);
  registerEnergyActions(registry);
  return registry;
}
