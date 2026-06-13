import type { EnergyDomainState, WorldState } from "./types";

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

export function getNodeLoadPercent(state: WorldState, nodeId: string) {
  const node = getGridNodeById(state, nodeId);
  if (!node) {
    return 0;
  }

  return node.safe_capacity > 0 ? (node.load / node.safe_capacity) * 100 : 0;
}
