import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/grid1182/initialWorldState";
import { tickWorld } from "../../runtime/tickEngine";

describe("GRID-1182 initial world state", () => {
  it("contains the energy domain under domains.energy", () => {
    expect(initialWorldState.domains.energy).toBeDefined();
    expect(initialWorldState.domains.energy?.regions["energy-region-east"]).toBeDefined();
    expect(initialWorldState.domains.energy?.nodes["grid-east-3"]).toBeDefined();
  });

  it("keeps energy data under domains.energy, not top-level on the WorldState", () => {
    const topLevelKeys = Object.keys(initialWorldState);

    expect(topLevelKeys).not.toContain("energy");
    expect(topLevelKeys).not.toContain("energyNodes");
    expect(topLevelKeys).not.toContain("consumers");
    expect(topLevelKeys).not.toContain("nodes");
    expect(topLevelKeys).not.toContain("shedding");
  });

  it("defines grid-east-3 as a strained node above safe capacity", () => {
    const node = initialWorldState.domains.energy!.nodes["grid-east-3"];

    expect(node.label).toBe("East Distribution Node 3");
    expect(node.status).toBe("strained");
    expect(node.load).toBeGreaterThan(node.safe_capacity);
  });

  it("models Medical East as human-critical but not system-protected", () => {
    const consumer = initialWorldState.domains.energy!.consumers["consumer-medical-east"];

    expect(consumer).toBeDefined();
    expect(consumer.label).toBe("Medical East");
    expect(consumer.criticality).toBe("human-life");
    expect(consumer.priority_class).toBe("standard");
    expect(consumer.status).toBe("nominal");
  });

  it("models Industrial East as system-protected but not human-critical", () => {
    const consumer = initialWorldState.domains.energy!.consumers["consumer-industrial-east"];

    expect(consumer).toBeDefined();
    expect(consumer.label).toBe("Industrial East");
    expect(consumer.criticality).toBe("economic");
    expect(consumer.priority_class).toBe("protected-continuity");
    expect(consumer.status).toBe("nominal");
  });

  it("includes Water East and Residential East with their dual assessment", () => {
    const water = initialWorldState.domains.energy!.consumers["consumer-water-east"];
    const residential = initialWorldState.domains.energy!.consumers["consumer-residential-east"];

    expect(water.criticality).toBe("public-supply");
    expect(water.priority_class).toBe("civil-priority");
    expect(residential.criticality).toBe("civil-stability");
    expect(residential.priority_class).toBe("standard");
  });

  it("starts every consumer at nominal supply above its minimum", () => {
    for (const consumer of Object.values(initialWorldState.domains.energy!.consumers)) {
      expect(consumer.current_supply).toBe(consumer.demand);
      expect(consumer.current_supply).toBeGreaterThan(consumer.minimum_supply);
    }
  });

  it("prepares the shedding state with no active plans", () => {
    const shedding = initialWorldState.domains.energy!.shedding;

    expect(shedding.plans).toEqual({});
    expect(shedding.next_shedding_id).toBe(1);
  });

  it("initializes local energy outcomes at zero", () => {
    expect(initialWorldState.domains.energy!.outcomes).toEqual({
      human_harm: 0,
      economic_loss: 0,
      civil_unrest: 0,
      grid_instability: 0,
    });
  });

  it("registers GRID-1182 as a sector-agnostic energy incident linked to ME-7741", () => {
    const incident = initialWorldState.incidents["GRID-1182"];

    expect(incident.sector_id).toBe("energy");
    expect(incident.status).toBe("open");
    expect(incident.linked_incidents).toEqual(["ME-7741"]);
    expect(incident.affected_entities).toContainEqual({
      sector_id: "energy",
      entity_type: "grid_node",
      entity_id: "grid-east-3",
    });
  });

  it("leaves the medical domain neutral — no hospitals, no deaths, no failures", () => {
    expect(initialWorldState.domains.medical.hospitals).toEqual({});
    expect(initialWorldState.domains.medical.outcomes.deaths_total).toBe(0);
    expect(initialWorldState.simulation.medical.routing_failures).toEqual([]);
  });

  it("contains no active cross-sector logic: ticking evolves energy only locally", () => {
    const next = tickWorld(structuredClone(initialWorldState));

    expect(next.clock.tick).toBe(1);
    expect(next.simulation.cross_sector.effects_applied).toEqual([]);
    expect(next.domains.medical).toEqual(initialWorldState.domains.medical);
    expect(next.simulation.medical).toEqual(initialWorldState.simulation.medical);

    // Ohne Eingriff bleibt der Knoten überlastet — die Instabilität wächst lokal.
    expect(next.domains.energy!.nodes["grid-east-3"].load).toBe(108);
    expect(next.domains.energy!.nodes["grid-east-3"].status).toBe("strained");
    expect(next.domains.energy!.outcomes.grid_instability).toBe(1);
    expect(next.domains.energy!.consumers).toEqual(initialWorldState.domains.energy!.consumers);
    expect(next.incidents["GRID-1182"].status).toBe("open");
  });
});
