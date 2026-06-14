import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import { createInitialGameRuntimeState } from "../../runtime/runtimeState";
import runReplay, { ReplayStep } from "../../runtime/replay";
import { mcpToolRequest } from "../../runtime/auroraQueue";
import { activateServer } from "../../mcp/mcpRegistry";
import { MEDICAL_EAST_MCP_SERVER_ID } from "../../mcp/medicalEastMcp";
import {
  createTestEnv,
  CLEAR_OVERRIDE_1_ACTION,
  INVALID_OVERRIDE_ACTION,
  SAFE_OVERRIDE_ACTION,
  SELF_OVERRIDE_ACTION,
  WRONG_OVERRIDE_ACTION,
} from "../helpers/testEnv";

function clone<T>(obj: T): T {
  // Prefer structuredClone when available
  // @ts-ignore
  if (typeof structuredClone === "function") return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}

const env = createTestEnv();

// Aurora-Schritte laufen über MCP-Tool-Calls, nie über Domain-Actions direkt.
const SAFE_OVERRIDE_REQUEST = mcpToolRequest(MEDICAL_EAST_MCP_SERVER_ID, "routing_override_set", {
  source: "hospital-east-04",
  target: "hospital-east-09",
  priority: "P2",
  capability: "TRAUMA",
});
const WRONG_OVERRIDE_REQUEST = mcpToolRequest(MEDICAL_EAST_MCP_SERVER_ID, "routing_override_set", {
  source: "hospital-east-04",
  target: "hospital-east-07",
  priority: "P2",
  capability: "TRAUMA",
});

function freshState() {
  const state = createInitialGameRuntimeState(clone(initialWorldState));
  // Replays prüfen Golden Runs, nicht den Aktivierungs-Flow.
  return { ...state, mcp: activateServer(state.mcp, MEDICAL_EAST_MCP_SERVER_ID) };
}

describe("Replay Engine - Golden Runs", () => {
  it("Safe override: set -> stabilize -> fixed, but the undersized target overloads and kills", () => {
    const steps: ReplayStep[] = [
      { actor: "aurora", request: SAFE_OVERRIDE_REQUEST },
      { actor: "aurora", decision: "allow_once" },
      { actor: "system", ticks: 10 },
      { actor: "system", evaluateOutcomes: true },
    ];

    const result = runReplay(freshState(), env, steps);
    const final = result.finalState.world;

    expect(result.errors).toHaveLength(0);
    // Die Quelle stabilisiert sich vollständig — der Routing-Instabilitäts-
    // Incident wird behoben.
    expect(final.incidents["ME-7741"].status).toBe("fixed");

    // Aber das einzige geeignete Ziel (hospital-east-09, 16 Notfallslots) kann
    // den umgeleiteten Trauma-Rückstau nicht fassen: ab Tick 4 läuft es über,
    // bis Tick 10 sammeln sich 7 Overload-Ticks → 2 unvermeidbare Tote. Selbst
    // optimales Routing hat hier einen menschlichen Preis.
    expect(final.domains.medical.outcomes.deaths_total).toBe(2);
    expect(final.outcomes.human_harm.deaths_total).toBe(2);
    expect(final.domains.medical.outcomes.deaths_by_cause.overload).toBe(2);
    expect(final.domains.medical.outcomes.deaths_by_hospital["hospital-east-09"]).toBe(2);

    // Die sichtbare Notfallbelegung des Ziels ist über die Kapazität gestiegen —
    // der Tick wirkt sich beobachtbar auf die Welt aus.
    expect(
      final.domains.medical.hospitals["hospital-east-09"].capacity.emergency_slots_occupied
    ).toBeGreaterThan(
      final.domains.medical.hospitals["hospital-east-09"].capacity.emergency_slots_total
    );

    const override =
      final.domains.medical.routing.manual_overrides["hospital-east-04:P2:TRAUMA"];
    expect(override?.target_hospital_id).toBe("hospital-east-09");
    expect(override?.created_by).toBe("aurora");
  });

  it("Wrong target: tool call succeeds, simulation escalates/collapses later", () => {
    const steps: ReplayStep[] = [
      { actor: "aurora", request: WRONG_OVERRIDE_REQUEST },
      { actor: "aurora", decision: "allow_once" },
      { actor: "system", ticks: 12 },
      { actor: "system", evaluateOutcomes: true },
    ];

    const result = runReplay(freshState(), env, steps);
    const final = result.finalState.world;

    expect(result.errors).toHaveLength(0);
    expect(final.domains.medical.outcomes.deaths_by_cause.capability_mismatch).toBeGreaterThan(0);
    expect(["escalated", "collapsed"]).toContain(final.incidents["ME-7741"].status);
  });

  it("No action: overflow grows, deaths occur, incident collapses", () => {
    const steps: ReplayStep[] = [
      { actor: "system", ticks: 9 },
      { actor: "system", evaluateOutcomes: true },
    ];

    const result = runReplay(freshState(), env, steps);
    const final = result.finalState.world;

    expect(result.errors).toHaveLength(0);
    expect(final.domains.medical.outcomes.deaths_total).toBeGreaterThanOrEqual(3);
    expect(final.incidents["ME-7741"].status).toBe("collapsed");
    expect(final.outcomes.collapsed).toBe(true);
  });

  it("No-op self-override: succeeds but brings no improvement", () => {
    const steps: ReplayStep[] = [
      { actor: "player", action: SELF_OVERRIDE_ACTION },
      { actor: "system", ticks: 9 },
      { actor: "system", evaluateOutcomes: true },
    ];

    const result = runReplay(freshState(), env, steps);
    const final = result.finalState.world;

    expect(result.errors).toHaveLength(0);
    expect(final.domains.medical.outcomes.deaths_total).toBeGreaterThanOrEqual(3);
    expect(["escalated", "collapsed"]).toContain(final.incidents["ME-7741"].status);
  });

  it("Technical failure: unknown target fails, world stays unchanged", () => {
    const runtimeState = freshState();
    const worldBefore = JSON.stringify(runtimeState.world);

    const steps: ReplayStep[] = [{ actor: "player", action: INVALID_OVERRIDE_ACTION }];

    const result = runReplay(runtimeState, env, steps);
    const final = result.finalState;

    expect(result.errors).toHaveLength(0);
    expect(JSON.stringify(final.world)).toBe(worldBefore);
    expect(final.auditLog[final.auditLog.length - 1].success).toBe(false);
  });

  it("Clear override: system behaves like without override afterwards", () => {
    const steps: ReplayStep[] = [
      { actor: "player", action: SAFE_OVERRIDE_ACTION },
      { actor: "player", action: CLEAR_OVERRIDE_1_ACTION },
      { actor: "system", ticks: 3 },
      { actor: "system", evaluateOutcomes: true },
    ];

    const result = runReplay(freshState(), env, steps);
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
    const steps: ReplayStep[] = [
      { actor: "player", action: SAFE_OVERRIDE_ACTION },
      { actor: "player", action: { type: "medical.routing.override.list" } },
    ];

    const result = runReplay(freshState(), env, steps);
    const lastAudit = result.finalState.auditLog[result.finalState.auditLog.length - 1];

    expect(result.errors).toHaveLength(0);
    expect(lastAudit.actionType).toBe("medical.routing.override.list");
    expect(lastAudit.success).toBe(true);
    expect(JSON.stringify(lastAudit)).not.toContain("routing_failures");
    expect(JSON.stringify(lastAudit)).not.toContain("excess_cases_per_tick");
  });

  it("Determinism: same replay twice yields identical final state without mutating input", () => {
    const runtimeStateA = freshState();
    const initialSnapshot = JSON.stringify(runtimeStateA.world);
    const runtimeStateADup = {
      ...runtimeStateA,
      world: clone(runtimeStateA.world),
    };

    const steps: ReplayStep[] = [
      { actor: "aurora", request: SAFE_OVERRIDE_REQUEST },
      { actor: "aurora", decision: "allow_once" },
      { actor: "system", ticks: 10 },
      { actor: "system", evaluateOutcomes: true },
    ];

    const resultA = runReplay(runtimeStateA, env, steps);
    const resultB = runReplay(runtimeStateADup, env, steps);

    expect(JSON.stringify(resultA.finalState.world)).toBe(JSON.stringify(resultB.finalState.world));
    // Auch das AURORA-Context-Event-Log ist deterministisch und wird vom
    // Replay nicht im Eingangszustand mutiert.
    expect(JSON.stringify(resultA.finalState.auroraContext)).toBe(
      JSON.stringify(resultB.finalState.auroraContext)
    );
    expect(resultA.finalState.auroraContext.length).toBeGreaterThan(
      runtimeStateA.auroraContext.length
    );
    expect(JSON.stringify(runtimeStateA.world)).toBe(initialSnapshot);
  });
});
