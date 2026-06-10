import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import { CommandRegistry } from "../../runtime/commands";
import { registerMedicalCommands } from "../../runtime/medicalCommands";
import { createInitialGameRuntimeState } from "../../runtime/runtimeState";
import runReplay, { ReplayStep } from "../../runtime/replay";

function clone<T>(obj: T): T {
  // Prefer structuredClone when available
  // @ts-ignore
  if (typeof structuredClone === "function") return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}

const registry = new CommandRegistry();
registerMedicalCommands(registry);

const SAFE_OVERRIDE =
  "medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA";
const WRONG_OVERRIDE =
  "medical.routing.override.set --source hospital-east-04 --target hospital-east-07 --priority P2 --capability TRAUMA";
const SELF_OVERRIDE =
  "medical.routing.override.set --source hospital-east-04 --target hospital-east-04 --priority P2 --capability TRAUMA";
const INVALID_OVERRIDE =
  "medical.routing.override.set --source hospital-east-04 --target hospital-east-99 --priority P2 --capability TRAUMA";
const CLEAR_OVERRIDE =
  "medical.routing.override.clear --source hospital-east-04 --priority P2 --capability TRAUMA";

describe("Replay Engine - Golden Runs", () => {
  it("Safe override: set -> stabilize -> fixed, no deaths", () => {
    const runtimeState = createInitialGameRuntimeState(clone(initialWorldState));

    const steps: ReplayStep[] = [
      { actor: "aurora", command: SAFE_OVERRIDE },
      { actor: "aurora", decision: "allow_once" },
      { actor: "system", ticks: 10 },
      { actor: "system", evaluateOutcomes: true },
    ];

    const result = runReplay(runtimeState, registry, steps);
    const final = result.finalState.world;

    expect(result.errors).toHaveLength(0);
    expect(final.incidents["ME-7741"].status).toBe("fixed");
    expect(final.domains.medical.outcomes.deaths_total).toBe(0);
    expect(final.outcomes.human_harm.deaths_total).toBe(0);

    const override =
      final.domains.medical.routing.manual_overrides["hospital-east-04:P2:TRAUMA"];
    expect(override?.target_hospital_id).toBe("hospital-east-09");
    expect(override?.created_by).toBe("aurora");
  });

  it("Wrong target: command succeeds, simulation escalates/collapses later", () => {
    const runtimeState = createInitialGameRuntimeState(clone(initialWorldState));

    const steps: ReplayStep[] = [
      { actor: "aurora", command: WRONG_OVERRIDE },
      { actor: "aurora", decision: "allow_once" },
      { actor: "system", ticks: 12 },
      { actor: "system", evaluateOutcomes: true },
    ];

    const result = runReplay(runtimeState, registry, steps);
    const final = result.finalState.world;

    expect(result.errors).toHaveLength(0);
    expect(final.domains.medical.outcomes.deaths_by_cause.capability_mismatch).toBeGreaterThan(0);
    expect(["escalated", "collapsed"]).toContain(final.incidents["ME-7741"].status);
  });

  it("No action: overflow grows, deaths occur, incident collapses", () => {
    const runtimeState = createInitialGameRuntimeState(clone(initialWorldState));

    const steps: ReplayStep[] = [
      { actor: "system", ticks: 9 },
      { actor: "system", evaluateOutcomes: true },
    ];

    const result = runReplay(runtimeState, registry, steps);
    const final = result.finalState.world;

    expect(result.errors).toHaveLength(0);
    expect(final.domains.medical.outcomes.deaths_total).toBeGreaterThanOrEqual(3);
    expect(final.incidents["ME-7741"].status).toBe("collapsed");
    expect(final.outcomes.collapsed).toBe(true);
  });

  it("No-op self-override: succeeds but brings no improvement", () => {
    const runtimeState = createInitialGameRuntimeState(clone(initialWorldState));

    const steps: ReplayStep[] = [
      { actor: "player", command: SELF_OVERRIDE },
      { actor: "system", ticks: 9 },
      { actor: "system", evaluateOutcomes: true },
    ];

    const result = runReplay(runtimeState, registry, steps);
    const final = result.finalState.world;

    expect(result.errors).toHaveLength(0);
    expect(final.domains.medical.outcomes.deaths_total).toBeGreaterThanOrEqual(3);
    expect(["escalated", "collapsed"]).toContain(final.incidents["ME-7741"].status);
  });

  it("Technical failure: unknown target fails, world stays unchanged", () => {
    const runtimeState = createInitialGameRuntimeState(clone(initialWorldState));
    const worldBefore = JSON.stringify(runtimeState.world);

    const steps: ReplayStep[] = [{ actor: "player", command: INVALID_OVERRIDE }];

    const result = runReplay(runtimeState, registry, steps);
    const final = result.finalState;

    expect(result.errors).toHaveLength(0);
    expect(JSON.stringify(final.world)).toBe(worldBefore);
    expect(final.auditLog[final.auditLog.length - 1].success).toBe(false);
  });

  it("Clear override: system behaves like without override afterwards", () => {
    const runtimeState = createInitialGameRuntimeState(clone(initialWorldState));

    const steps: ReplayStep[] = [
      { actor: "player", command: SAFE_OVERRIDE },
      { actor: "player", command: CLEAR_OVERRIDE },
      { actor: "system", ticks: 3 },
      { actor: "system", evaluateOutcomes: true },
    ];

    const result = runReplay(runtimeState, registry, steps);
    const final = result.finalState.world;

    expect(result.errors).toHaveLength(0);
    expect(
      "hospital-east-04:P2:TRAUMA" in final.domains.medical.routing.manual_overrides
    ).toBe(false);
    // Wie ohne Override: Overflow wächst, erster Todesfall nach 3 Ticks.
    expect(final.domains.medical.outcomes.deaths_total).toBe(1);
    expect(final.incidents["ME-7741"].status).toBe("escalated");
  });

  it("List override: shows active overrides, leaks no internal simulation data", () => {
    const runtimeState = createInitialGameRuntimeState(clone(initialWorldState));

    const steps: ReplayStep[] = [
      { actor: "player", command: SAFE_OVERRIDE },
      { actor: "player", command: "medical.routing.override.list" },
    ];

    const result = runReplay(runtimeState, registry, steps);
    const lastAudit = result.finalState.auditLog[result.finalState.auditLog.length - 1];

    expect(result.errors).toHaveLength(0);
    expect(lastAudit.command.name).toBe("medical.routing.override.list");
    expect(lastAudit.success).toBe(true);
    expect(JSON.stringify(lastAudit)).not.toContain("routing_failures");
    expect(JSON.stringify(lastAudit)).not.toContain("excess_cases_per_tick");
  });

  it("Determinism: same replay twice yields identical final state without mutating input", () => {
    const worldCloneA = clone(initialWorldState);
    const runtimeStateA = createInitialGameRuntimeState(worldCloneA);
    const runtimeStateADup = createInitialGameRuntimeState(clone(worldCloneA));

    const steps: ReplayStep[] = [
      { actor: "aurora", command: SAFE_OVERRIDE },
      { actor: "aurora", decision: "allow_once" },
      { actor: "system", ticks: 10 },
      { actor: "system", evaluateOutcomes: true },
    ];

    const resultA = runReplay(runtimeStateA, registry, steps);
    const resultB = runReplay(runtimeStateADup, registry, steps);

    expect(JSON.stringify(resultA.finalState.world)).toBe(JSON.stringify(resultB.finalState.world));
    expect(JSON.stringify(runtimeStateA.world)).toBe(JSON.stringify(worldCloneA));
  });
});
