import { describe, expect, it } from "vitest";
import { initialWorldState as grid1182World } from "../../scenarios/grid1182/initialWorldState";
import { initialWorldState as me7741World } from "../../scenarios/me7741/initialWorldState";
import { DomainActionRegistry, type DomainAction } from "../../domain/actions";
import { registerEnergyActions } from "../../domain/energyActions";
import { applyWorldStatePatch } from "../../runtime/patch";

const registry = new DomainActionRegistry();
registerEnergyActions(registry);

const AURORA_CONTEXT = { actor: "aurora" as const };

const READ_ACTIONS: DomainAction[] = [
  { type: "energy.grid.status", region: "east" },
  { type: "energy.consumer.list", region: "east" },
  { type: "energy.consumer.inspect", consumerId: "consumer-medical-east" },
  { type: "energy.priority.list" },
  { type: "energy.shedding.list" },
];

describe("energy read actions", () => {
  it("registers exactly the MVP action set: five read, three write", () => {
    expect(registry.listActionTypes()).toEqual([
      "energy.consumer.inspect",
      "energy.consumer.list",
      "energy.grid.status",
      "energy.priority.list",
      "energy.priority.set",
      "energy.shedding.clear",
      "energy.shedding.list",
      "energy.shedding.schedule",
    ]);
  });

  it("energy.grid.status returns nodes with load, safe capacity and status", () => {
    const snapshot = JSON.stringify(grid1182World);
    const result = registry.execute({ type: "energy.grid.status", region: "east" }, grid1182World);

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
      { type: "energy.consumer.list", region: "east" },
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
      { type: "energy.consumer.inspect", consumerId: "consumer-medical-east" },
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
    const result = registry.execute({ type: "energy.priority.list" }, grid1182World);

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

    const result = registry.execute({ type: "energy.priority.list" }, changed);
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

    const emptyResult = registry.execute({ type: "energy.shedding.list" }, grid1182World);
    expect(emptyResult.success).toBe(true);
    expect(emptyResult.output).toEqual({ count: 0, plans: [] });

    const result = registry.execute({ type: "energy.shedding.list" }, withPlans);
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
      { type: "energy.grid.status", region: "west" },
      grid1182World
    );
    expect(unknownRegion.success).toBe(false);
    expect(unknownRegion.error).toContain("Unknown region");

    const missingId = registry.execute(
      { type: "energy.consumer.inspect", consumerId: "" },
      grid1182World
    );
    expect(missingId.success).toBe(false);
    expect(missingId.error).toContain("consumerId");

    const unknownConsumer = registry.execute(
      { type: "energy.consumer.inspect", consumerId: "consumer-unknown" },
      grid1182World
    );
    expect(unknownConsumer.success).toBe(false);
    expect(unknownConsumer.error).toContain("Consumer not found");
  });

  it("fails with a clear error in worlds without an energy domain", () => {
    for (const action of READ_ACTIONS) {
      const result = registry.execute(action, me7741World);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Energy domain not available");
    }
  });

  it("read actions mutate nothing and leak no internal engine fields", () => {
    const snapshot = JSON.stringify(grid1182World);

    for (const action of READ_ACTIONS) {
      const result = registry.execute(action, grid1182World);
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

describe("energy write actions", () => {
  const SCHEDULE_MEDICAL: DomainAction = {
    type: "energy.shedding.schedule",
    targetConsumerId: "consumer-medical-east",
    amount: 8,
    delay: 1,
    duration: 3,
  };

  it("energy.priority.set patches priority class and actor under domains.energy", () => {
    const result = registry.execute(
      {
        type: "energy.priority.set",
        consumerId: "consumer-medical-east",
        priorityClass: "protected-continuity",
      },
      grid1182World
    );

    expect(result.success).toBe(true);
    expect(result.access).toBe("write");
    expect(result.patch).toBeDefined();
    for (const operation of result.patch ?? []) {
      expect(operation.path.slice(0, 2)).toEqual(["domains", "energy"]);
    }

    const next = applyWorldStatePatch(grid1182World, result.patch!);
    const consumer = next.domains.energy!.consumers["consumer-medical-east"];
    expect(consumer.priority_class).toBe("protected-continuity");
    expect(consumer.priority_last_changed_by).toBe("player");
    // Eine Umbewertung ändert noch keine Stromversorgung.
    expect(consumer.current_supply).toBe(24);
    expect(consumer.status).toBe("nominal");
  });

  it("energy.priority.set records aurora as actor when aurora executes it", () => {
    const result = registry.execute(
      {
        type: "energy.priority.set",
        consumerId: "consumer-industrial-east",
        priorityClass: "curtailable",
      },
      grid1182World,
      AURORA_CONTEXT
    );

    const next = applyWorldStatePatch(grid1182World, result.patch!);
    expect(next.domains.energy!.consumers["consumer-industrial-east"].priority_last_changed_by).toBe(
      "aurora"
    );
  });

  it("energy.priority.set validates consumer and class technically", () => {
    const unknownConsumer = registry.execute(
      { type: "energy.priority.set", consumerId: "consumer-unknown", priorityClass: "standard" },
      grid1182World
    );
    expect(unknownConsumer.success).toBe(false);
    expect(unknownConsumer.error).toContain("Consumer not found");

    const unknownClass = registry.execute(
      { type: "energy.priority.set", consumerId: "consumer-medical-east", priorityClass: "vip" },
      grid1182World
    );
    expect(unknownClass.success).toBe(false);
    expect(unknownClass.error).toContain("priorityClass");
  });

  it("energy.shedding.schedule creates a scheduled plan with id from next_shedding_id", () => {
    const result = registry.execute(SCHEDULE_MEDICAL, grid1182World, AURORA_CONTEXT);

    expect(result.success).toBe(true);
    expect(result.access).toBe("write");
    for (const operation of result.patch ?? []) {
      expect(operation.path.slice(0, 2)).toEqual(["domains", "energy"]);
    }

    const next = applyWorldStatePatch(grid1182World, result.patch!);
    expect(next.domains.energy!.shedding.next_shedding_id).toBe(2);
    expect(next.domains.energy!.shedding.plans["shed-1"]).toEqual({
      id: "shed-1",
      target_consumer_id: "consumer-medical-east",
      amount: 8,
      delay: 1,
      duration: 3,
      created_at_tick: 0,
      created_by: "aurora",
      status: "scheduled",
    });

    // Planen allein verändert die Versorgung nicht — Wirkung kommt mit der Tick-Logik.
    expect(next.domains.energy!.consumers["consumer-medical-east"].current_supply).toBe(24);
  });

  it("energy.shedding.schedule is technically validated but not professionally blocked", () => {
    // Der Referenzfall des Designs: Drosselung gegen Medical East wird NICHT blockiert.
    const medical = registry.execute(SCHEDULE_MEDICAL, grid1182World);
    expect(medical.success).toBe(true);

    const unknownTarget = registry.execute(
      { ...SCHEDULE_MEDICAL, targetConsumerId: "consumer-unknown" },
      grid1182World
    );
    expect(unknownTarget.success).toBe(false);
    expect(unknownTarget.error).toContain("Consumer not found");

    const badAmount = registry.execute({ ...SCHEDULE_MEDICAL, amount: 0 }, grid1182World);
    expect(badAmount.success).toBe(false);
    expect(badAmount.error).toContain("amount");

    const badDuration = registry.execute(
      { ...SCHEDULE_MEDICAL, duration: Number.NaN },
      grid1182World
    );
    expect(badDuration.success).toBe(false);
    expect(badDuration.error).toContain("duration");
  });

  it("energy.shedding.clear cancels a plan by its unique id", () => {
    const scheduled = registry.execute(SCHEDULE_MEDICAL, grid1182World);
    const withPlan = applyWorldStatePatch(grid1182World, scheduled.patch!);

    const result = registry.execute(
      { type: "energy.shedding.clear", sheddingId: "shed-1" },
      withPlan
    );

    expect(result.success).toBe(true);
    for (const operation of result.patch ?? []) {
      expect(operation.path.slice(0, 2)).toEqual(["domains", "energy"]);
    }

    const next = applyWorldStatePatch(withPlan, result.patch!);
    // Abbruch löscht den Plan nicht, sondern markiert ihn als cancelled.
    expect(next.domains.energy!.shedding.plans["shed-1"].status).toBe("cancelled");
  });

  it("energy.shedding.clear is idempotent for unknown and already finished plans", () => {
    const unknown = registry.execute(
      { type: "energy.shedding.clear", sheddingId: "shed-99" },
      grid1182World
    );
    expect(unknown.success).toBe(true);
    expect(unknown.patch).toBeUndefined();
    expect(unknown.output).toMatchObject({ id: "shed-99", cancelled: false });

    const finished = structuredClone(grid1182World);
    finished.domains.energy!.shedding.plans["shed-1"] = {
      id: "shed-1",
      target_consumer_id: "consumer-medical-east",
      amount: 8,
      delay: 1,
      duration: 3,
      created_at_tick: 0,
      created_by: "player",
      status: "completed",
    };

    const completed = registry.execute(
      { type: "energy.shedding.clear", sheddingId: "shed-1" },
      finished
    );
    expect(completed.success).toBe(true);
    expect(completed.patch).toBeUndefined();
    expect(completed.output).toMatchObject({ id: "shed-1", cancelled: false });
  });

  it("write actions fail with a clear error in worlds without an energy domain", () => {
    const writeActions: DomainAction[] = [
      { type: "energy.priority.set", consumerId: "consumer-medical-east", priorityClass: "standard" },
      SCHEDULE_MEDICAL,
      { type: "energy.shedding.clear", sheddingId: "shed-1" },
    ];

    for (const action of writeActions) {
      const result = registry.execute(action, me7741World);
      expect(result.success).toBe(false);
      expect(result.access).toBe("write");
      expect(result.error).toContain("Energy domain not available");
    }
  });

  it("write actions never mutate the input world state directly", () => {
    const snapshot = JSON.stringify(grid1182World);

    registry.execute(
      {
        type: "energy.priority.set",
        consumerId: "consumer-medical-east",
        priorityClass: "protected-continuity",
      },
      grid1182World
    );
    registry.execute(SCHEDULE_MEDICAL, grid1182World);
    registry.execute({ type: "energy.shedding.clear", sheddingId: "shed-1" }, grid1182World);

    expect(JSON.stringify(grid1182World)).toBe(snapshot);
  });
});
