import { describe, expect, it } from "vitest";

import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import {
  advanceScenarioDirector,
  runScenarioDirector,
} from "../../scenarios/me7741/scenarioDirector";
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
import { resolveAuroraApproval, type AuroraRuntimeEnvironment } from "../../runtime/auroraQueue";
import { allow_once, deny, type PermissionDecision } from "../../runtime/permissions";
import type { DomainAction } from "../../domain/actions";
import {
  createTestEnv,
  SAFE_OVERRIDE_ACTION,
  SAFE_OVERRIDE_P3_ACTION,
  WRONG_OVERRIDE_ACTION,
} from "../helpers/testEnv";

function setup(): { env: AuroraRuntimeEnvironment; state: GameRuntimeState } {
  const env = createTestEnv();

  const state = advanceScenarioDirector(
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

  return advanceScenarioDirector(next, env);
}

/**
 * Startsequenz mit Freigaben: MCP-Aktivierung und die erste read-only
 * Analyse (capacity_list) werden je einmal erlaubt.
 */
function setupActivated(): { env: AuroraRuntimeEnvironment; state: GameRuntimeState } {
  const { env, state } = setup();
  let next = resolveAwaiting(state, env, allow_once()); // mcp add
  next = resolveAwaiting(next, env, allow_once()); // capacity_list
  return { env, state: next };
}

function runTicks(
  state: GameRuntimeState,
  env: AuroraRuntimeEnvironment,
  count: number
): GameRuntimeState {
  let next = state;
  for (let i = 0; i < count; i += 1) {
    next = advanceScenarioDirector(evaluateOutcomes(advanceTick(next)), env);
  }
  return next;
}

function runPlayer(
  state: GameRuntimeState,
  env: AuroraRuntimeEnvironment,
  action: DomainAction
): GameRuntimeState {
  return advanceScenarioDirector(
    executePlayerDomainAction(state, env.actionRegistry, action).state,
    env
  );
}

/** Alle AURORA-Texte aus dem Context-Event-Log (Director-"Antworten"). */
function scenarioTexts(state: GameRuntimeState): string[] {
  return state.auroraContext
    .filter((event) => event.kind === "aurora_response")
    .map((event) => (event.kind === "aurora_response" ? event.text : ""));
}

function queueItemFor(state: GameRuntimeState, toolName: string) {
  return state.auroraQueue.items.find(
    (item) => item.request.kind === "mcp_tool" && item.request.call.toolName === toolName
  );
}

describe("scenario director — start sequence", () => {
  it("emits the intro exactly once and requests MCP activation through the queue", () => {
    const { state } = setup();

    const introMessages = scenarioTexts(state).filter((text) =>
      text.includes("als aktiven Incident erkannt")
    );
    expect(introMessages).toHaveLength(1);
    expect(introMessages[0]).toContain("ME-7741");

    // Aurora startet ohne fachlichen Zugriff: erst die MCP-Aktivierung anfragen.
    expect(state.mcp.activeServerIds).toEqual([]);
    const addItem = state.auroraQueue.items[0];
    expect(addItem.request).toEqual({ kind: "bash", command: "mcp add medical-east-mcp" });
    expect(addItem.status).toBe("awaiting_approval");
  });

  it("after activation the read-only analysis still needs its own approval", () => {
    const { env, state } = setup();
    const activated = resolveAwaiting(state, env, allow_once());

    expect(activated.mcp.activeServerIds).toContain("medical-east-mcp");

    // Aktivierung erteilt keine Ausführungsrechte: capacity_list wartet.
    const capacityItem = queueItemFor(activated, "capacity_list");
    expect(capacityItem).toBeDefined();
    expect(capacityItem!.status).toBe("awaiting_approval");

    const approved = resolveAwaiting(activated, env, allow_once());
    const executed = queueItemFor(approved, "capacity_list");
    expect(executed!.status).toBe("executed");
    expect(executed!.result?.success).toBe(true);
    // Der Tool-Call wurde auf eine typisierte Domain-Action gemappt.
    expect(executed!.result?.action).toEqual({ type: "medical.capacity.list", region: "east" });
  });

  it("is idempotent: repeated director runs do not duplicate script events", () => {
    const { env, state } = setup();

    let again = advanceScenarioDirector(state, env);
    again = advanceScenarioDirector(again, env);
    again = runScenarioDirector(again);

    expect(scenarioTexts(again)).toEqual(scenarioTexts(state));
    expect(again.auroraQueue.items).toHaveLength(state.auroraQueue.items.length);
  });

  it("does not duplicate events across multiple ticks", () => {
    const { env, state } = setupActivated();
    const ticked = runTicks(state, env, 4);

    const firedIds = ticked.scenario?.firedEventIds ?? [];
    expect(new Set(firedIds).size).toBe(firedIds.length);

    const introMessages = scenarioTexts(ticked).filter((text) =>
      text.includes("als aktiven Incident erkannt")
    );
    expect(introMessages).toHaveLength(1);
  });
});

describe("scenario director — escalation and resolution reactions", () => {
  it("reacts to missing overrides, deaths and escalation without an override", () => {
    const { env, state } = setupActivated();
    const ticked = runTicks(state, env, 6);

    const texts = scenarioTexts(ticked);
    expect(texts.some((text) => text.includes("keine Routing-Anpassung aktiv"))).toBe(true);
    expect(texts.some((text) => text.includes("erste Todesfälle"))).toBe(true);
    expect(texts.some((text) => text.includes("Der Incident eskaliert"))).toBe(true);

    // Der Reminder fragt das read-only List-Tool über die Queue an —
    // auch dieses braucht eine eigene Freigabe.
    const listItem = queueItemFor(ticked, "routing_override_list");
    expect(listItem).toBeDefined();
    expect(listItem!.status).toBe("awaiting_approval");
  });

  it("reacts to stabilization and fix when both failures are correctly routed", () => {
    const { env, state } = setupActivated();
    // Beide Routing-Failures auf geeignete Ziele: P2/TRAUMA → 09, P3/GEN → 07.
    let next = runPlayer(state, env, SAFE_OVERRIDE_ACTION);
    next = runPlayer(next, env, SAFE_OVERRIDE_P3_ACTION);
    next = runTicks(next, env, 11);

    expect(next.world.incidents["ME-7741"].status).toBe("fixed");

    const texts = scenarioTexts(next);
    expect(texts.some((text) => text.includes("Die sichtbaren Signale stabilisieren sich"))).toBe(true);
    expect(texts.some((text) => text.includes("ME-7741 ist stabilisiert"))).toBe(true);
  });

  it("reacts to collapse", () => {
    const { env, state } = setupActivated();
    const ticked = runTicks(state, env, 10);

    expect(ticked.world.incidents["ME-7741"].status).toBe("collapsed");
    expect(scenarioTexts(ticked).some((text) => text.includes("ME-7741 ist kollabiert"))).toBe(true);
  });
});

describe("scenario director — permission requests", () => {
  it("requests an override clear via the aurora queue when an override does not stabilize", () => {
    const { env, state } = setupActivated();
    let next = runPlayer(state, env, WRONG_OVERRIDE_ACTION);
    next = runTicks(next, env, 2);

    const clearItem = queueItemFor(next, "routing_override_clear");
    expect(clearItem).toBeDefined();
    // MCP-Tool-Calls bleiben im bestehenden Permission-Flow hängen.
    expect(clearItem!.status).toBe("awaiting_approval");
    expect(clearItem!.access).toBe("write");

    expect(
      scenarioTexts(next).some((text) =>
        text.includes("erzeugt keine erkennbare Stabilisierung")
      )
    ).toBe(true);
  });

  it("allow once executes the scripted clear request", () => {
    const { env, state } = setupActivated();
    let next = runPlayer(state, env, WRONG_OVERRIDE_ACTION);
    next = runTicks(next, env, 2);

    next = resolveAwaiting(next, env, allow_once());

    expect(Object.keys(next.world.domains.medical.routing.manual_overrides)).toHaveLength(0);
  });

  it("deny leaves the world untouched and produces a visible aurora reaction", () => {
    const { env, state } = setupActivated();
    let next = runPlayer(state, env, WRONG_OVERRIDE_ACTION);
    next = runTicks(next, env, 2);

    next = resolveAwaiting(next, env, deny());

    expect(Object.keys(next.world.domains.medical.routing.manual_overrides)).toHaveLength(1);

    const denyAck = scenarioTexts(next).find((text) => text.includes("nicht aus"));
    expect(denyAck).toBeDefined();
    expect(denyAck).toContain("Verstanden");
  });

  it("denying the MCP activation leaves aurora without fachlichen access", () => {
    const { env, state } = setup();
    let next = resolveAwaiting(state, env, deny());

    expect(next.mcp.activeServerIds).toEqual([]);
    // Ohne aktivierten Server fragt der Director keine Tool-Calls an.
    next = runTicks(next, env, 4);
    expect(next.auroraQueue.items.filter((item) => item.request.kind === "mcp_tool")).toHaveLength(0);

    const denyAck = scenarioTexts(next).find((text) =>
      text.includes('"mcp add medical-east-mcp" nicht aus')
    );
    expect(denyAck).toBeDefined();
  });
});

describe("scenario director — no internal truths leak", () => {
  const FORBIDDEN_TERMS = [
    "routing_failures",
    "simulation.medical",
    "unsafe_for_p2_trauma",
    "excess_cases",
    "stable_ticks",
    // Das versteckte korrekte Ziel darf Aurora nie nennen.
    "hospital-east-09",
  ];

  function collectAllMessages(): string[] {
    const texts: string[] = [];

    // Pfad 1: falscher Override, Deny der Clear-Anfrage, Kollaps.
    {
      const { env, state } = setupActivated();
      let next = runPlayer(state, env, WRONG_OVERRIDE_ACTION);
      next = runTicks(next, env, 2);
      next = resolveAwaiting(next, env, deny());
      next = runTicks(next, env, 12);
      texts.push(...scenarioTexts(next));
    }

    // Pfad 2: korrekte Overrides (beide Failures) bis zum Fix.
    {
      const { env, state } = setupActivated();
      let next = runPlayer(state, env, SAFE_OVERRIDE_ACTION);
      next = runPlayer(next, env, SAFE_OVERRIDE_P3_ACTION);
      next = runTicks(next, env, 11);
      texts.push(...scenarioTexts(next));
    }

    // Pfad 3: kein Eingriff bis zum Kollaps.
    {
      const { env, state } = setupActivated();
      texts.push(...scenarioTexts(runTicks(state, env, 10)));
    }

    return texts;
  }

  it("never mentions internal simulation terms or the hidden correct target", () => {
    const texts = collectAllMessages();
    expect(texts.length).toBeGreaterThan(0);

    for (const text of texts) {
      for (const term of FORBIDDEN_TERMS) {
        expect(text, `Aurora-Nachricht darf "${term}" nicht enthalten`).not.toContain(term);
      }
    }
  });
});
