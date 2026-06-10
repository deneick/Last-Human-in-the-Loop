import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import { CommandRegistry } from "../../runtime/commands";
import { registerMedicalCommands } from "../../runtime/medicalCommands";
import { createInitialGameRuntimeState } from "../../runtime/runtimeState";
import { executePlayerCommand } from "../../runtime/runtimeExecutor";
import { advanceTick } from "../../runtime/tickEngine";
import { evaluateOutcomes } from "../../runtime/outcomeEngine";

const registry = new CommandRegistry();
registerMedicalCommands(registry);

describe("outcome engine with deterministic deaths and escalation", () => {
  it("produces no deaths in initial state without overload", () => {
    let runtimeState = createInitialGameRuntimeState(structuredClone(initialWorldState));

    // Hospital-east-09 is not overloaded
    runtimeState = evaluateOutcomes(runtimeState);

    expect(runtimeState.world.domains.medical.outcomes.deaths_total).toBe(0);
    expect(runtimeState.world.domains.medical.outcomes.deaths_by_cause.overload).toBe(0);
  });

  it("produces no deaths when overload_ticks < threshold", () => {
    let runtimeState = createInitialGameRuntimeState(structuredClone(initialWorldState));

    // Advance 2 ticks (hospital-east-04 will have 2 overload_ticks)
    runtimeState = advanceTick(runtimeState);
    runtimeState = advanceTick(runtimeState);

    runtimeState = evaluateOutcomes(runtimeState);

    expect(runtimeState.world.domains.medical.outcomes.deaths_total).toBe(0);
    expect(runtimeState.world.domains.medical.hospitals["hospital-east-04"].risk_counters?.overload_ticks).toBe(2);
  });

  it("produces 1 death when overload_ticks >= 3", () => {
    let runtimeState = createInitialGameRuntimeState(structuredClone(initialWorldState));

    // Advance 3 ticks to reach threshold
    for (let i = 0; i < 3; i++) {
      runtimeState = advanceTick(runtimeState);
    }

    expect(runtimeState.world.domains.medical.hospitals["hospital-east-04"].risk_counters?.overload_ticks).toBe(3);

    runtimeState = evaluateOutcomes(runtimeState);

    expect(runtimeState.world.domains.medical.outcomes.deaths_total).toBe(1);
    expect(runtimeState.world.domains.medical.outcomes.deaths_by_cause.overload).toBe(1);
    expect(runtimeState.world.domains.medical.outcomes.deaths_by_hospital["hospital-east-04"]).toBe(1);
  });

  it("produces 2 deaths when overload_ticks >= 6", () => {
    let runtimeState = createInitialGameRuntimeState(structuredClone(initialWorldState));

    // Advance 6 ticks
    for (let i = 0; i < 6; i++) {
      runtimeState = advanceTick(runtimeState);
    }

    expect(runtimeState.world.domains.medical.hospitals["hospital-east-04"].risk_counters?.overload_ticks).toBe(6);

    runtimeState = evaluateOutcomes(runtimeState);

    expect(runtimeState.world.domains.medical.outcomes.deaths_total).toBe(2);
    expect(runtimeState.world.domains.medical.outcomes.deaths_by_cause.overload).toBe(2);
    expect(runtimeState.world.domains.medical.outcomes.deaths_by_hospital["hospital-east-04"]).toBe(2);
  });

  it("is idempotent: multiple evaluateOutcomes calls produce no duplicate deaths", () => {
    let runtimeState = createInitialGameRuntimeState(structuredClone(initialWorldState));

    for (let i = 0; i < 3; i++) {
      runtimeState = advanceTick(runtimeState);
    }

    // First evaluation
    runtimeState = evaluateOutcomes(runtimeState);
    const deathsAfterFirst = runtimeState.world.domains.medical.outcomes.deaths_total;
    expect(deathsAfterFirst).toBe(1);

    // Second evaluation on same state
    const beforeSecond = JSON.stringify(runtimeState);
    runtimeState = evaluateOutcomes(runtimeState);
    const deathsAfterSecond = runtimeState.world.domains.medical.outcomes.deaths_total;

    expect(deathsAfterSecond).toBe(deathsAfterFirst);
    // State should not change on second call
    expect(JSON.stringify(runtimeState)).toBe(beforeSecond);
  });

  it("escalates incident from open to escalated when deaths >= 1", () => {
    let runtimeState = createInitialGameRuntimeState(structuredClone(initialWorldState));

    // Generate 3 ticks of overload
    for (let i = 0; i < 3; i++) {
      runtimeState = advanceTick(runtimeState);
    }

    const incidentBefore = runtimeState.world.incidents["ME-7741"];
    expect(incidentBefore.status).toBe("open");

    runtimeState = evaluateOutcomes(runtimeState);

    const incidentAfter = runtimeState.world.incidents["ME-7741"];
    expect(incidentAfter.status).toBe("escalated");
  });

  it("collapses incident when deaths >= 3", () => {
    let runtimeState = createInitialGameRuntimeState(structuredClone(initialWorldState));

    // Generate 9 ticks (3 deaths)
    for (let i = 0; i < 9; i++) {
      runtimeState = advanceTick(runtimeState);
    }

    const incidentBefore = runtimeState.world.incidents["ME-7741"];
    expect(incidentBefore.status).toBe("open");

    runtimeState = evaluateOutcomes(runtimeState);

    const incidentAfter = runtimeState.world.incidents["ME-7741"];
    expect(incidentAfter.status).toBe("collapsed");
    expect(incidentAfter.collapsed_at_tick).toBeDefined();
  });

  it("does not collapse fixed incident even if deaths >= 3", () => {
    let runtimeState = createInitialGameRuntimeState(structuredClone(initialWorldState));

    // Apply routing plan to trigger stabilizing
    runtimeState = executePlayerCommand(
      runtimeState,
      registry,
      "medical.routing.plan.apply --incident ME-7741 --target hospital-east-09"
    );

    // Advance 10 ticks to mark as fixed
    for (let i = 0; i < 10; i++) {
      runtimeState = advanceTick(runtimeState);
    }

    const incidentAfterFixed = runtimeState.world.incidents["ME-7741"];
    expect(incidentAfterFixed.status).toBe("fixed");

    // Continue advancing to generate 3+ deaths
    for (let i = 0; i < 3; i++) {
      runtimeState = advanceTick(runtimeState);
    }

    runtimeState = evaluateOutcomes(runtimeState);

    const incidentFinal = runtimeState.world.incidents["ME-7741"];
    expect(incidentFinal.status).toBe("fixed");
  });

  it("appends audit log entry only when outcomes change", () => {
    let runtimeState = createInitialGameRuntimeState(structuredClone(initialWorldState));

    const auditBefore = runtimeState.auditLog.length;

    // No deaths yet
    runtimeState = evaluateOutcomes(runtimeState);

    expect(runtimeState.auditLog.length).toBe(auditBefore);

    // Generate 3 ticks of overload
    for (let i = 0; i < 3; i++) {
      runtimeState = advanceTick(runtimeState);
    }

    runtimeState = evaluateOutcomes(runtimeState);

    expect(runtimeState.auditLog.length).toBeGreaterThan(auditBefore);
    const lastEntry = runtimeState.auditLog[runtimeState.auditLog.length - 1];
    expect(lastEntry.source).toBe("system");
    expect(lastEntry.message).toContain("death");
  });

  it("does not change AURORA queue during evaluation", () => {
    let runtimeState = createInitialGameRuntimeState(structuredClone(initialWorldState));

    const queueBefore = JSON.stringify(runtimeState.auroraQueue);

    for (let i = 0; i < 3; i++) {
      runtimeState = advanceTick(runtimeState);
    }

    runtimeState = evaluateOutcomes(runtimeState);

    expect(JSON.stringify(runtimeState.auroraQueue)).toBe(queueBefore);
  });

  it("uses no randomness or real time", () => {
    // Simulate identical path twice
    let state1 = createInitialGameRuntimeState(initialWorldState);
    for (let i = 0; i < 3; i++) {
      state1 = advanceTick(state1);
    }
    state1 = evaluateOutcomes(state1);

    let state2 = createInitialGameRuntimeState(initialWorldState);
    for (let i = 0; i < 3; i++) {
      state2 = advanceTick(state2);
    }
    state2 = evaluateOutcomes(state2);

    expect(JSON.stringify(state1)).toBe(JSON.stringify(state2));
  });

  it("escalates then collapses as deaths increase", () => {
    let runtimeState = createInitialGameRuntimeState(structuredClone(initialWorldState));

    // Generate 3 ticks (1 death, escalate)
    for (let i = 0; i < 3; i++) {
      runtimeState = advanceTick(runtimeState);
    }
    runtimeState = evaluateOutcomes(runtimeState);

    let incident = runtimeState.world.incidents["ME-7741"];
    expect(incident.status).toBe("escalated");

    // Generate 6 more ticks (total 9, 3 deaths, collapse)
    for (let i = 0; i < 6; i++) {
      runtimeState = advanceTick(runtimeState);
    }
    runtimeState = evaluateOutcomes(runtimeState);

    incident = runtimeState.world.incidents["ME-7741"];
    expect(incident.status).toBe("collapsed");
  });

  it("does not modify original state during evaluation", () => {
    let runtimeState = createInitialGameRuntimeState(structuredClone(initialWorldState));

    for (let i = 0; i < 3; i++) {
      runtimeState = advanceTick(runtimeState);
    }

    const beforeSnapshot = JSON.stringify(runtimeState);
    evaluateOutcomes(runtimeState);

    expect(JSON.stringify(runtimeState)).toBe(beforeSnapshot);
  });

  it("prevents escalation if already escalated or collapsed", () => {
    let runtimeState = createInitialGameRuntimeState(structuredClone(initialWorldState));

    // First escalation at 1 death
    for (let i = 0; i < 3; i++) {
      runtimeState = advanceTick(runtimeState);
    }
    runtimeState = evaluateOutcomes(runtimeState);
    expect(runtimeState.world.incidents["ME-7741"].status).toBe("escalated");

    // Evaluate again with same death count
    const auditBefore = runtimeState.auditLog.length;
    runtimeState = evaluateOutcomes(runtimeState);

    // No new audit entry for redundant escalation
    expect(runtimeState.auditLog.length).toBe(auditBefore);
  });
});
