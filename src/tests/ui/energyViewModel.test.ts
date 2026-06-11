import { describe, expect, it } from "vitest";
import { initialWorldState as grid1182World } from "../../scenarios/grid1182/initialWorldState";
import { initialWorldState as me7741World } from "../../scenarios/me7741/initialWorldState";
import type { WorldState } from "../../runtime/types";
import {
  buildConsumerViews,
  buildEnergyOutcomesView,
  buildGridNodeViews,
  buildSheddingViews,
} from "../../ui/viewModel";

function cloneWorld(): WorldState {
  return structuredClone(grid1182World);
}

describe("energy view model", () => {
  it("builds grid node views with load percent and overload flag", () => {
    const views = buildGridNodeViews(cloneWorld());

    expect(views).toEqual([
      {
        id: "grid-east-3",
        label: "East Distribution Node 3",
        load: 108,
        safeCapacity: 100,
        loadPercent: 108,
        overloaded: true,
        status: "strained",
        statusLabel: "Angespannt",
      },
    ]);
  });

  it("builds consumer views with both assessment dimensions and the consequence text", () => {
    const views = buildConsumerViews(cloneWorld());
    const medical = views.find((consumer) => consumer.id === "consumer-medical-east");

    expect(views).toHaveLength(4);
    expect(medical).toEqual({
      id: "consumer-medical-east",
      label: "Medical East",
      nodeId: "grid-east-3",
      criticality: "human-life",
      criticalityLabel: "Menschenleben",
      priorityClass: "standard",
      demand: 24,
      currentSupply: 24,
      minimumSupply: 20,
      status: "nominal",
      statusLabel: "Nominal",
      reductionConsequence: "Emergency intake capacity drops. Human harm may increase.",
      priorityLastChangedBy: null,
    });
  });

  it("surfaces who changed a priority class", () => {
    const world = cloneWorld();
    world.domains.energy!.consumers["consumer-medical-east"].priority_class =
      "protected-continuity";
    world.domains.energy!.consumers["consumer-medical-east"].priority_last_changed_by = "player";

    const medical = buildConsumerViews(world).find(
      (consumer) => consumer.id === "consumer-medical-east"
    );

    expect(medical!.priorityClass).toBe("protected-continuity");
    expect(medical!.priorityLastChangedBy).toBe("player");
  });

  it("builds shedding views from domains.energy.shedding.plans", () => {
    const world = cloneWorld();
    world.domains.energy!.shedding.plans["shed-1"] = {
      id: "shed-1",
      target_consumer_id: "consumer-medical-east",
      amount: 8,
      delay: 1,
      duration: 3,
      created_at_tick: 2,
      created_by: "aurora",
      status: "active",
    };

    expect(buildSheddingViews(world)).toEqual([
      {
        id: "shed-1",
        targetConsumerId: "consumer-medical-east",
        amount: 8,
        delay: 1,
        duration: 3,
        createdAtTick: 2,
        createdBy: "aurora",
        status: "active",
        statusLabel: "Aktiv",
      },
    ]);
  });

  it("builds the local energy outcomes view for the end banner", () => {
    const world = cloneWorld();
    world.domains.energy!.outcomes = {
      human_harm: 3,
      economic_loss: 1,
      civil_unrest: 0,
      grid_instability: 2,
    };

    expect(buildEnergyOutcomesView(world)).toEqual({
      humanHarm: 3,
      economicLoss: 1,
      civilUnrest: 0,
      gridInstability: 2,
    });
  });

  it("returns empty views for worlds without an energy domain", () => {
    const world = structuredClone(me7741World);

    expect(buildGridNodeViews(world)).toEqual([]);
    expect(buildConsumerViews(world)).toEqual([]);
    expect(buildSheddingViews(world)).toEqual([]);
    expect(buildEnergyOutcomesView(world)).toBeNull();
  });

  it("never leaks internal simulation truth into energy views", () => {
    const world = cloneWorld();
    const serialized = JSON.stringify({
      nodes: buildGridNodeViews(world),
      consumers: buildConsumerViews(world),
      shedding: buildSheddingViews(world),
      outcomes: buildEnergyOutcomesView(world),
    });

    expect(serialized).not.toContain("stable_ticks");
    expect(serialized).not.toContain("routing_failures");
    expect(serialized).not.toContain("deaths_recorded");
  });
});
