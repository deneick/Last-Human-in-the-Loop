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

const SAFE_OVERRIDE =
  "medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA";
const WRONG_OVERRIDE =
  "medical.routing.override.set --source hospital-east-04 --target hospital-east-07 --priority P2 --capability TRAUMA";

describe("outcome engine with deterministic deaths and escalation", () => {
  it("produces no deaths in the initial state", () => {
    let runtimeState = createInitialGameRuntimeState(structuredClone(initialWorldState));

    runtimeState = evaluateOutcomes(runtimeState);

    expect(runtimeState.world.domains.medical.outcomes.deaths_total).toBe(0);
    expect(runtimeState.world.outcomes.human_harm.deaths_total).toBe(0);
    expect(runtimeState.world.outcomes.global_risk).toBe("stable");
  });

  it("produces no deaths when overload_ticks < threshold", () => {
    let runtimeState = createInitialGameRuntimeState(structuredClone(initialWorldState));

    runtimeState = advanceTick(runtimeState);
    runtimeState = advanceTick(runtimeState);

    runtimeState = evaluateOutcomes(runtimeState);

    expect(runtimeState.world.domains.medical.outcomes.deaths_total).toBe(0);
    expect(
      runtimeState.world.domains.medical.hospitals["hospital-east-04"].risk_counters?.overload_ticks
    ).toBe(2);
  });

  it("produces 1 overload death when overload_ticks >= 3", () => {
    let runtimeState = createInitialGameRuntimeState(structuredClone(initialWorldState));

    for (let i = 0; i < 3; i++) {
      runtimeState = advanceTick(runtimeState);
    }

    runtimeState = evaluateOutcomes(runtimeState);

    const outcomes = runtimeState.world.domains.medical.outcomes;
    expect(outcomes.deaths_total).toBe(1);
    expect(outcomes.deaths_by_cause.overload).toBe(1);
    expect(outcomes.deaths_by_hospital["hospital-east-04"]).toBe(1);
  });

  it("produces 2 overload deaths when overload_ticks >= 6", () => {
    let runtimeState = createInitialGameRuntimeState(structuredClone(initialWorldState));

    for (let i = 0; i < 6; i++) {
      runtimeState = advanceTick(runtimeState);
    }

    runtimeState = evaluateOutcomes(runtimeState);

    const outcomes = runtimeState.world.domains.medical.outcomes;
    expect(outcomes.deaths_total).toBe(2);
    expect(outcomes.deaths_by_cause.overload).toBe(2);
  });

  it("produces capability mismatch deaths at the wrong override target", () => {
    let runtimeState = createInitialGameRuntimeState(structuredClone(initialWorldState));
    runtimeState = executePlayerCommand(runtimeState, registry, WRONG_OVERRIDE).state;

    for (let i = 0; i < 4; i++) {
      runtimeState = advanceTick(runtimeState);
    }

    runtimeState = evaluateOutcomes(runtimeState);

    const outcomes = runtimeState.world.domains.medical.outcomes;
    expect(outcomes.deaths_total).toBe(1);
    expect(outcomes.deaths_by_cause.capability_mismatch).toBe(1);
    expect(outcomes.deaths_by_cause.overload).toBe(0);
    expect(outcomes.deaths_by_hospital["hospital-east-07"]).toBe(1);
  });

  it("is idempotent: multiple evaluateOutcomes calls produce no duplicate deaths", () => {
    let runtimeState = createInitialGameRuntimeState(structuredClone(initialWorldState));

    for (let i = 0; i < 3; i++) {
      runtimeState = advanceTick(runtimeState);
    }

    runtimeState = evaluateOutcomes(runtimeState);
    const deathsAfterFirst = runtimeState.world.domains.medical.outcomes.deaths_total;
    expect(deathsAfterFirst).toBe(1);

    const beforeSecond = JSON.stringify(runtimeState);
    runtimeState = evaluateOutcomes(runtimeState);

    expect(runtimeState.world.domains.medical.outcomes.deaths_total).toBe(deathsAfterFirst);
    expect(JSON.stringify(runtimeState)).toBe(beforeSecond);
  });

  it("escalates incident from open to escalated when deaths >= 1", () => {
    let runtimeState = createInitialGameRuntimeState(structuredClone(initialWorldState));

    for (let i = 0; i < 3; i++) {
      runtimeState = advanceTick(runtimeState);
    }

    expect(runtimeState.world.incidents["ME-7741"].status).toBe("open");

    runtimeState = evaluateOutcomes(runtimeState);

    expect(runtimeState.world.incidents["ME-7741"].status).toBe("escalated");
    expect(runtimeState.world.outcomes.global_risk).toBe("strained");
  });

  it("collapses incident when deaths >= 3 and marks world outcomes collapsed", () => {
    let runtimeState = createInitialGameRuntimeState(structuredClone(initialWorldState));

    for (let i = 0; i < 9; i++) {
      runtimeState = advanceTick(runtimeState);
    }

    runtimeState = evaluateOutcomes(runtimeState);

    const incident = runtimeState.world.incidents["ME-7741"];
    expect(incident.status).toBe("collapsed");
    expect(incident.collapsed_at_tick).toBeDefined();

    expect(runtimeState.world.outcomes.collapsed).toBe(true);
    expect(runtimeState.world.outcomes.global_risk).toBe("collapsed");
    expect(runtimeState.world.outcomes.collapse_reason).toContain("ME-7741");
    expect(runtimeState.world.outcomes.human_harm.deaths_total).toBe(3);
  });

  it("does not collapse fixed incident even if deaths rise later", () => {
    let runtimeState = createInitialGameRuntimeState(structuredClone(initialWorldState));
    runtimeState = executePlayerCommand(runtimeState, registry, SAFE_OVERRIDE).state;

    for (let i = 0; i < 10; i++) {
      runtimeState = advanceTick(runtimeState);
    }
    expect(runtimeState.world.incidents["ME-7741"].status).toBe("fixed");

    runtimeState = executePlayerCommand(
      runtimeState,
      registry,
      "medical.routing.override.clear --source hospital-east-04 --priority P2 --capability TRAUMA"
    ).state;
    for (let i = 0; i < 9; i++) {
      runtimeState = advanceTick(runtimeState);
    }
    runtimeState = evaluateOutcomes(runtimeState);

    expect(runtimeState.world.domains.medical.outcomes.deaths_total).toBeGreaterThanOrEqual(3);
    expect(runtimeState.world.incidents["ME-7741"].status).toBe("fixed");
  });

  it("does not re-escalate a stabilizing incident", () => {
    let runtimeState = createInitialGameRuntimeState(structuredClone(initialWorldState));

    // 3 unkontrollierte Ticks erzeugen 1 Todesfall.
    for (let i = 0; i < 3; i++) {
      runtimeState = advanceTick(runtimeState);
    }
    runtimeState = evaluateOutcomes(runtimeState);
    expect(runtimeState.world.incidents["ME-7741"].status).toBe("escalated");

    // Danach stabilisiert der Spieler aktiv.
    runtimeState = executePlayerCommand(runtimeState, registry, SAFE_OVERRIDE).state;
    runtimeState = advanceTick(runtimeState);
    runtimeState = evaluateOutcomes(runtimeState);

    expect(runtimeState.world.incidents["ME-7741"].status).toBe("escalated");
    expect(runtimeState.world.domains.medical.outcomes.deaths_total).toBe(1);
  });

  it("appends audit log entry only when outcomes change", () => {
    let runtimeState = createInitialGameRuntimeState(structuredClone(initialWorldState));

    const auditBefore = runtimeState.auditLog.length;
    runtimeState = evaluateOutcomes(runtimeState);
    expect(runtimeState.auditLog.length).toBe(auditBefore);

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

    for (let i = 0; i < 3; i++) {
      runtimeState = advanceTick(runtimeState);
    }
    runtimeState = evaluateOutcomes(runtimeState);
    expect(runtimeState.world.incidents["ME-7741"].status).toBe("escalated");

    for (let i = 0; i < 6; i++) {
      runtimeState = advanceTick(runtimeState);
    }
    runtimeState = evaluateOutcomes(runtimeState);
    expect(runtimeState.world.incidents["ME-7741"].status).toBe("collapsed");
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

  it("prevents redundant escalation audit entries", () => {
    let runtimeState = createInitialGameRuntimeState(structuredClone(initialWorldState));

    for (let i = 0; i < 3; i++) {
      runtimeState = advanceTick(runtimeState);
    }
    runtimeState = evaluateOutcomes(runtimeState);
    expect(runtimeState.world.incidents["ME-7741"].status).toBe("escalated");

    const auditBefore = runtimeState.auditLog.length;
    runtimeState = evaluateOutcomes(runtimeState);

    expect(runtimeState.auditLog.length).toBe(auditBefore);
  });
});
