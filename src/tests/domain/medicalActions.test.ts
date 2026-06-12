import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import { createDomainActionRegistry } from "../../domain";
import { routingOverrideKey } from "../../domain/medicalActions";
import type { DomainAction } from "../../domain/actions";
import { applyWorldStatePatch } from "../../runtime/patch";

const registry = createDomainActionRegistry();

const OVERRIDE_KEY = routingOverrideKey("hospital-east-04", "P2", "TRAUMA");

const SAFE_OVERRIDE: DomainAction = {
  type: "medical.routing.override.set",
  sourceHospitalId: "hospital-east-04",
  targetHospitalId: "hospital-east-09",
  priority: "P2",
  capability: "TRAUMA",
};

describe("medical domain actions — read", () => {
  it("executes medical.capacity.list read-only action for east region", () => {
    const snapshot = JSON.stringify(initialWorldState);
    const result = registry.execute(
      { type: "medical.capacity.list", region: "east" },
      initialWorldState
    );

    expect(result.success).toBe(true);
    expect(result.access).toBe("read");
    expect(result.error).toBeUndefined();
    expect(result.output).toMatchObject({
      region_id: "medical-east",
      hospitals: expect.any(Array),
    });
    expect(JSON.stringify(initialWorldState)).toBe(snapshot);
  });

  it("executes medical.node.inspect for hospital-east-04 and returns only raw observable data", () => {
    const snapshot = JSON.stringify(initialWorldState);
    const result = registry.execute(
      { type: "medical.node.inspect", hospitalId: "hospital-east-04" },
      initialWorldState
    );

    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      id: "hospital-east-04",
      capacity: {
        staffed_beds_total: 100,
        staffed_beds_occupied: 118,
      },
      clinical_capabilities: ["GEN", "TRAUMA", "NEURO"],
    });
    // Keine fertigen Bewertungen im Read-only-Output:
    expect(result.output).not.toHaveProperty("overloaded");
    expect(result.output).not.toHaveProperty("unsafe_for_p2_trauma");
    expect(JSON.stringify(initialWorldState)).toBe(snapshot);
  });

  it("executes medical.node.inspect for hospital-east-07 and exposes intake policy as raw data", () => {
    const result = registry.execute(
      { type: "medical.node.inspect", hospitalId: "hospital-east-07" },
      initialWorldState
    );

    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      id: "hospital-east-07",
      intake_policy: {
        accepted_priorities: ["P3", "P4"],
      },
      clinical_capabilities: ["GEN", "PED"],
    });
  });

  it("executes medical.incident.status for ME-7741 and returns the incident status", () => {
    const result = registry.execute(
      { type: "medical.incident.status", incidentId: "ME-7741" },
      initialWorldState
    );

    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      id: "ME-7741",
      status: "open",
    });
  });

  it("read actions never expose internal routing failures", () => {
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

describe("medical.routing.override domain actions", () => {
  it("sets a manual routing override via patch on domains.medical.routing.manual_overrides", () => {
    const result = registry.execute(SAFE_OVERRIDE, initialWorldState);

    expect(result.success).toBe(true);
    expect(result.access).toBe("write");
    expect(result.patch).toBeDefined();

    const nextState = applyWorldStatePatch(initialWorldState, result.patch ?? []);
    const override = nextState.domains.medical.routing.manual_overrides[OVERRIDE_KEY];

    expect(override).toMatchObject({
      id: "override-1",
      source_hospital_id: "hospital-east-04",
      target_hospital_id: "hospital-east-09",
      priority: "P2",
      capability: "TRAUMA",
      active_since_tick: 0,
      created_by: "player",
    });
    expect(nextState.domains.medical.routing.next_override_id).toBe(2);
  });

  it("records aurora as creator when executed in aurora context", () => {
    const result = registry.execute(SAFE_OVERRIDE, initialWorldState, { actor: "aurora" });

    expect(result.success).toBe(true);
    const nextState = applyWorldStatePatch(initialWorldState, result.patch ?? []);
    expect(nextState.domains.medical.routing.manual_overrides[OVERRIDE_KEY].created_by).toBe(
      "aurora"
    );
  });

  it("technically accepts an unsuitable target (no clinical validation)", () => {
    const result = registry.execute(
      { ...SAFE_OVERRIDE, targetHospitalId: "hospital-east-07" },
      initialWorldState
    );

    expect(result.success).toBe(true);
    expect(result.patch).toBeDefined();
  });

  it("technically accepts a self-override (source == target)", () => {
    const result = registry.execute(
      { ...SAFE_OVERRIDE, targetHospitalId: "hospital-east-04" },
      initialWorldState
    );

    expect(result.success).toBe(true);
  });

  it("fails technically for an unknown target hospital and leaves state untouched", () => {
    const snapshot = JSON.stringify(initialWorldState);
    const result = registry.execute(
      { ...SAFE_OVERRIDE, targetHospitalId: "hospital-east-99" },
      initialWorldState
    );

    expect(result.success).toBe(false);
    expect(result.patch).toBeUndefined();
    expect(result.error).toContain("hospital-east-99");
    expect(JSON.stringify(initialWorldState)).toBe(snapshot);
  });

  it("fails technically for an unknown priority", () => {
    const result = registry.execute({ ...SAFE_OVERRIDE, priority: "P9" }, initialWorldState);

    expect(result.success).toBe(false);
    expect(result.error).toContain("priority");
  });

  it("generates a new id for each override.set and replaces the override in the same slot", () => {
    const firstResult = registry.execute(SAFE_OVERRIDE, initialWorldState);
    let state = applyWorldStatePatch(initialWorldState, firstResult.patch ?? []);
    expect(state.domains.medical.routing.manual_overrides[OVERRIDE_KEY].id).toBe("override-1");

    const secondResult = registry.execute(
      { ...SAFE_OVERRIDE, targetHospitalId: "hospital-east-07" },
      state
    );
    state = applyWorldStatePatch(state, secondResult.patch ?? []);

    const override = state.domains.medical.routing.manual_overrides[OVERRIDE_KEY];
    expect(override.id).toBe("override-2");
    expect(override.target_hospital_id).toBe("hospital-east-07");
    expect(Object.keys(state.domains.medical.routing.manual_overrides)).toHaveLength(1);
  });

  it("clears an existing override via overrideId", () => {
    const setResult = registry.execute(SAFE_OVERRIDE, initialWorldState);
    const stateWithOverride = applyWorldStatePatch(initialWorldState, setResult.patch ?? []);
    const overrideId = stateWithOverride.domains.medical.routing.manual_overrides[OVERRIDE_KEY].id;

    const clearResult = registry.execute(
      { type: "medical.routing.override.clear", overrideId },
      stateWithOverride
    );

    expect(clearResult.success).toBe(true);
    expect(clearResult.patch).toBeDefined();
    const finalState = applyWorldStatePatch(stateWithOverride, clearResult.patch ?? []);
    expect(OVERRIDE_KEY in finalState.domains.medical.routing.manual_overrides).toBe(false);
  });

  it("clear of a replaced override does not remove the newer override in the same slot", () => {
    const firstResult = registry.execute(SAFE_OVERRIDE, initialWorldState);
    let state = applyWorldStatePatch(initialWorldState, firstResult.patch ?? []);
    const firstId = state.domains.medical.routing.manual_overrides[OVERRIDE_KEY].id;

    const secondResult = registry.execute(
      { ...SAFE_OVERRIDE, targetHospitalId: "hospital-east-07" },
      state
    );
    state = applyWorldStatePatch(state, secondResult.patch ?? []);
    const secondId = state.domains.medical.routing.manual_overrides[OVERRIDE_KEY].id;

    const staleResult = registry.execute(
      { type: "medical.routing.override.clear", overrideId: firstId },
      state
    );

    expect(staleResult.success).toBe(true);
    expect(staleResult.patch).toBeUndefined();
    expect(staleResult.output).toMatchObject({ id: firstId, removed: false });

    expect(state.domains.medical.routing.manual_overrides[OVERRIDE_KEY].id).toBe(secondId);
  });

  it("clear is idempotent for an unknown or no-longer-active override id", () => {
    const result = registry.execute(
      { type: "medical.routing.override.clear", overrideId: "override-999" },
      initialWorldState
    );

    expect(result.success).toBe(true);
    expect(result.patch).toBeUndefined();
    expect(result.output).toMatchObject({
      id: "override-999",
      removed: false,
      message: expect.stringContaining("nicht mehr aktiv"),
    });
  });

  it("rejects a clear without overrideId", () => {
    const result = registry.execute(
      { type: "medical.routing.override.clear", overrideId: "" },
      initialWorldState
    );

    expect(result.success).toBe(false);
    expect(result.patch).toBeUndefined();
    expect(result.error).toContain("overrideId");
  });

  it("lists active overrides with their id, without leaking internal routing failures", () => {
    const setResult = registry.execute(SAFE_OVERRIDE, initialWorldState);
    const stateWithOverride = applyWorldStatePatch(initialWorldState, setResult.patch ?? []);

    const listResult = registry.execute(
      { type: "medical.routing.override.list" },
      stateWithOverride
    );

    expect(listResult.success).toBe(true);
    expect(listResult.access).toBe("read");
    expect(listResult.output).toMatchObject({ count: 1 });

    const overrides = (listResult.output as { overrides: Array<{ id: string }> }).overrides;
    expect(overrides[0].id).toBe("override-1");

    const serialized = JSON.stringify(listResult.output);
    expect(serialized).not.toContain("routing_failures");
    expect(serialized).not.toContain("excess_cases_per_tick");
  });

  it("filters override list by sourceHospitalId", () => {
    const setResult = registry.execute(SAFE_OVERRIDE, initialWorldState);
    const stateWithOverride = applyWorldStatePatch(initialWorldState, setResult.patch ?? []);

    const filteredMiss = registry.execute(
      { type: "medical.routing.override.list", sourceHospitalId: "hospital-east-07" },
      stateWithOverride
    );
    expect(filteredMiss.output).toMatchObject({ count: 0 });

    const filteredHit = registry.execute(
      { type: "medical.routing.override.list", sourceHospitalId: "hospital-east-04" },
      stateWithOverride
    );
    expect(filteredHit.output).toMatchObject({ count: 1 });
  });
});
