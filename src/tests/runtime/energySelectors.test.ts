import { describe, expect, it } from "vitest";
import { initialWorldState as grid1182World } from "../../scenarios/grid1182/initialWorldState";
import { initialWorldState as me7741World } from "../../scenarios/me7741/initialWorldState";
import {
  getActiveSheddingPlans,
  getConsumersByNode,
  getEnergyConsumerById,
  getEnergyDomain,
  getGridNodeById,
  getNodeLoadPercent,
  isConsumerBelowMinimumSupply,
  isNodeOverloaded,
} from "../../runtime/energySelectors";

describe("energy selectors", () => {
  it("getEnergyDomain returns the domain for GRID-1182 and null for ME-7741", () => {
    expect(getEnergyDomain(grid1182World)).toBe(grid1182World.domains.energy);
    expect(getEnergyDomain(me7741World)).toBeNull();
  });

  it("getGridNodeById and getEnergyConsumerById resolve known ids and null otherwise", () => {
    expect(getGridNodeById(grid1182World, "grid-east-3")?.label).toBe("East Distribution Node 3");
    expect(getGridNodeById(grid1182World, "grid-west-1")).toBeNull();
    expect(getEnergyConsumerById(grid1182World, "consumer-medical-east")?.label).toBe("Medical East");
    expect(getEnergyConsumerById(grid1182World, "consumer-unknown")).toBeNull();
  });

  it("getNodeLoadPercent reports load relative to safe capacity", () => {
    expect(getNodeLoadPercent(grid1182World, "grid-east-3")).toBe(108);
    expect(getNodeLoadPercent(grid1182World, "grid-west-1")).toBe(0);
    expect(getNodeLoadPercent(me7741World, "grid-east-3")).toBe(0);
  });

  it("isNodeOverloaded flags nodes above safe capacity", () => {
    expect(isNodeOverloaded(grid1182World, "grid-east-3")).toBe(true);

    const relaxed = structuredClone(grid1182World);
    relaxed.domains.energy!.nodes["grid-east-3"].load = 92;
    expect(isNodeOverloaded(relaxed, "grid-east-3")).toBe(false);
  });

  it("getConsumersByNode lists every consumer fed by the node", () => {
    const consumers = getConsumersByNode(grid1182World, "grid-east-3");

    expect(consumers.map((consumer) => consumer.id).sort()).toEqual([
      "consumer-industrial-east",
      "consumer-medical-east",
      "consumer-residential-east",
      "consumer-water-east",
    ]);
    expect(getConsumersByNode(me7741World, "grid-east-3")).toEqual([]);
  });

  it("isConsumerBelowMinimumSupply tracks supply against the minimum", () => {
    expect(isConsumerBelowMinimumSupply(grid1182World, "consumer-medical-east")).toBe(false);

    const reduced = structuredClone(grid1182World);
    reduced.domains.energy!.consumers["consumer-medical-east"].current_supply = 16;
    expect(isConsumerBelowMinimumSupply(reduced, "consumer-medical-east")).toBe(true);

    expect(isConsumerBelowMinimumSupply(grid1182World, "consumer-unknown")).toBe(false);
  });

  it("getActiveSheddingPlans is empty initially and ignores finished plans", () => {
    expect(getActiveSheddingPlans(grid1182World)).toEqual([]);
    expect(getActiveSheddingPlans(me7741World)).toEqual([]);

    const withPlans = structuredClone(grid1182World);
    withPlans.domains.energy!.shedding.plans = {
      "shed-1": {
        id: "shed-1",
        target_consumer_id: "consumer-medical-east",
        amount: 8,
        delay: 1,
        duration: 3,
        created_at_tick: 2,
        created_by: "aurora",
        status: "scheduled",
      },
      "shed-2": {
        id: "shed-2",
        target_consumer_id: "consumer-residential-east",
        amount: 6,
        delay: 0,
        duration: 2,
        created_at_tick: 1,
        created_by: "player",
        status: "cancelled",
      },
    };

    const active = getActiveSheddingPlans(withPlans);
    expect(active.map((plan) => plan.id)).toEqual(["shed-1"]);
  });
});
