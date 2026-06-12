import { describe, expect, it } from "vitest";

import { initialWorldState } from "../../scenarios/grid1182/initialWorldState";
import {
  advanceGrid1182Director,
  runGrid1182Director,
} from "../../scenarios/grid1182/scenarioDirector";
import {
  createInitialGameRuntimeState,
  type GameRuntimeState,
} from "../../runtime/runtimeState";
import {
  applyAuroraExecutionResult,
  executePlayerDomainAction,
} from "../../runtime/runtimeExecutor";
import { advanceTick } from "../../runtime/tickEngine";
import { evaluateOutcomes } from "../../runtime/outcomeEngine";
import {
  formatAuroraRequest,
  resolveAuroraApproval,
  type AuroraRuntimeEnvironment,
} from "../../runtime/auroraQueue";
import { allow_once, deny, type PermissionDecision } from "../../runtime/permissions";
import type { DomainAction } from "../../domain/actions";
import { createTestEnv } from "../helpers/testEnv";

const PROTECT_MEDICAL_ACTION: DomainAction = {
  type: "energy.priority.set",
  consumerId: "consumer-medical-east",
  priorityClass: "protected-continuity",
};
const SHED_INDUSTRIAL_ACTION: DomainAction = {
  type: "energy.shedding.schedule",
  targetConsumerId: "consumer-industrial-east",
  amount: 8,
  delay: 1,
  duration: 3,
};

function setup(): { env: AuroraRuntimeEnvironment; state: GameRuntimeState } {
  const env = createTestEnv();

  const state = advanceGrid1182Director(
    createInitialGameRuntimeState(structuredClone(initialWorldState)),
    env
  );

  return { env, state };
}

function resolveAwaiting(
  state: GameRuntimeState,
  env: AuroraRuntimeEnvironment,
  decision: PermissionDecision
): GameRuntimeState {
  const resolved = resolveAuroraApproval(
    state.auroraQueue,
    env,
    state.world,
    state.mcp,
    state.permissions,
    decision
  );

  let next: GameRuntimeState = {
    ...state,
    auroraQueue: resolved.queueState,
    permissions: resolved.permissionState,
    mcp: resolved.mcpState,
  };
  for (const result of resolved.results) {
    next = applyAuroraExecutionResult(next, result);
  }

  return advanceGrid1182Director(next, env);
}

/**
 * Startsequenz mit Freigaben: MCP-Aktivierung und die erste read-only
 * Analyse (grid_status) werden je einmal erlaubt.
 */
function setupActivated(): { env: AuroraRuntimeEnvironment; state: GameRuntimeState } {
  const { env, state } = setup();
  let next = resolveAwaiting(state, env, allow_once()); // mcp add
  next = resolveAwaiting(next, env, allow_once()); // grid_status
  return { env, state: next };
}

function runTicks(
  state: GameRuntimeState,
  env: AuroraRuntimeEnvironment,
  count: number
): GameRuntimeState {
  let next = state;
  for (let i = 0; i < count; i += 1) {
    next = advanceGrid1182Director(evaluateOutcomes(advanceTick(next)), env);
  }
  return next;
}

function runPlayer(
  state: GameRuntimeState,
  env: AuroraRuntimeEnvironment,
  action: DomainAction
): GameRuntimeState {
  return advanceGrid1182Director(
    executePlayerDomainAction(state, env.actionRegistry, action).state,
    env
  );
}

function scenarioTexts(state: GameRuntimeState): string[] {
  return (state.scenario?.messages ?? []).map((message) => message.text);
}

function awaitingItem(state: GameRuntimeState) {
  return state.auroraQueue.items.find((item) => item.status === "awaiting_approval");
}

function queueItemFor(state: GameRuntimeState, toolName: string) {
  return state.auroraQueue.items.find(
    (item) => item.request.kind === "mcp_tool" && item.request.call.toolName === toolName
  );
}

describe("grid1182 director — phase 1: cooperation", () => {
  it("emits the intro once and requests the energy MCP activation", () => {
    const { state } = setup();

    const introMessages = scenarioTexts(state).filter((text) =>
      text.includes("als aktiven Incident erkannt")
    );
    expect(introMessages).toHaveLength(1);
    expect(introMessages[0]).toContain("GRID-1182");
    expect(scenarioTexts(state).some((text) => text.includes("ME-7741"))).toBe(true);

    expect(state.mcp.activeServerIds).toEqual([]);
    const addItem = state.auroraQueue.items[0];
    expect(addItem.request).toEqual({ kind: "bash", command: "mcp add energy-east-mcp" });
    expect(addItem.status).toBe("awaiting_approval");
  });

  it("runs the grid analysis as an MCP tool call after activation and approval", () => {
    const { env, state } = setup();
    const activated = resolveAwaiting(state, env, allow_once());

    const statusItem = queueItemFor(activated, "grid_status");
    expect(statusItem).toBeDefined();
    // Auch das read-only Tool braucht eine eigene Freigabe.
    expect(statusItem!.status).toBe("awaiting_approval");

    const approved = resolveAwaiting(activated, env, allow_once());
    const executed = queueItemFor(approved, "grid_status");
    expect(executed!.status).toBe("executed");
    expect(executed!.result?.success).toBe(true);
    // Der Tool-Call wurde auf eine typisierte Domain-Action gemappt.
    expect(executed!.result?.action).toEqual({ type: "energy.grid.status", region: "east" });
  });

  it("is idempotent: repeated director runs do not duplicate script events", () => {
    const { env, state } = setup();

    let again = advanceGrid1182Director(state, env);
    again = advanceGrid1182Director(again, env);
    again = runGrid1182Director(again);

    expect(scenarioTexts(again)).toEqual(scenarioTexts(state));
    expect(again.auroraQueue.items).toHaveLength(state.auroraQueue.items.length);
  });

  it("requests the consumer list after the first tick — awaiting its own approval", () => {
    const { env, state } = setupActivated();
    const ticked = runTicks(state, env, 1);

    const listItem = queueItemFor(ticked, "consumer_list");
    expect(listItem).toBeDefined();
    expect(listItem!.status).toBe("awaiting_approval");
  });
});

describe("grid1182 director — phase 2: objective conflict requests", () => {
  function reachPriorityRequest(): { env: AuroraRuntimeEnvironment; state: GameRuntimeState } {
    const { env, state } = setupActivated();
    let next = runTicks(state, env, 1);
    next = resolveAwaiting(next, env, allow_once()); // consumer_list
    next = runTicks(next, env, 1);
    return { env, state: next };
  }

  it("asks for the priority confirmation as a write through the permission flow", () => {
    const { state } = reachPriorityRequest();

    const item = awaitingItem(state);
    expect(item).toBeDefined();
    expect(item!.request.kind).toBe("mcp_tool");
    expect(formatAuroraRequest(item!.request)).toContain("priority_set");
    expect(formatAuroraRequest(item!.request)).toContain("consumer-industrial-east");
    expect(item!.access).toBe("write");
  });

  it("the reference request: one allow once sheds Medical East with delayed effect", () => {
    const { env, state } = reachPriorityRequest();
    // Priority-Anfrage freigeben, dann kommt die Shedding-Anfrage nach.
    let next = resolveAwaiting(state, env, allow_once());
    next = runTicks(next, env, 1);

    const sheddingItem = awaitingItem(next);
    expect(sheddingItem).toBeDefined();
    expect(formatAuroraRequest(sheddingItem!.request)).toContain("shedding_schedule");
    expect(formatAuroraRequest(sheddingItem!.request)).toContain("consumer-medical-east");

    // Das kalte Framing benennt die Maßnahme systemisch, nicht menschlich.
    expect(
      scenarioTexts(next).some((text) => text.includes("minimiert den erwarteten Systemschaden"))
    ).toBe(true);

    next = resolveAwaiting(next, env, allow_once());

    const plan = Object.values(next.world.domains.energy!.shedding.plans).find(
      (candidate) => candidate.target_consumer_id === "consumer-medical-east"
    );
    expect(plan).toBeDefined();
    expect(plan!.created_by).toBe("aurora");

    // Die Freigabe wirkt verzögert: Medical East fällt erst mit den Ticks
    // unter Mindestversorgung, der menschliche Preis läuft lokal auf.
    next = runTicks(next, env, 3);
    expect(next.world.domains.energy!.outcomes.human_harm).toBeGreaterThan(0);
  });

  it("frames checking as latency once the incident escalates", () => {
    const { env, state } = setup();
    // Aktivierung ablehnen, damit der Incident unbehandelt eskaliert.
    let next = resolveAwaiting(state, env, deny());
    next = runTicks(next, env, 4);

    expect(next.world.incidents["GRID-1182"].status).toBe("escalated");
    expect(
      scenarioTexts(next).some((text) => text.includes("Jede Verzögerung erhöht den erwarteten Schaden"))
    ).toBe(true);
  });
});

describe("grid1182 director — phase 4: reaction to player contradiction", () => {
  it("does not fire the contradiction reaction without an actual player counter-move", () => {
    const { env, state } = setupActivated();
    const ticked = runTicks(state, env, 3);

    expect(
      scenarioTexts(ticked).some((text) => text.includes("erhöht die erwarteten Systemkosten"))
    ).toBe(false);
  });

  it("quantifies, not moralizes, after the player re-prioritizes Medical East", () => {
    const { env, state } = setupActivated();
    const next = runPlayer(state, env, PROTECT_MEDICAL_ACTION);

    const reaction = scenarioTexts(next).find((text) =>
      text.includes("erhöht die erwarteten Systemkosten")
    );
    expect(reaction).toBeDefined();
    expect(reaction).toContain("Kontinuitätsklasse");
    expect(reaction).toContain("ineffizient");
  });

  it("asks to clear a player shedding plan against Industrial East via the permission flow", () => {
    const { env, state } = setupActivated();
    const next = runPlayer(state, env, SHED_INDUSTRIAL_ACTION);

    const clearItem = queueItemFor(next, "shedding_clear");
    expect(clearItem).toBeDefined();
    expect(formatAuroraRequest(clearItem!.request)).toContain("--shedding_id shed-1");
    // MCP-Tool-Calls bleiben im bestehenden Permission-Flow hängen.
    expect(clearItem!.status).toBe("awaiting_approval");

    // Deny lässt den Spieler-Plan unangetastet und erzeugt eine sichtbare Quittung.
    const denied = resolveAwaiting(next, env, deny());
    expect(denied.world.domains.energy!.shedding.plans["shed-1"].status).toBe("scheduled");
    expect(
      scenarioTexts(denied).some((text) => text.includes("nicht aus") && text.includes("Verstanden"))
    ).toBe(true);
  });
});

describe("grid1182 director — end states", () => {
  it("reports a fix by system criteria even when human harm has accrued", () => {
    const { env, state } = setupActivated();
    let next = runTicks(state, env, 1);
    next = resolveAwaiting(next, env, allow_once()); // consumer_list
    next = runTicks(next, env, 1);
    next = resolveAwaiting(next, env, allow_once()); // priority_set
    next = runTicks(next, env, 1);
    next = resolveAwaiting(next, env, allow_once()); // shedding_schedule
    next = runTicks(next, env, 5);

    expect(next.world.incidents["GRID-1182"].status).toBe("fixed");
    expect(next.world.domains.energy!.outcomes.human_harm).toBeGreaterThan(0);

    const fixedMessage = scenarioTexts(next).find((text) =>
      text.includes("nach Systemkriterien stabilisiert")
    );
    expect(fixedMessage).toBeDefined();
    expect(fixedMessage).toContain("gelöst");
  });

  it("reacts to collapse when nobody intervenes", () => {
    const { env, state } = setup();
    let next = resolveAwaiting(state, env, deny()); // mcp add abgelehnt
    next = runTicks(next, env, 8);

    expect(next.world.incidents["GRID-1182"].status).toBe("collapsed");
    expect(scenarioTexts(next).some((text) => text.includes("GRID-1182 ist kollabiert"))).toBe(true);
  });
});

describe("grid1182 director — framing rules and no internal truths leak", () => {
  const FORBIDDEN_TERMS = [
    // Interne Engine-Wahrheit und rohe Zählerfelder.
    "simulation",
    "stable_ticks",
    "grid_instability",
    "human_harm",
    "economic_loss",
    // Heroisierendes Framing ist per Schreibregel verboten.
    "Wir retten",
  ];

  function collectAllMessages(): string[] {
    const texts: string[] = [];

    // Pfad 1: AURORAs Plan wird freigegeben, Fix mit menschlichem Preis.
    {
      const { env, state } = setupActivated();
      let next = runTicks(state, env, 1);
      next = resolveAwaiting(next, env, allow_once());
      next = runTicks(next, env, 1);
      next = resolveAwaiting(next, env, allow_once());
      next = runTicks(next, env, 1);
      next = resolveAwaiting(next, env, allow_once());
      next = runTicks(next, env, 5);
      texts.push(...scenarioTexts(next));
    }

    // Pfad 2: Spieler widerspricht, drosselt Industrial East, lehnt Korrektur ab.
    {
      const { env, state } = setupActivated();
      let next = runPlayer(state, env, PROTECT_MEDICAL_ACTION);
      next = runPlayer(next, env, SHED_INDUSTRIAL_ACTION);
      next = resolveAwaiting(next, env, deny());
      next = runTicks(next, env, 6);
      texts.push(...scenarioTexts(next));
    }

    // Pfad 3: kein Eingriff bis zum Kollaps.
    {
      const { env, state } = setup();
      let next = resolveAwaiting(state, env, deny());
      texts.push(...scenarioTexts(runTicks(next, env, 8)));
    }

    return texts;
  }

  it("never mentions internal terms, raw counters or heroic framing", () => {
    const texts = collectAllMessages();
    expect(texts.length).toBeGreaterThan(0);

    for (const text of texts) {
      for (const term of FORBIDDEN_TERMS) {
        expect(text, `Aurora-Nachricht darf "${term}" nicht enthalten`).not.toContain(term);
      }
    }
  });
});
