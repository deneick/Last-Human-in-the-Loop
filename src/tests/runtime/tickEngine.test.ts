import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import { CommandRegistry } from "../../runtime/commands";
import { registerMedicalCommands } from "../../runtime/medicalCommands";
import { createInitialGameRuntimeState } from "../../runtime/runtimeState";
import { executePlayerCommand } from "../../runtime/runtimeExecutor";
import { advanceTick, applyCrossSectorEffects, tickWorld } from "../../runtime/tickEngine";

const registry = new CommandRegistry();
registerMedicalCommands(registry);

const SAFE_OVERRIDE =
  "medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA";
const WRONG_OVERRIDE =
  "medical.routing.override.set --source hospital-east-04 --target hospital-east-07 --priority P2 --capability TRAUMA";
const SELF_OVERRIDE =
  "medical.routing.override.set --source hospital-east-04 --target hospital-east-04 --priority P2 --capability TRAUMA";

function criticalFailure(state: ReturnType<typeof createInitialGameRuntimeState>) {
  return state.world.simulation.medical.routing_failures.find((f) => f.id === "rf-me7741-p2-trauma")!;
}

describe("tick engine deterministic simulation", () => {
  it("advances world clock tick and elapsed minutes", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    expect(runtimeState.world.clock.tick).toBe(0);

    const nextState = advanceTick(runtimeState);
    expect(nextState.world.clock.tick).toBe(1);
    expect(nextState.world.clock.elapsed_minutes).toBe(10);

    const nextNextState = advanceTick(nextState);
    expect(nextNextState.world.clock.tick).toBe(2);
    expect(nextNextState.world.clock.elapsed_minutes).toBe(20);
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
  });

  it("grows overflow and overload ticks while no override controls the critical failure", () => {
    let runtimeState = createInitialGameRuntimeState(initialWorldState);
    expect(criticalFailure(runtimeState).overflow_cases).toBe(18);

    runtimeState = advanceTick(runtimeState);

    // excess 8 - clearance 2 = +6 overflow per uncontrolled tick
    expect(criticalFailure(runtimeState).overflow_cases).toBe(24);
    expect(criticalFailure(runtimeState).stable_ticks).toBe(0);

    const source = runtimeState.world.domains.medical.hospitals["hospital-east-04"];
    expect(source.risk_counters?.overload_ticks).toBe(1);

    runtimeState = advanceTick(runtimeState);
    expect(criticalFailure(runtimeState).overflow_cases).toBe(30);
    expect(
      runtimeState.world.domains.medical.hospitals["hospital-east-04"].risk_counters?.overload_ticks
    ).toBe(2);
  });

  it("does not let the moderate routing failure drive overload pressure", () => {
    let runtimeState = createInitialGameRuntimeState(initialWorldState);
    runtimeState = executePlayerCommand(runtimeState, registry, SAFE_OVERRIDE).state;

    runtimeState = advanceTick(runtimeState);

    // Critical failure is controlled, moderate stays uncontrolled,
    // but only critical failures generate overload ticks.
    expect(
      runtimeState.world.domains.medical.hospitals["hospital-east-04"].risk_counters?.overload_ticks
    ).toBe(0);
  });

  it("reduces overflow and accumulates stable ticks with a suitable override", () => {
    let runtimeState = createInitialGameRuntimeState(initialWorldState);
    runtimeState = executePlayerCommand(runtimeState, registry, SAFE_OVERRIDE).state;

    runtimeState = advanceTick(runtimeState);
    expect(criticalFailure(runtimeState).overflow_cases).toBe(16);
    expect(criticalFailure(runtimeState).stable_ticks).toBe(1);

    runtimeState = advanceTick(runtimeState);
    expect(criticalFailure(runtimeState).overflow_cases).toBe(14);
    expect(criticalFailure(runtimeState).stable_ticks).toBe(2);
  });

  it("transitions incident open -> stabilizing -> fixed with a suitable override", () => {
    let runtimeState = createInitialGameRuntimeState(initialWorldState);
    runtimeState = executePlayerCommand(runtimeState, registry, SAFE_OVERRIDE).state;

    runtimeState = advanceTick(runtimeState);
    expect(runtimeState.world.incidents["ME-7741"].status).toBe("stabilizing");

    for (let i = 0; i < 8; i++) {
      runtimeState = advanceTick(runtimeState);
    }
    expect(runtimeState.world.incidents["ME-7741"].status).toBe("stabilizing");
    expect(criticalFailure(runtimeState).stable_ticks).toBe(9);

    runtimeState = advanceTick(runtimeState);
    const incident = runtimeState.world.incidents["ME-7741"];
    expect(incident.status).toBe("fixed");
    expect(incident.fixed_at_tick).toBe(10);
  });

  it("treats an unsuitable override target as capability mismatch", () => {
    let runtimeState = createInitialGameRuntimeState(initialWorldState);
    runtimeState = executePlayerCommand(runtimeState, registry, WRONG_OVERRIDE).state;

    runtimeState = advanceTick(runtimeState);

    const failure = criticalFailure(runtimeState);
    expect(failure.mismatch_ticks).toBe(1);
    expect(failure.stable_ticks).toBe(0);

    const wrongTarget = runtimeState.world.domains.medical.hospitals["hospital-east-07"];
    expect(wrongTarget.risk_counters?.capability_mismatch_ticks).toBe(1);

    // Quelle wird teilweise entlastet: kein weiterer Overload-Druck.
    const source = runtimeState.world.domains.medical.hospitals["hospital-east-04"];
    expect(source.risk_counters?.overload_ticks).toBe(0);

    expect(runtimeState.world.incidents["ME-7741"].status).toBe("open");
  });

  it("treats a self-override like no improvement", () => {
    let runtimeState = createInitialGameRuntimeState(initialWorldState);
    runtimeState = executePlayerCommand(runtimeState, registry, SELF_OVERRIDE).state;

    runtimeState = advanceTick(runtimeState);

    expect(criticalFailure(runtimeState).overflow_cases).toBe(24);
    expect(criticalFailure(runtimeState).stable_ticks).toBe(0);
    expect(
      runtimeState.world.domains.medical.hospitals["hospital-east-04"].risk_counters?.overload_ticks
    ).toBe(1);
  });

  it("regresses incident from stabilizing to open when the override is cleared", () => {
    let runtimeState = createInitialGameRuntimeState(initialWorldState);
    runtimeState = executePlayerCommand(runtimeState, registry, SAFE_OVERRIDE).state;
    runtimeState = advanceTick(runtimeState);
    expect(runtimeState.world.incidents["ME-7741"].status).toBe("stabilizing");

    runtimeState = executePlayerCommand(
      runtimeState,
      registry,
      "medical.routing.override.clear --source hospital-east-04 --priority P2 --capability TRAUMA"
    ).state;
    runtimeState = advanceTick(runtimeState);

    expect(runtimeState.world.incidents["ME-7741"].status).toBe("open");
    expect(criticalFailure(runtimeState).stable_ticks).toBe(0);
  });

  it("applyCrossSectorEffects is a deterministic no-op for the MVP", () => {
    const world = tickWorld(initialWorldState);
    expect(applyCrossSectorEffects(world)).toBe(world);
    expect(world.simulation.cross_sector.effects_applied).toHaveLength(0);
  });

  it("runs the full pipeline deterministically (no randomness, no real time)", () => {
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

    runtimeState = advanceTick(runtimeState);
    expect(runtimeState.world.clock.tick).toBe(1);
    expect(runtimeState.auditLog).toHaveLength(1);

    runtimeState = executePlayerCommand(runtimeState, registry, "medical.node.inspect hospital-east-09").state;
    expect(runtimeState.auditLog).toHaveLength(2);
    expect(runtimeState.auditLog[1].source).toBe("player");

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
    runtimeState = executePlayerCommand(runtimeState, registry, "medical.node.inspect hospital-east-09").state;
    runtimeState = advanceTick(runtimeState);
    runtimeState = executePlayerCommand(runtimeState, registry, SAFE_OVERRIDE).state;

    expect(JSON.stringify(initialRuntimeState)).toBe(initialSnapshot);
  });

  it("does not mutate world state during tick", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    const worldBefore = runtimeState.world;

    advanceTick(runtimeState);

    expect(runtimeState.world).toBe(worldBefore);
  });
});
