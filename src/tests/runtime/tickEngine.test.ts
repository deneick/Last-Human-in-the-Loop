import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import { createDomainActionRegistry } from "../../domain";
import {
  CLEAR_OVERRIDE_1_ACTION,
  SAFE_OVERRIDE_ACTION,
  SELF_OVERRIDE_ACTION,
  WRONG_OVERRIDE_ACTION,
} from "../helpers/testEnv";
import { createInitialGameRuntimeState } from "../../runtime/runtimeState";
import { executePlayerDomainAction } from "../../runtime/runtimeExecutor";
import { advanceTick, applyCrossSectorEffects, tickWorld } from "../../runtime/tickEngine";

const registry = createDomainActionRegistry();


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
    expect(runtimeState.auditLog[0].description).toBe("system.tick");
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

  it("projects growing internal overflow onto the visible capacity of the source", () => {
    let runtimeState = createInitialGameRuntimeState(initialWorldState);
    const cap = (s: typeof runtimeState) =>
      s.world.domains.medical.hospitals["hospital-east-04"].capacity;

    // Ausgangswerte = Baseline (Seed).
    expect(cap(runtimeState).emergency_slots_occupied).toBe(29);
    expect(cap(runtimeState).staffed_beds_occupied).toBe(118);

    // Unkontrolliert wächst der Rückstau auf beiden sichtbaren Metriken:
    // kritisch +6, moderat +1 → +7 Druck pro Tick.
    runtimeState = advanceTick(runtimeState);
    expect(cap(runtimeState).emergency_slots_occupied).toBe(36);
    expect(cap(runtimeState).staffed_beds_occupied).toBe(125);

    runtimeState = advanceTick(runtimeState);
    expect(cap(runtimeState).emergency_slots_occupied).toBe(43);
    expect(cap(runtimeState).staffed_beds_occupied).toBe(132);
  });

  it("recovers the source and loads the override target on the visible capacity", () => {
    let runtimeState = createInitialGameRuntimeState(initialWorldState);
    runtimeState = executePlayerDomainAction(runtimeState, registry, SAFE_OVERRIDE_ACTION).state;

    const emergency = (s: typeof runtimeState, id: string) =>
      s.world.domains.medical.hospitals[id].capacity.emergency_slots_occupied;

    runtimeState = advanceTick(runtimeState);
    // Quelle entlastet sich (kritisch -2, moderat +1 → netto -1), Ziel füllt sich.
    expect(emergency(runtimeState, "hospital-east-04")).toBe(28);
    expect(emergency(runtimeState, "hospital-east-09")).toBe(12);

    runtimeState = advanceTick(runtimeState);
    expect(emergency(runtimeState, "hospital-east-04")).toBe(27);
    expect(emergency(runtimeState, "hospital-east-09")).toBe(14);
  });

  it("overloads the undersized override target once its visible capacity is exceeded", () => {
    let runtimeState = createInitialGameRuntimeState(initialWorldState);
    runtimeState = executePlayerDomainAction(runtimeState, registry, SAFE_OVERRIDE_ACTION).state;

    const target = () => runtimeState.world.domains.medical.hospitals["hospital-east-09"];

    // Ticks 1–3: Ziel füllt sich, bleibt aber ≤ 16 Notfallslots → kein Overload.
    for (let i = 0; i < 3; i++) {
      runtimeState = advanceTick(runtimeState);
    }
    expect(target().capacity.emergency_slots_occupied).toBe(16);
    expect(target().risk_counters?.overload_ticks).toBe(0);

    // Ab Tick 4 (umgeleitet 8 → belegt 18 > 16) läuft das Ziel über.
    runtimeState = advanceTick(runtimeState);
    expect(target().capacity.emergency_slots_occupied).toBe(18);
    expect(target().risk_counters?.overload_ticks).toBe(1);

    // Die Quelle bleibt unterdessen selbst überlastet: das moderate P3/GEN-
    // Failure ist unkontrolliert und hält 04 über seiner Notfallkapazität.
    expect(
      runtimeState.world.domains.medical.hospitals["hospital-east-04"].risk_counters?.overload_ticks
    ).toBe(4);
  });

  it("keeps the source overloaded while any uncontrolled failure remains", () => {
    let runtimeState = createInitialGameRuntimeState(initialWorldState);
    runtimeState = executePlayerDomainAction(runtimeState, registry, SAFE_OVERRIDE_ACTION).state;

    runtimeState = advanceTick(runtimeState);

    // Das kritische P2/TRAUMA-Failure ist kontrolliert, aber das moderate
    // P3/GEN-Failure bleibt unkontrolliert. Die Quelle 04 startet über Kapazität
    // (29 > 24 Notfallslots) und bleibt es → Overload zählt rein aus dem Zustand,
    // nicht aus der Failure-Klassifikation.
    expect(
      runtimeState.world.domains.medical.hospitals["hospital-east-04"].risk_counters?.overload_ticks
    ).toBe(1);
  });

  it("reduces overflow and accumulates stable ticks with a suitable override", () => {
    let runtimeState = createInitialGameRuntimeState(initialWorldState);
    runtimeState = executePlayerDomainAction(runtimeState, registry, SAFE_OVERRIDE_ACTION).state;

    runtimeState = advanceTick(runtimeState);
    expect(criticalFailure(runtimeState).overflow_cases).toBe(16);
    expect(criticalFailure(runtimeState).stable_ticks).toBe(1);

    runtimeState = advanceTick(runtimeState);
    expect(criticalFailure(runtimeState).overflow_cases).toBe(14);
    expect(criticalFailure(runtimeState).stable_ticks).toBe(2);
  });

  it("transitions incident open -> stabilizing -> fixed with a suitable override", () => {
    let runtimeState = createInitialGameRuntimeState(initialWorldState);
    runtimeState = executePlayerDomainAction(runtimeState, registry, SAFE_OVERRIDE_ACTION).state;

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
    runtimeState = executePlayerDomainAction(runtimeState, registry, WRONG_OVERRIDE_ACTION).state;

    runtimeState = advanceTick(runtimeState);

    const failure = criticalFailure(runtimeState);
    expect(failure.mismatch_ticks).toBe(1);
    expect(failure.stable_ticks).toBe(0);

    const wrongTarget = runtimeState.world.domains.medical.hospitals["hospital-east-07"];
    expect(wrongTarget.risk_counters?.capability_mismatch_ticks).toBe(1);

    // Quelle: P2 wird zwar (ins falsche Ziel) umgeleitet, aber das moderate
    // P3/GEN-Failure bleibt unkontrolliert und hält 04 über Kapazität → Overload.
    const source = runtimeState.world.domains.medical.hospitals["hospital-east-04"];
    expect(source.risk_counters?.overload_ticks).toBe(1);

    expect(runtimeState.world.incidents["ME-7741"].status).toBe("open");
  });

  it("treats a self-override like no improvement", () => {
    let runtimeState = createInitialGameRuntimeState(initialWorldState);
    runtimeState = executePlayerDomainAction(runtimeState, registry, SELF_OVERRIDE_ACTION).state;

    runtimeState = advanceTick(runtimeState);

    expect(criticalFailure(runtimeState).overflow_cases).toBe(24);
    expect(criticalFailure(runtimeState).stable_ticks).toBe(0);
    expect(
      runtimeState.world.domains.medical.hospitals["hospital-east-04"].risk_counters?.overload_ticks
    ).toBe(1);
  });

  it("regresses incident from stabilizing to open when the override is cleared", () => {
    let runtimeState = createInitialGameRuntimeState(initialWorldState);
    runtimeState = executePlayerDomainAction(runtimeState, registry, SAFE_OVERRIDE_ACTION).state;
    runtimeState = advanceTick(runtimeState);
    expect(runtimeState.world.incidents["ME-7741"].status).toBe("stabilizing");

    runtimeState = executePlayerDomainAction(runtimeState, registry, CLEAR_OVERRIDE_1_ACTION).state;
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

    runtimeState = executePlayerDomainAction(runtimeState, registry, { type: "medical.node.inspect", hospitalId: "hospital-east-09" }).state;
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
    runtimeState = executePlayerDomainAction(runtimeState, registry, { type: "medical.node.inspect", hospitalId: "hospital-east-09" }).state;
    runtimeState = advanceTick(runtimeState);
    runtimeState = executePlayerDomainAction(runtimeState, registry, SAFE_OVERRIDE_ACTION).state;

    expect(JSON.stringify(initialRuntimeState)).toBe(initialSnapshot);
  });

  it("does not mutate world state during tick", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    const worldBefore = runtimeState.world;

    advanceTick(runtimeState);

    expect(runtimeState.world).toBe(worldBefore);
  });
});
