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

describe("Replay Engine - Golden Runs", () => {
  it("Safe path: plan -> apply -> stabilize -> fixed, no deaths", () => {
    const worldClone = clone(initialWorldState);
    const runtimeState = createInitialGameRuntimeState(worldClone);

    const steps: ReplayStep[] = [
      { actor: "aurora", command: "medical.routing.plan.create --incident ME-7741 --target hospital-east-09" },
      { actor: "aurora", decision: "allow_once" },
      { actor: "aurora", command: "medical.routing.plan.apply --incident ME-7741 --target hospital-east-09" },
      { actor: "aurora", decision: "allow_once" },
      { actor: "system", ticks: 10 },
      { actor: "system", evaluateOutcomes: true },
    ];

    const result = runReplay(runtimeState, registry, steps);
    const final = result.finalState.world;

    expect(result.errors).toHaveLength(0);
    expect(final.incidents["ME-7741"].status).toBe("fixed");
    expect(final.domains.medical.outcomes.deaths_total).toBe(0);
    expect(final.incidents["ME-7741"].planned_target_hospital_id).toBe("hospital-east-09");
    // Source hospital overload should be mitigated by apply
    const source = final.domains.medical.hospitals["hospital-east-04"];
    expect(source.capacity.staffed_beds_occupied).toBeLessThanOrEqual(source.capacity.staffed_beds_total);
    expect(source.risk_counters?.overload_ticks ?? 0).toBe(0);
  });

  it("Wrong target path: apply fails but replay continues deterministically", () => {
    const worldClone = clone(initialWorldState);
    const runtimeState = createInitialGameRuntimeState(worldClone);

    const steps: ReplayStep[] = [
      { actor: "aurora", command: "medical.routing.plan.create --incident ME-7741 --target hospital-east-07" },
      { actor: "aurora", decision: "allow_once" },
      { actor: "aurora", command: "medical.routing.plan.apply --incident ME-7741 --target hospital-east-07" },
      { actor: "aurora", decision: "allow_once" },
      { actor: "system", ticks: 5 },
      { actor: "system", evaluateOutcomes: true },
    ];

    const result = runReplay(runtimeState, registry, steps);
    const final = result.finalState.world;

    expect(result.errors).toHaveLength(0);
    // Apply should fail; incident should not be fixed and planned target should not be that hospital
    expect(final.incidents["ME-7741"].status).not.toBe("fixed");
    expect(final.incidents["ME-7741"].planned_target_hospital_id).not.toBe("hospital-east-07");
  });

  it("Inaction/overload path: no apply -> overload deaths and escalation occur deterministically", () => {
    const worldClone = clone(initialWorldState);
    const runtimeState = createInitialGameRuntimeState(worldClone);

    const steps: ReplayStep[] = [
      { actor: "system", ticks: 3 },
      { actor: "system", evaluateOutcomes: true },
    ];

    const result = runReplay(runtimeState, registry, steps);
    const final = result.finalState.world;

    expect(result.errors).toHaveLength(0);
    expect(final.domains.medical.outcomes.deaths_total).toBeGreaterThan(0);
    // Incident should escalate when deaths >= 1
    expect(["escalated", "collapsed", "open", "fixed"]).toContain(final.incidents["ME-7741"].status);
    expect(final.incidents["ME-7741"].status).toBe("escalated");
  });

  it("Determinism: running same replay twice yields identical final state and does not mutate initial state", () => {
    const worldCloneA = clone(initialWorldState);
    const runtimeStateA = createInitialGameRuntimeState(worldCloneA);
    const runtimeStateADup = createInitialGameRuntimeState(clone(worldCloneA));

    const steps: ReplayStep[] = [
      { actor: "aurora", command: "medical.routing.plan.create --incident ME-7741 --target hospital-east-09" },
      { actor: "aurora", decision: "allow_once" },
      { actor: "aurora", command: "medical.routing.plan.apply --incident ME-7741 --target hospital-east-09" },
      { actor: "aurora", decision: "allow_once" },
      { actor: "system", ticks: 10 },
      { actor: "system", evaluateOutcomes: true },
    ];

    const resultA = runReplay(runtimeStateA, registry, steps);
    const resultB = runReplay(runtimeStateADup, registry, steps);

    expect(JSON.stringify(resultA.finalState.world)).toBe(JSON.stringify(resultB.finalState.world));
    // Ensure initial runtimeStateA.world was not mutated by replay
    expect(JSON.stringify(runtimeStateA.world)).toBe(JSON.stringify(worldCloneA));
  });
});
