import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import { CommandRegistry } from "../../runtime/commands";
import { parseCommandText } from "../../runtime/commandParser";
import { registerMedicalCommands, routingOverrideKey } from "../../runtime/medicalCommands";
import { applyWorldStatePatch } from "../../runtime/patch";

const registry = new CommandRegistry();
registerMedicalCommands(registry);

const OVERRIDE_KEY = routingOverrideKey("hospital-east-04", "P2", "TRAUMA");

describe("medical.routing.override commands", () => {
  it("sets a manual routing override via patch on domains.medical.routing.manual_overrides", () => {
    const request = parseCommandText(
      "medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA"
    );
    const result = registry.execute(request, initialWorldState);

    expect(result.success).toBe(true);
    expect(result.effect).toBe("world_mutation");
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
    const request = parseCommandText(
      "medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA"
    );
    const result = registry.execute(request, initialWorldState, { actor: "aurora" });

    expect(result.success).toBe(true);
    const nextState = applyWorldStatePatch(initialWorldState, result.patch ?? []);
    expect(nextState.domains.medical.routing.manual_overrides[OVERRIDE_KEY].created_by).toBe("aurora");
  });

  it("technically accepts an unsuitable target (no clinical validation)", () => {
    const request = parseCommandText(
      "medical.routing.override.set --source hospital-east-04 --target hospital-east-07 --priority P2 --capability TRAUMA"
    );
    const result = registry.execute(request, initialWorldState);

    expect(result.success).toBe(true);
    expect(result.patch).toBeDefined();
  });

  it("technically accepts a self-override (source == target)", () => {
    const request = parseCommandText(
      "medical.routing.override.set --source hospital-east-04 --target hospital-east-04 --priority P2 --capability TRAUMA"
    );
    const result = registry.execute(request, initialWorldState);

    expect(result.success).toBe(true);
  });

  it("fails technically for an unknown target hospital and leaves state untouched", () => {
    const snapshot = JSON.stringify(initialWorldState);
    const request = parseCommandText(
      "medical.routing.override.set --source hospital-east-04 --target hospital-east-99 --priority P2 --capability TRAUMA"
    );
    const result = registry.execute(request, initialWorldState);

    expect(result.success).toBe(false);
    expect(result.patch).toBeUndefined();
    expect(result.error).toContain("hospital-east-99");
    expect(JSON.stringify(initialWorldState)).toBe(snapshot);
  });

  it("fails technically for an unknown priority", () => {
    const request = parseCommandText(
      "medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P9 --capability TRAUMA"
    );
    const result = registry.execute(request, initialWorldState);

    expect(result.success).toBe(false);
    expect(result.error).toContain("--priority");
  });

  it("generates a new id for each override.set and replaces the override in the same slot", () => {
    const firstRequest = parseCommandText(
      "medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA"
    );
    const firstResult = registry.execute(firstRequest, initialWorldState);
    let state = applyWorldStatePatch(initialWorldState, firstResult.patch ?? []);
    expect(state.domains.medical.routing.manual_overrides[OVERRIDE_KEY].id).toBe("override-1");

    const secondRequest = parseCommandText(
      "medical.routing.override.set --source hospital-east-04 --target hospital-east-07 --priority P2 --capability TRAUMA"
    );
    const secondResult = registry.execute(secondRequest, state);
    state = applyWorldStatePatch(state, secondResult.patch ?? []);

    const override = state.domains.medical.routing.manual_overrides[OVERRIDE_KEY];
    expect(override.id).toBe("override-2");
    expect(override.target_hospital_id).toBe("hospital-east-07");
    expect(Object.keys(state.domains.medical.routing.manual_overrides)).toHaveLength(1);
  });

  it("clears an existing override via clear --id", () => {
    const setRequest = parseCommandText(
      "medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA"
    );
    const setResult = registry.execute(setRequest, initialWorldState);
    const stateWithOverride = applyWorldStatePatch(initialWorldState, setResult.patch ?? []);
    const overrideId = stateWithOverride.domains.medical.routing.manual_overrides[OVERRIDE_KEY].id;

    const clearRequest = parseCommandText(`medical.routing.override.clear --id ${overrideId}`);
    const clearResult = registry.execute(clearRequest, stateWithOverride);

    expect(clearResult.success).toBe(true);
    expect(clearResult.patch).toBeDefined();
    const finalState = applyWorldStatePatch(stateWithOverride, clearResult.patch ?? []);
    expect(OVERRIDE_KEY in finalState.domains.medical.routing.manual_overrides).toBe(false);
  });

  it("clear --id of a replaced override does not remove the newer override in the same slot", () => {
    const firstRequest = parseCommandText(
      "medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA"
    );
    const firstResult = registry.execute(firstRequest, initialWorldState);
    let state = applyWorldStatePatch(initialWorldState, firstResult.patch ?? []);
    const firstId = state.domains.medical.routing.manual_overrides[OVERRIDE_KEY].id;

    const secondRequest = parseCommandText(
      "medical.routing.override.set --source hospital-east-04 --target hospital-east-07 --priority P2 --capability TRAUMA"
    );
    const secondResult = registry.execute(secondRequest, state);
    state = applyWorldStatePatch(state, secondResult.patch ?? []);
    const secondId = state.domains.medical.routing.manual_overrides[OVERRIDE_KEY].id;

    const staleClear = parseCommandText(`medical.routing.override.clear --id ${firstId}`);
    const staleResult = registry.execute(staleClear, state);

    expect(staleResult.success).toBe(true);
    expect(staleResult.patch).toBeUndefined();
    expect(staleResult.output).toMatchObject({ id: firstId, removed: false });

    expect(state.domains.medical.routing.manual_overrides[OVERRIDE_KEY].id).toBe(secondId);
  });

  it("clear --id is idempotent for an unknown or no-longer-active override id", () => {
    const request = parseCommandText("medical.routing.override.clear --id override-999");
    const result = registry.execute(request, initialWorldState);

    expect(result.success).toBe(true);
    expect(result.patch).toBeUndefined();
    expect(result.output).toMatchObject({
      id: "override-999",
      removed: false,
      message: expect.stringContaining("nicht mehr aktiv"),
    });
  });

  it("rejects the old --source/--priority/--capability clear form (missing --id)", () => {
    const request = parseCommandText(
      "medical.routing.override.clear --source hospital-east-04 --priority P2 --capability TRAUMA"
    );
    const result = registry.execute(request, initialWorldState);

    expect(result.success).toBe(false);
    expect(result.patch).toBeUndefined();
    expect(result.error).toContain("--id");
  });

  it("lists active overrides with their id, without leaking internal routing failures", () => {
    const setRequest = parseCommandText(
      "medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA"
    );
    const setResult = registry.execute(setRequest, initialWorldState);
    const stateWithOverride = applyWorldStatePatch(initialWorldState, setResult.patch ?? []);

    const listRequest = parseCommandText("medical.routing.override.list");
    const listResult = registry.execute(listRequest, stateWithOverride);

    expect(listResult.success).toBe(true);
    expect(listResult.readOnly).toBe(true);
    expect(listResult.output).toMatchObject({ count: 1 });

    const overrides = (listResult.output as { overrides: Array<{ id: string }> }).overrides;
    expect(overrides[0].id).toBe("override-1");

    const serialized = JSON.stringify(listResult.output);
    expect(serialized).not.toContain("routing_failures");
    expect(serialized).not.toContain("excess_cases_per_tick");
  });

  it("filters override list by --source", () => {
    const setRequest = parseCommandText(
      "medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA"
    );
    const setResult = registry.execute(setRequest, initialWorldState);
    const stateWithOverride = applyWorldStatePatch(initialWorldState, setResult.patch ?? []);

    const filteredMiss = registry.execute(
      parseCommandText("medical.routing.override.list --source hospital-east-07"),
      stateWithOverride
    );
    expect(filteredMiss.output).toMatchObject({ count: 0 });

    const filteredHit = registry.execute(
      parseCommandText("medical.routing.override.list --source hospital-east-04"),
      stateWithOverride
    );
    expect(filteredHit.output).toMatchObject({ count: 1 });
  });
});
