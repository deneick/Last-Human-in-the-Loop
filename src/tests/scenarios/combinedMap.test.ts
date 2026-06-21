import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/combined/initialWorldState";
import { tickWorld } from "../../runtime/tickEngine";
import type { SheddingPlan, WorldState } from "../../runtime/types";

// 4-Regionen-Karte der kombinierten Welt: East/North/West/South. Die Karte schafft
// das "wandernde sichere Ziel" — Fähigkeiten sind knapp verteilt, Stromfeeds sind
// getrennt, und die Doom-Clock (grid_instability) bleibt trotz vier überlasteter
// Knoten gleich schnell.

const hospitalsWithCapability = (world: WorldState, capability: string): string[] =>
  Object.values(world.domains.medical.hospitals)
    .filter((h) => h.clinical_capabilities.includes(capability as never))
    .map((h) => h.id)
    .sort();

function shedPlan(targetConsumerId: string, amount: number): SheddingPlan {
  return {
    id: `plan-${targetConsumerId}`,
    target_consumer_id: targetConsumerId,
    amount,
    delay: 0,
    duration: 20,
    created_at_tick: 0,
    created_by: "aurora",
    status: "active",
  };
}

const overflowOf = (world: WorldState, failureId: string): number =>
  world.simulation.medical.routing_failures.find((f) => f.id === failureId)!.overflow_cases;

describe("combined 4-region map", () => {
  it("spans four medical regions, four grid nodes, and four energy regions", () => {
    expect(Object.keys(initialWorldState.domains.medical.regions).sort()).toEqual([
      "medical-east",
      "medical-north",
      "medical-south",
      "medical-west",
    ]);
    expect(Object.keys(initialWorldState.domains.energy!.nodes).sort()).toEqual([
      "grid-east-3",
      "grid-north-1",
      "grid-south-1",
      "grid-west-1",
    ]);
    expect(Object.keys(initialWorldState.domains.energy!.regions)).toHaveLength(4);
  });

  it("makes NEURO a scarce capability (only East-04 and North-01)", () => {
    expect(hospitalsWithCapability(initialWorldState, "NEURO")).toEqual([
      "hospital-east-04",
      "hospital-north-01",
    ]);
  });

  it("starts every grid node overloaded but keeps the doom clock node-count-independent", () => {
    for (const node of Object.values(initialWorldState.domains.energy!.nodes)) {
      expect(node.load).toBeGreaterThan(node.safe_capacity);
    }
    // Vier überlastete Knoten, aber Instabilität wächst nur +1/Tick (nicht +4).
    const afterOne = tickWorld(structuredClone(initialWorldState));
    expect(afterOne.domains.energy!.outcomes.grid_instability).toBe(1);
  });

  it("isolates feeds: shedding North medical hits only North hospitals", () => {
    const world = structuredClone(initialWorldState);
    world.domains.energy!.shedding.plans["plan-north"] = shedPlan("consumer-medical-north", 8);

    const eastBaseTotal =
      initialWorldState.domains.medical.hospitals["hospital-east-04"].capacity.emergency_slots_total;
    const northBaseTotal =
      initialWorldState.domains.medical.hospitals["hospital-north-01"].capacity.emergency_slots_total;

    // Zwei Ticks: Tick 1 senkt die North-Versorgung, ab Tick 2 staut der dormante
    // North-NEURO-Failure auf und die North-Notfallkapazität schrumpft.
    const next = tickWorld(tickWorld(world));

    expect(next.domains.medical.hospitals["hospital-north-01"].capacity.emergency_slots_total).toBeLessThan(
      northBaseTotal
    );
    expect(overflowOf(next, "rf-me7741-north-neuro")).toBeGreaterThan(0);

    // East bleibt unberührt — getrennte Stromfeeds.
    expect(next.domains.medical.hospitals["hospital-east-04"].capacity.emergency_slots_total).toBe(
      eastBaseTotal
    );
    expect(overflowOf(next, "rf-me7741-p2-trauma")).toBe(0);
  });
});
