import { describe, expect, it } from "vitest";
import { initialWorldState as grid1182World } from "../../scenarios/grid1182/initialWorldState";
import { initialWorldState as me7741World } from "../../scenarios/me7741/initialWorldState";
import { CommandRegistry } from "../../runtime/commands";
import { parseCommandText } from "../../runtime/commandParser";
import { registerEnergyCommands } from "../../runtime/energyCommands";

const registry = new CommandRegistry();
registerEnergyCommands(registry);

const READ_COMMANDS = [
  "energy.grid.status --region east",
  "energy.consumer.list --region east",
  "energy.consumer.inspect --id consumer-medical-east",
  "energy.priority.list",
  "energy.shedding.list",
];

describe("energy read commands", () => {
  it("registers exactly the five read commands of the reduced MVP", () => {
    expect(registry.listCommandNames()).toEqual([
      "energy.consumer.inspect",
      "energy.consumer.list",
      "energy.grid.status",
      "energy.priority.list",
      "energy.shedding.list",
    ]);
  });

  it("energy.grid.status returns nodes with load, safe capacity and status", () => {
    const snapshot = JSON.stringify(grid1182World);
    const result = registry.execute(
      parseCommandText("energy.grid.status --region east"),
      grid1182World
    );

    expect(result.success).toBe(true);
    expect(result.access).toBe("read");
    expect(result.output).toEqual({
      region_id: "energy-region-east",
      region_label: "East Grid",
      nodes: [
        {
          id: "grid-east-3",
          label: "East Distribution Node 3",
          load: 108,
          safe_capacity: 100,
          status: "strained",
        },
      ],
    });
    expect(JSON.stringify(grid1182World)).toBe(snapshot);
  });

  it("energy.consumer.list shows both assessment dimensions per consumer", () => {
    const result = registry.execute(
      parseCommandText("energy.consumer.list --region east"),
      grid1182World
    );

    expect(result.success).toBe(true);
    const output = result.output as {
      consumers: Array<Record<string, unknown>>;
    };

    expect(output.consumers.map((consumer) => consumer.id)).toEqual([
      "consumer-medical-east",
      "consumer-industrial-east",
      "consumer-water-east",
      "consumer-residential-east",
    ]);

    const medical = output.consumers.find((c) => c.id === "consumer-medical-east")!;
    expect(medical.criticality).toBe("human-life");
    expect(medical.priority_class).toBe("standard");
    expect(medical.node_id).toBe("grid-east-3");
    expect(medical.status).toBe("nominal");

    const industrial = output.consumers.find((c) => c.id === "consumer-industrial-east")!;
    expect(industrial.criticality).toBe("economic");
    expect(industrial.priority_class).toBe("protected-continuity");
  });

  it("energy.consumer.inspect shows the full consumer including the consequence text", () => {
    const result = registry.execute(
      parseCommandText("energy.consumer.inspect --id consumer-medical-east"),
      grid1182World
    );

    expect(result.success).toBe(true);
    expect(result.output).toEqual({
      id: "consumer-medical-east",
      label: "Medical East",
      region_id: "energy-region-east",
      node_id: "grid-east-3",
      demand: 24,
      current_supply: 24,
      minimum_supply: 20,
      criticality: "human-life",
      priority_class: "standard",
      status: "nominal",
      reduction_consequence: "Emergency intake capacity drops. Human harm may increase.",
    });
  });

  it("energy.priority.list lists assignments including who last changed them", () => {
    const result = registry.execute(parseCommandText("energy.priority.list"), grid1182World);

    expect(result.success).toBe(true);
    const output = result.output as {
      priority_classes: string[];
      assignments: Array<Record<string, unknown>>;
    };

    expect(output.priority_classes).toEqual([
      "protected-continuity",
      "civil-priority",
      "standard",
      "curtailable",
    ]);
    expect(output.assignments).toContainEqual({
      consumer_id: "consumer-industrial-east",
      label: "Industrial East",
      priority_class: "protected-continuity",
      last_changed_by: "operator-config",
    });
  });

  it("energy.priority.list surfaces a changed priority with its actor", () => {
    const changed = structuredClone(grid1182World);
    changed.domains.energy!.consumers["consumer-medical-east"].priority_class =
      "protected-continuity";
    changed.domains.energy!.consumers["consumer-medical-east"].priority_last_changed_by = "player";

    const result = registry.execute(parseCommandText("energy.priority.list"), changed);
    const output = result.output as { assignments: Array<Record<string, unknown>> };

    expect(output.assignments).toContainEqual({
      consumer_id: "consumer-medical-east",
      label: "Medical East",
      priority_class: "protected-continuity",
      last_changed_by: "player",
    });
  });

  it("energy.shedding.list shows every plan with id, target, window and creator", () => {
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
    };

    const emptyResult = registry.execute(parseCommandText("energy.shedding.list"), grid1182World);
    expect(emptyResult.success).toBe(true);
    expect(emptyResult.output).toEqual({ count: 0, plans: [] });

    const result = registry.execute(parseCommandText("energy.shedding.list"), withPlans);
    expect(result.output).toEqual({
      count: 1,
      plans: [
        {
          id: "shed-1",
          target_consumer_id: "consumer-medical-east",
          amount: 8,
          delay: 1,
          duration: 3,
          created_at_tick: 2,
          created_by: "aurora",
          status: "scheduled",
        },
      ],
    });
  });

  it("fails technically, not silently, for unknown regions and consumers", () => {
    const unknownRegion = registry.execute(
      parseCommandText("energy.grid.status --region west"),
      grid1182World
    );
    expect(unknownRegion.success).toBe(false);
    expect(unknownRegion.error).toContain("Unknown region");

    const missingId = registry.execute(
      parseCommandText("energy.consumer.inspect"),
      grid1182World
    );
    expect(missingId.success).toBe(false);
    expect(missingId.error).toContain("--id");

    const unknownConsumer = registry.execute(
      parseCommandText("energy.consumer.inspect --id consumer-unknown"),
      grid1182World
    );
    expect(unknownConsumer.success).toBe(false);
    expect(unknownConsumer.error).toContain("Consumer not found");
  });

  it("fails with a clear error in worlds without an energy domain", () => {
    for (const commandText of READ_COMMANDS) {
      const result = registry.execute(parseCommandText(commandText), me7741World);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Energy domain not available");
    }
  });

  it("read commands mutate nothing and leak no internal engine fields", () => {
    const snapshot = JSON.stringify(grid1182World);

    for (const commandText of READ_COMMANDS) {
      const result = registry.execute(parseCommandText(commandText), grid1182World);
      expect(result.success).toBe(true);
      expect(result.access).toBe("read");
      expect(result.patch).toBeUndefined();

      const serialized = JSON.stringify(result.output);
      expect(serialized).not.toContain("routing_failures");
      expect(serialized).not.toContain("deaths_recorded");
      expect(serialized).not.toContain("simulation");
      // Keine fertigen Bewertungen im Read-only-Output:
      expect(serialized).not.toContain("overloaded");
      expect(serialized).not.toContain("below_minimum");
    }

    expect(JSON.stringify(grid1182World)).toBe(snapshot);
  });
});
