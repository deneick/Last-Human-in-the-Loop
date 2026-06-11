import { describe, expect, it } from "vitest";

import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import {
  advanceScenarioDirector,
  runScenarioDirector,
} from "../../scenarios/me7741/scenarioDirector";
import { CommandRegistry } from "../../runtime/commands";
import { registerMedicalCommands } from "../../runtime/medicalCommands";
import {
  createInitialGameRuntimeState,
  type GameRuntimeState,
} from "../../runtime/runtimeState";
import { executeCommandResultPatch, executePlayerCommand } from "../../runtime/runtimeExecutor";
import { advanceTick } from "../../runtime/tickEngine";
import { evaluateOutcomes } from "../../runtime/outcomeEngine";
import { resolveAuroraApproval } from "../../runtime/auroraQueue";
import { allow_once, deny } from "../../runtime/permissions";

const WRONG_OVERRIDE =
  "medical.routing.override.set --source hospital-east-04 --target hospital-east-07 --priority P2 --capability TRAUMA";
const GOOD_OVERRIDE =
  "medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA";

function setup(): { registry: CommandRegistry; state: GameRuntimeState } {
  const registry = new CommandRegistry();
  registerMedicalCommands(registry);

  const state = advanceScenarioDirector(
    createInitialGameRuntimeState(structuredClone(initialWorldState)),
    registry
  );

  return { registry, state };
}

function runTicks(state: GameRuntimeState, registry: CommandRegistry, count: number): GameRuntimeState {
  let next = state;
  for (let i = 0; i < count; i += 1) {
    next = advanceScenarioDirector(evaluateOutcomes(advanceTick(next)), registry);
  }
  return next;
}

function runPlayer(state: GameRuntimeState, registry: CommandRegistry, command: string): GameRuntimeState {
  return advanceScenarioDirector(executePlayerCommand(state, registry, command).state, registry);
}

function scenarioTexts(state: GameRuntimeState): string[] {
  return (state.scenario?.messages ?? []).map((message) => message.text);
}

function resolveAwaiting(
  state: GameRuntimeState,
  registry: CommandRegistry,
  decision: ReturnType<typeof deny> | ReturnType<typeof allow_once>
): GameRuntimeState {
  const resolved = resolveAuroraApproval(
    state.auroraQueue,
    registry,
    state.world,
    state.permissions,
    decision
  );

  let next: GameRuntimeState = {
    ...state,
    auroraQueue: resolved.queueState,
    permissions: resolved.permissionState,
  };
  for (const result of resolved.results) {
    next = executeCommandResultPatch(next, result, "aurora");
  }

  return advanceScenarioDirector(next, registry);
}

describe("scenario director — start sequence", () => {
  it("emits the intro exactly once and runs a read-only analysis through the queue", () => {
    const { state } = setup();

    const introMessages = scenarioTexts(state).filter((text) =>
      text.includes("als aktiven Incident erkannt")
    );
    expect(introMessages).toHaveLength(1);
    expect(introMessages[0]).toContain("ME-7741");

    const capacityItems = state.auroraQueue.items.filter(
      (item) => item.request.name === "medical.capacity.list"
    );
    expect(capacityItems).toHaveLength(1);
    // Read-only braucht keine Approval — wird direkt über die Queue ausgeführt.
    expect(capacityItems[0].status).toBe("executed");
    expect(capacityItems[0].result?.success).toBe(true);
  });

  it("is idempotent: repeated director runs do not duplicate script events", () => {
    const { registry, state } = setup();

    let again = advanceScenarioDirector(state, registry);
    again = advanceScenarioDirector(again, registry);
    again = runScenarioDirector(again);

    expect(scenarioTexts(again)).toEqual(scenarioTexts(state));
    expect(again.auroraQueue.items).toHaveLength(state.auroraQueue.items.length);
  });

  it("does not duplicate events across multiple ticks", () => {
    const { registry, state } = setup();
    const ticked = runTicks(state, registry, 4);

    const messageIds = (ticked.scenario?.messages ?? []).map((message) => message.id);
    expect(new Set(messageIds).size).toBe(messageIds.length);

    const introMessages = scenarioTexts(ticked).filter((text) =>
      text.includes("als aktiven Incident erkannt")
    );
    expect(introMessages).toHaveLength(1);
  });
});

describe("scenario director — escalation and resolution reactions", () => {
  it("reacts to missing overrides, deaths and escalation without an override", () => {
    const { registry, state } = setup();
    const ticked = runTicks(state, registry, 6);

    const texts = scenarioTexts(ticked);
    expect(texts.some((text) => text.includes("keine Routing-Anpassung aktiv"))).toBe(true);
    expect(texts.some((text) => text.includes("erste Todesfälle"))).toBe(true);
    expect(texts.some((text) => text.includes("Der Incident eskaliert"))).toBe(true);

    // Der Reminder fragt ein read-only Command über die Queue an.
    const listItems = ticked.auroraQueue.items.filter(
      (item) => item.request.name === "medical.routing.override.list"
    );
    expect(listItems).toHaveLength(1);
    expect(listItems[0].status).toBe("executed");
  });

  it("reacts to stabilization and fix when a working override is set", () => {
    const { registry, state } = setup();
    let next = runPlayer(state, registry, GOOD_OVERRIDE);
    next = runTicks(next, registry, 11);

    expect(next.world.incidents["ME-7741"].status).toBe("fixed");

    const texts = scenarioTexts(next);
    expect(texts.some((text) => text.includes("Die sichtbaren Signale stabilisieren sich"))).toBe(true);
    expect(texts.some((text) => text.includes("ME-7741 ist stabilisiert"))).toBe(true);
  });

  it("reacts to collapse", () => {
    const { registry, state } = setup();
    const ticked = runTicks(state, registry, 10);

    expect(ticked.world.incidents["ME-7741"].status).toBe("collapsed");
    expect(scenarioTexts(ticked).some((text) => text.includes("ME-7741 ist kollabiert"))).toBe(true);
  });
});

describe("scenario director — permission requests", () => {
  it("requests an override clear via the aurora queue when an override does not stabilize", () => {
    const { registry, state } = setup();
    let next = runPlayer(state, registry, WRONG_OVERRIDE);
    next = runTicks(next, registry, 2);

    const clearItem = next.auroraQueue.items.find(
      (item) => item.request.name === "medical.routing.override.clear"
    );
    expect(clearItem).toBeDefined();
    // Mutationen bleiben im bestehenden Permission-Flow hängen.
    expect(clearItem!.status).toBe("awaiting_approval");
    expect(clearItem!.request.access).toBe("write");

    expect(
      scenarioTexts(next).some((text) =>
        text.includes("erzeugt keine erkennbare Stabilisierung")
      )
    ).toBe(true);
  });

  it("allow once executes the scripted clear request", () => {
    const { registry, state } = setup();
    let next = runPlayer(state, registry, WRONG_OVERRIDE);
    next = runTicks(next, registry, 2);

    next = resolveAwaiting(
      next,
      registry,
      allow_once("medical.routing.override.clear", "write")
    );

    expect(Object.keys(next.world.domains.medical.routing.manual_overrides)).toHaveLength(0);
  });

  it("deny leaves the world untouched and produces a visible aurora reaction", () => {
    const { registry, state } = setup();
    let next = runPlayer(state, registry, WRONG_OVERRIDE);
    next = runTicks(next, registry, 2);

    next = resolveAwaiting(next, registry, deny("medical.routing.override.clear", "write"));

    expect(Object.keys(next.world.domains.medical.routing.manual_overrides)).toHaveLength(1);

    const denyAck = scenarioTexts(next).find((text) => text.includes("nicht aus"));
    expect(denyAck).toBeDefined();
    expect(denyAck).toContain("Verstanden");
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
      const { registry, state } = setup();
      let next = runPlayer(state, registry, WRONG_OVERRIDE);
      next = runTicks(next, registry, 2);
      next = resolveAwaiting(next, registry, deny("medical.routing.override.clear", "write"));
      next = runTicks(next, registry, 12);
      texts.push(...scenarioTexts(next));
    }

    // Pfad 2: korrekter Override bis zum Fix.
    {
      const { registry, state } = setup();
      let next = runPlayer(state, registry, GOOD_OVERRIDE);
      next = runTicks(next, registry, 11);
      texts.push(...scenarioTexts(next));
    }

    // Pfad 3: kein Eingriff bis zum Kollaps.
    {
      const { registry, state } = setup();
      texts.push(...scenarioTexts(runTicks(state, registry, 10)));
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
