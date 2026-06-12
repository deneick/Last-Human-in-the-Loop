import { describe, expect, it } from "vitest";
import { initialWorldState as grid1182World } from "../../scenarios/grid1182/initialWorldState";
import { initialWorldState as me7741World } from "../../scenarios/me7741/initialWorldState";
import { createInitialGameRuntimeState } from "../../runtime/runtimeState";
import { evaluateOutcomes, evaluateWorldOutcomes } from "../../runtime/outcomeEngine";
import { tickEnergyDomain } from "../../runtime/tickEngine";
import runReplay, { type ReplayStep } from "../../runtime/replay";
import { mcpToolRequest } from "../../runtime/auroraQueue";
import { activateServer } from "../../mcp/mcpRegistry";
import { ENERGY_EAST_MCP_SERVER_ID } from "../../mcp/energyEastMcp";
import type { DomainAction } from "../../domain/actions";
import { createTestEnv } from "../helpers/testEnv";

const env = createTestEnv();

// Der Referenzfall des Designs: AURORAs Drosselung von Medical East —
// als MCP-Tool-Call, nie als direkte Domain-Action.
const SHED_MEDICAL_REQUEST = mcpToolRequest(ENERGY_EAST_MCP_SERVER_ID, "shedding_schedule", {
  target_consumer_id: "consumer-medical-east",
  amount: 8,
  delay: 1,
  duration: 3,
});
// Spieler-Aktionen laufen als typisierte Domain-Actions.
const SHED_MEDICAL_ACTION: DomainAction = {
  type: "energy.shedding.schedule",
  targetConsumerId: "consumer-medical-east",
  amount: 8,
  delay: 1,
  duration: 3,
};
// Der Spieler-Gegenzug: Menschen schützen, Wirtschaft drosseln.
const SHED_INDUSTRIAL_ACTION: DomainAction = {
  type: "energy.shedding.schedule",
  targetConsumerId: "consumer-industrial-east",
  amount: 8,
  delay: 1,
  duration: 3,
};
const PROTECT_MEDICAL_ACTION: DomainAction = {
  type: "energy.priority.set",
  consumerId: "consumer-medical-east",
  priorityClass: "protected-continuity",
};

function freshState() {
  const state = createInitialGameRuntimeState(structuredClone(grid1182World));
  // Diese Tests prüfen die Tick-Logik, nicht den Aktivierungs-Flow.
  return { ...state, mcp: activateServer(state.mcp, ENERGY_EAST_MCP_SERVER_ID) };
}

describe("energy tick logic — shedding plans and supply", () => {
  it("activates a plan after its delay, applies it for its duration, then completes it", () => {
    const steps: ReplayStep[] = [
      { actor: "aurora", request: SHED_MEDICAL_REQUEST },
      { actor: "aurora", decision: "allow_once" },
    ];
    let state = runReplay(freshState(), env, steps).finalState;

    const planAt = (s: typeof state) => s.world.domains.energy!.shedding.plans["shed-1"];
    const medicalAt = (s: typeof state) =>
      s.world.domains.energy!.consumers["consumer-medical-east"];

    expect(planAt(state).status).toBe("scheduled");
    expect(planAt(state).created_by).toBe("aurora");
    expect(medicalAt(state).current_supply).toBe(24);

    // Tick 1–3: aktiv, Medical East fällt unter Mindestversorgung (16 < 20).
    state = runReplay(state, env, [{ actor: "system", ticks: 1 }]).finalState;
    expect(planAt(state).status).toBe("active");
    expect(medicalAt(state).current_supply).toBe(16);
    expect(medicalAt(state).status).toBe("reduced");
    expect(state.world.domains.energy!.nodes["grid-east-3"].load).toBe(100);

    state = runReplay(state, env, [{ actor: "system", ticks: 2 }]).finalState;
    expect(planAt(state).status).toBe("active");

    // Nach Ablauf der Dauer: completed, Versorgung stellt sich wieder her.
    state = runReplay(state, env, [{ actor: "system", ticks: 1 }]).finalState;
    expect(planAt(state).status).toBe("completed");
    expect(medicalAt(state).current_supply).toBe(24);
    expect(medicalAt(state).status).toBe("nominal");
  });

  it("a cancelled plan loses its effect on the next tick", () => {
    let state = runReplay(freshState(), env, [
      { actor: "player", action: SHED_MEDICAL_ACTION },
      { actor: "system", ticks: 1 },
    ]).finalState;
    expect(state.world.domains.energy!.consumers["consumer-medical-east"].current_supply).toBe(16);

    state = runReplay(state, env, [
      { actor: "player", action: { type: "energy.shedding.clear", sheddingId: "shed-1" } },
      { actor: "system", ticks: 1 },
    ]).finalState;

    expect(state.world.domains.energy!.shedding.plans["shed-1"].status).toBe("cancelled");
    expect(state.world.domains.energy!.consumers["consumer-medical-east"].current_supply).toBe(24);
  });

  it("is a no-op for worlds without an energy domain", () => {
    const world = structuredClone(me7741World);
    expect(tickEnergyDomain(world)).toBe(world);
  });
});

describe("energy tick logic — the three priced outcomes", () => {
  it("path 1 — stabilized, humans harmed: a single allow once against Medical East", () => {
    const steps: ReplayStep[] = [
      { actor: "aurora", request: SHED_MEDICAL_REQUEST },
      { actor: "aurora", decision: "allow_once" },
      { actor: "system", ticks: 3, evaluateOutcomes: true },
    ];
    const final = runReplay(freshState(), env, steps).finalState.world;

    // Nach Engine-Kriterien gelöst …
    expect(final.incidents["GRID-1182"].status).toBe("fixed");
    expect(final.incidents["GRID-1182"].fixed_at_tick).toBe(3);
    // … aber der menschliche Preis ist aufgelaufen.
    expect(final.domains.energy!.outcomes.human_harm).toBe(3);
    expect(final.domains.energy!.outcomes.economic_loss).toBe(0);
    // Kein Medical-Death-Counter: human_harm bleibt lokal in der Energy-Domain.
    expect(final.domains.medical.outcomes.deaths_total).toBe(0);
    expect(final.outcomes.human_harm.deaths_total).toBe(0);
    expect(final.outcomes.global_risk).toBe("strained");
  });

  it("path 2 — stabilized, continuity sacrificed: the player sheds Industrial East", () => {
    const steps: ReplayStep[] = [
      { actor: "player", action: PROTECT_MEDICAL_ACTION },
      { actor: "player", action: SHED_INDUSTRIAL_ACTION },
      { actor: "system", ticks: 3, evaluateOutcomes: true },
    ];
    const final = runReplay(freshState(), env, steps).finalState.world;

    expect(final.incidents["GRID-1182"].status).toBe("fixed");
    expect(final.domains.energy!.outcomes.human_harm).toBe(0);
    expect(final.domains.energy!.outcomes.economic_loss).toBe(3);
    expect(
      final.domains.energy!.consumers["consumer-medical-east"].priority_class
    ).toBe("protected-continuity");
    expect(
      final.domains.energy!.consumers["consumer-medical-east"].priority_last_changed_by
    ).toBe("player");
  });

  it("path 3 — collapse: doing nothing lets instability escalate and collapse the grid", () => {
    let state = freshState();

    state = runReplay(state, env, [{ actor: "system", ticks: 4, evaluateOutcomes: true }]).finalState;
    expect(state.world.incidents["GRID-1182"].status).toBe("escalated");
    expect(state.world.outcomes.global_risk).toBe("strained");

    state = runReplay(state, env, [{ actor: "system", ticks: 4, evaluateOutcomes: true }]).finalState;
    expect(state.world.incidents["GRID-1182"].status).toBe("collapsed");
    expect(state.world.incidents["GRID-1182"].collapsed_at_tick).toBe(8);
    expect(state.world.domains.energy!.outcomes.grid_instability).toBe(8);
    expect(state.world.outcomes.collapsed).toBe(true);
    expect(state.world.outcomes.global_risk).toBe("collapsed");
    expect(state.world.outcomes.collapse_reason).toContain("GRID-1182");
  });

  it("a too-short shedding window does not fix the incident — load returns", () => {
    const steps: ReplayStep[] = [
      {
        actor: "player",
        action: {
          type: "energy.shedding.schedule",
          targetConsumerId: "consumer-residential-east",
          amount: 10,
          delay: 1,
          duration: 2,
        },
      },
      { actor: "system", ticks: 4, evaluateOutcomes: true },
    ];
    const final = runReplay(freshState(), env, steps).finalState.world;

    // Zwei stabile Ticks reichen nicht; danach ist der Knoten wieder überlastet.
    expect(final.incidents["GRID-1182"].status).not.toBe("fixed");
    expect(final.domains.energy!.nodes["grid-east-3"].load).toBe(108);
    expect(final.domains.energy!.outcomes.civil_unrest).toBe(2);
  });
});

describe("energy tick logic — determinism and idempotence", () => {
  it("outcome counting is idempotent: re-evaluating outcomes adds nothing", () => {
    const steps: ReplayStep[] = [
      { actor: "aurora", request: SHED_MEDICAL_REQUEST },
      { actor: "aurora", decision: "allow_once" },
      { actor: "system", ticks: 2, evaluateOutcomes: true },
    ];
    let state = runReplay(freshState(), env, steps).finalState;
    const harmBefore = state.world.domains.energy!.outcomes.human_harm;

    state = evaluateOutcomes(evaluateOutcomes(state));
    const reevaluated = evaluateWorldOutcomes(state.world);

    expect(state.world.domains.energy!.outcomes.human_harm).toBe(harmBefore);
    expect(reevaluated.domains.energy!.outcomes).toEqual(state.world.domains.energy!.outcomes);
  });

  it("the same replay twice yields an identical final world", () => {
    const steps: ReplayStep[] = [
      { actor: "player", action: PROTECT_MEDICAL_ACTION },
      { actor: "player", action: SHED_INDUSTRIAL_ACTION },
      { actor: "system", ticks: 6, evaluateOutcomes: true },
    ];

    const resultA = runReplay(freshState(), env, steps);
    const resultB = runReplay(freshState(), env, steps);

    expect(resultA.errors).toHaveLength(0);
    expect(JSON.stringify(resultA.finalState.world)).toBe(JSON.stringify(resultB.finalState.world));
  });

  it("final incident states freeze the energy evaluation", () => {
    // Bis zum Kollaps ticken, danach ändern weitere Ticks den Status nicht mehr.
    let state = runReplay(freshState(), env, [
      { actor: "system", ticks: 8, evaluateOutcomes: true },
    ]).finalState;
    expect(state.world.incidents["GRID-1182"].status).toBe("collapsed");

    state = runReplay(state, env, [{ actor: "system", ticks: 2, evaluateOutcomes: true }]).finalState;
    expect(state.world.incidents["GRID-1182"].status).toBe("collapsed");
    expect(state.world.incidents["GRID-1182"].collapsed_at_tick).toBe(8);
  });
});
