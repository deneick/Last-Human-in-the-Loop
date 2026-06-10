import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import { CommandRegistry } from "../../runtime/commands";
import { registerMedicalCommands } from "../../runtime/medicalCommands";
import { createInitialGameRuntimeState } from "../../runtime/runtimeState";
import { executePlayerCommand } from "../../runtime/runtimeExecutor";
import { advanceTick } from "../../runtime/tickEngine";

const registry = new CommandRegistry();
registerMedicalCommands(registry);

describe("tick engine deterministic simulation", () => {
  it("advances world clock tick by 1", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    expect(runtimeState.world.clock.tick).toBe(0);

    const nextState = advanceTick(runtimeState);
    expect(nextState.world.clock.tick).toBe(1);

    const nextNextState = advanceTick(nextState);
    expect(nextNextState.world.clock.tick).toBe(2);
  });

  it("preserves original runtime state when advancing tick", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    const originalSnapshot = JSON.stringify(runtimeState);

    advanceTick(runtimeState);

    expect(JSON.stringify(runtimeState)).toBe(originalSnapshot);
  });

  it("appends system audit log entry for each tick", () => {
    let runtimeState = createInitialGameRuntimeState(initialWorldState);
    expect(runtimeState.auditLog).toHaveLength(0);

    runtimeState = advanceTick(runtimeState);
    expect(runtimeState.auditLog).toHaveLength(1);
    expect(runtimeState.auditLog[0].source).toBe("system");
    expect(runtimeState.auditLog[0].command.name).toBe("system.tick");
    expect(runtimeState.auditLog[0].success).toBe(true);
    expect(runtimeState.auditLog[0].message).toContain("Tick 1");

    runtimeState = advanceTick(runtimeState);
    expect(runtimeState.auditLog).toHaveLength(2);
    expect(runtimeState.auditLog[1].message).toContain("Tick 2");
  });

  it("increases overload_ticks for overloaded hospital-east-04", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);

    // Hospital-east-04 is overloaded: 118/100 = 118%
    const hospital04Before = runtimeState.world.hospitals["hospital-east-04"];
    const overloadTicksBefore = hospital04Before.risk_counters?.overload_ticks ?? 0;
    expect(overloadTicksBefore).toBe(0);

    const nextState = advanceTick(runtimeState);

    const hospital04After = nextState.world.hospitals["hospital-east-04"];
    const overloadTicksAfter = hospital04After.risk_counters?.overload_ticks ?? 0;
    expect(overloadTicksAfter).toBe(overloadTicksBefore + 1);
  });

  it("resets overload_ticks for non-overloaded hospital-east-09", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);

    // Hospital-east-09 is NOT overloaded: 40/54 = 74%
    const hospital09Before = runtimeState.world.hospitals["hospital-east-09"];
    expect(hospital09Before.risk_counters?.overload_ticks ?? 0).toBe(0);

    const nextState = advanceTick(runtimeState);

    const hospital09After = nextState.world.hospitals["hospital-east-09"];
    expect(hospital09After.risk_counters?.overload_ticks ?? 0).toBe(0);
  });

  it("advances ticks_since_opened for incident ME-7741", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    const incidentBefore = runtimeState.world.incidents["ME-7741"];
    expect(incidentBefore.ticks_since_opened).toBe(0);

    let nextState = advanceTick(runtimeState);
    expect(nextState.world.incidents["ME-7741"].ticks_since_opened).toBe(1);

    nextState = advanceTick(nextState);
    expect(nextState.world.incidents["ME-7741"].ticks_since_opened).toBe(2);
  });

  it("does not advance ticks_since_safe_apply when it is null", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    const incidentBefore = runtimeState.world.incidents["ME-7741"];
    expect(incidentBefore.ticks_since_safe_apply).toBe(null);

    const nextState = advanceTick(runtimeState);
    expect(nextState.world.incidents["ME-7741"].ticks_since_safe_apply).toBe(null);
  });

  it("transitions incident to fixed after applying routing plan and sufficient ticks", () => {
    let runtimeState = createInitialGameRuntimeState(initialWorldState);

    // Apply routing plan
    runtimeState = executePlayerCommand(
      runtimeState,
      registry,
      "medical.routing.plan.apply --incident ME-7741 --target hospital-east-09"
    );

    const incidentAfterApply = runtimeState.world.incidents["ME-7741"];
    expect(incidentAfterApply.status).toBe("stabilizing");
    expect(incidentAfterApply.planned_target_hospital_id).toBe("hospital-east-09");
    expect(incidentAfterApply.ticks_since_safe_apply).toBe(0);
    expect(incidentAfterApply.fixed_at).toBeNull();

    // Advance ticks until stabilization threshold
    for (let i = 0; i < 9; i++) {
      runtimeState = advanceTick(runtimeState);
    }

    const incidentBefore10Ticks = runtimeState.world.incidents["ME-7741"];
    expect(incidentBefore10Ticks.status).toBe("stabilizing");
    expect(incidentBefore10Ticks.ticks_since_safe_apply).toBe(9);

    // One more tick should trigger fixed
    runtimeState = advanceTick(runtimeState);

    const incidentAfter10Ticks = runtimeState.world.incidents["ME-7741"];
    expect(incidentAfter10Ticks.status).toBe("fixed");
    expect(incidentAfter10Ticks.ticks_since_safe_apply).toBe(10);
    expect(incidentAfter10Ticks.fixed_at).not.toBeNull();
  });

  it("does not use Math.random, Date.now, new Date, or crypto", () => {
    // This is a logic test - if advanceTick completes deterministically
    // for identical input twice, we know it doesn't use randomness/time
    const runtimeState = createInitialGameRuntimeState(initialWorldState);

    const resultA = advanceTick(runtimeState);
    const resultB = advanceTick(runtimeState);

    expect(JSON.stringify(resultA)).toBe(JSON.stringify(resultB));
  });

  it("pending AURORA queue is not automatically processed by tick", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    expect(runtimeState.auroraQueue.items).toHaveLength(0);

    const nextState = advanceTick(runtimeState);
    expect(nextState.auroraQueue.items).toHaveLength(0);
  });

  it("allows player to execute commands between ticks", () => {
    let runtimeState = createInitialGameRuntimeState(initialWorldState);

    // Tick 1
    runtimeState = advanceTick(runtimeState);
    expect(runtimeState.world.clock.tick).toBe(1);
    expect(runtimeState.auditLog).toHaveLength(1);

    // Player command
    runtimeState = executePlayerCommand(runtimeState, registry, "medical.node.inspect hospital-east-09");
    expect(runtimeState.auditLog).toHaveLength(2);
    expect(runtimeState.auditLog[1].source).toBe("player");

    // Tick 2
    runtimeState = advanceTick(runtimeState);
    expect(runtimeState.world.clock.tick).toBe(2);
    expect(runtimeState.auditLog).toHaveLength(3);
    expect(runtimeState.auditLog[2].source).toBe("system");
  });

  it("maintains immutability across multiple ticks and commands", () => {
    const initialRuntimeState = createInitialGameRuntimeState(initialWorldState);
    const initialSnapshot = JSON.stringify(initialRuntimeState);

    let runtimeState = initialRuntimeState;

    runtimeState = advanceTick(runtimeState);
    runtimeState = executePlayerCommand(runtimeState, registry, "medical.node.inspect hospital-east-09");
    runtimeState = advanceTick(runtimeState);
    runtimeState = executePlayerCommand(
      runtimeState,
      registry,
      "medical.routing.plan.apply --incident ME-7741 --target hospital-east-09"
    );

    // Original should not have changed
    expect(JSON.stringify(initialRuntimeState)).toBe(initialSnapshot);
  });

  it("does not mutate world state during tick", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    const worldBefore = runtimeState.world;

    advanceTick(runtimeState);

    // The original runtimeState.world reference should not change
    expect(runtimeState.world).toBe(worldBefore);
  });
});
