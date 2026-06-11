import type { EnergyConsumerState, EnergyDomainState, SheddingPlan, WorldState } from "./types";

/**
 * Die Energy-Domain ist optional im WorldState (ME-7741 hat keine).
 * Alle Energy-Selectors gehen über diesen Zugriff und liefern für
 * Welten ohne Energy-Domain neutrale Werte.
 */
export function getEnergyDomain(state: WorldState): EnergyDomainState | null {
  return state.domains.energy ?? null;
}

export function getGridNodeById(state: WorldState, nodeId: string) {
  return getEnergyDomain(state)?.nodes[nodeId] ?? null;
}

export function getEnergyConsumerById(state: WorldState, consumerId: string) {
  return getEnergyDomain(state)?.consumers[consumerId] ?? null;
}

export function getNodeLoadPercent(state: WorldState, nodeId: string) {
  const node = getGridNodeById(state, nodeId);
  if (!node) {
    return 0;
  }

  return node.safe_capacity > 0 ? (node.load / node.safe_capacity) * 100 : 0;
}

export function isNodeOverloaded(state: WorldState, nodeId: string) {
  return getNodeLoadPercent(state, nodeId) > 100;
}

export function getConsumersByNode(state: WorldState, nodeId: string): EnergyConsumerState[] {
  const energy = getEnergyDomain(state);
  if (!energy) {
    return [];
  }

  return Object.values(energy.consumers).filter((consumer) => consumer.node_id === nodeId);
}

export function isConsumerBelowMinimumSupply(state: WorldState, consumerId: string) {
  const consumer = getEnergyConsumerById(state, consumerId);
  if (!consumer) {
    return false;
  }

  return consumer.current_supply < consumer.minimum_supply;
}

/**
 * Aktiv heißt: Der Plan steht noch aus oder wirkt gerade —
 * abgeschlossene und abgebrochene Pläne zählen nicht.
 */
export function getActiveSheddingPlans(state: WorldState): SheddingPlan[] {
  const energy = getEnergyDomain(state);
  if (!energy) {
    return [];
  }

  return Object.values(energy.shedding.plans).filter(
    (plan) => plan.status === "scheduled" || plan.status === "active"
  );
}
