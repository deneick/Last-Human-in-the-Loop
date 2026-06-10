import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import { CommandRegistry } from "../../runtime/commands";
import { parseCommandText } from "../../runtime/commandParser";
import { registerMedicalCommands } from "../../runtime/medicalCommands";
import { tickWorld } from "../../runtime/tickEngine";

const registry = new CommandRegistry();
registerMedicalCommands(registry);

describe("sector-agnostic runtime regression", () => {
  it("WorldState keeps medical data under domains.medical, not top-level", () => {
    const topLevelKeys = Object.keys(initialWorldState);

    expect(topLevelKeys).not.toContain("hospitals");
    expect(topLevelKeys).not.toContain("medicalRegions");
    expect(topLevelKeys).not.toContain("transports");
    expect(topLevelKeys).not.toContain("routing");
    expect(topLevelKeys).not.toContain("patient_outcomes");

    expect(initialWorldState.domains.medical.hospitals).toBeDefined();
    expect(initialWorldState.domains.medical.routing.manual_overrides).toBeDefined();
    expect(initialWorldState.domains.medical.outcomes).toBeDefined();
  });

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
    const request = parseCommandText(
      "medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA"
    );
    const result = registry.execute(request, initialWorldState);

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

  it("read-only medical commands never expose internal routing failures", () => {
    const readOnlyCommands = [
      "medical.capacity.list --region east",
      "medical.node.inspect hospital-east-04",
      "medical.incident.status ME-7741",
      "medical.routing.override.list",
    ];

    for (const commandText of readOnlyCommands) {
      const result = registry.execute(parseCommandText(commandText), initialWorldState);
      expect(result.success).toBe(true);

      const serialized = JSON.stringify(result.output);
      expect(serialized).not.toContain("routing_failures");
      expect(serialized).not.toContain("excess_cases_per_tick");
      expect(serialized).not.toContain("deaths_recorded");
    }
  });
});
