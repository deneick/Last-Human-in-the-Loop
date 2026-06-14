import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import { createDomainActionRegistry, type DomainAction } from "../../domain";
import { tickWorld } from "../../runtime/tickEngine";

const registry = createDomainActionRegistry();

describe("sector-agnostic runtime", () => {
  it("incidents are sector-agnostic objects with sector_id and affected_entities", () => {
    const incident = initialWorldState.incidents["ME-7741"];

    expect(incident.sector_id).toBe("medical");
    expect(incident.affected_entities).toEqual([
      {
        sector_id: "medical",
        entity_type: "hospital",
        entity_id: "hospital-east-04",
      },
    ]);
    expect(incident.linked_incidents).toEqual([]);
  });

  it("world mutation patches address domains.medical paths", () => {
    const result = registry.execute(
      {
        type: "medical.routing.override.set",
        sourceHospitalId: "hospital-east-04",
        targetHospitalId: "hospital-east-09",
        priority: "P2",
        capability: "TRAUMA",
      },
      initialWorldState
    );

    expect(result.patch).toBeDefined();
    for (const operation of result.patch ?? []) {
      expect(operation.path.slice(0, 2)).toEqual(["domains", "medical"]);
    }
  });

  it("tick pipeline runs with a no-op cross_sector stage", () => {
    const next = tickWorld(initialWorldState);

    expect(next.clock.tick).toBe(1);
    expect(next.simulation.cross_sector.effects_applied).toEqual([]);
  });

  it("tick pipeline survives a world without medical routing failures", () => {
    const emptyWorld = structuredClone(initialWorldState);
    emptyWorld.simulation.medical.routing_failures = [];

    const next = tickWorld(emptyWorld);

    expect(next.clock.tick).toBe(1);
    expect(next.incidents["ME-7741"].status).toBe("open");
  });

  it("read-only medical actions never expose internal routing failures", () => {
    const readActions: DomainAction[] = [
      { type: "medical.capacity.list", region: "east" },
      { type: "medical.node.inspect", hospitalId: "hospital-east-04" },
      { type: "medical.incident.status", incidentId: "ME-7741" },
      { type: "medical.routing.override.list" },
    ];

    for (const action of readActions) {
      const result = registry.execute(action, initialWorldState);
      expect(result.success).toBe(true);

      const serialized = JSON.stringify(result.output);
      expect(serialized).not.toContain("routing_failures");
      expect(serialized).not.toContain("excess_cases_per_tick");
      expect(serialized).not.toContain("deaths_recorded");
    }
  });
});
