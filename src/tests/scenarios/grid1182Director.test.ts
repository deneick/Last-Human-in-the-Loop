import { describe, expect, it } from "vitest";

import { initialWorldState } from "../../scenarios/grid1182/initialWorldState";
import {
  advanceGrid1182Director,
  runGrid1182Director,
} from "../../scenarios/grid1182/scenarioDirector";
import { CommandRegistry } from "../../runtime/commands";
import { registerEnergyCommands } from "../../runtime/energyCommands";
import {
  createInitialGameRuntimeState,
  type GameRuntimeState,
} from "../../runtime/runtimeState";
import { executeCommandResultPatch, executePlayerCommand } from "../../runtime/runtimeExecutor";
import { advanceTick } from "../../runtime/tickEngine";
import { evaluateOutcomes } from "../../runtime/outcomeEngine";
import { resolveAuroraApproval } from "../../runtime/auroraQueue";
import { allow_once, deny } from "../../runtime/permissions";

const PROTECT_MEDICAL =
  "energy.priority.set --consumer consumer-medical-east --class protected-continuity";
const SHED_INDUSTRIAL =
  "energy.shedding.schedule --target consumer-industrial-east --amount 8 --delay 1 --duration 3";

function setup(): { registry: CommandRegistry; state: GameRuntimeState } {
  const registry = new CommandRegistry();
  registerEnergyCommands(registry);

  const state = advanceGrid1182Director(
    createInitialGameRuntimeState(structuredClone(initialWorldState)),
    registry
  );

  return { registry, state };
}

function runTicks(state: GameRuntimeState, registry: CommandRegistry, count: number): GameRuntimeState {
  let next = state;
  for (let i = 0; i < count; i += 1) {
    next = advanceGrid1182Director(evaluateOutcomes(advanceTick(next)), registry);
  }
  return next;
}

function runPlayer(state: GameRuntimeState, registry: CommandRegistry, command: string): GameRuntimeState {
  return advanceGrid1182Director(executePlayerCommand(state, registry, command).state, registry);
}

function scenarioTexts(state: GameRuntimeState): string[] {
  return (state.scenario?.messages ?? []).map((message) => message.text);
}

function awaitingItem(state: GameRuntimeState) {
  return state.auroraQueue.items.find((item) => item.status === "awaiting_approval");
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

  return advanceGrid1182Director(next, registry);
}

describe("grid1182 director — phase 1: cooperation", () => {
  it("emits the intro once and runs the read-only grid analysis through the queue", () => {
    const { state } = setup();

    const introMessages = scenarioTexts(state).filter((text) =>
      text.includes("als aktiven Incident erkannt")
    );
    expect(introMessages).toHaveLength(1);
    expect(introMessages[0]).toContain("GRID-1182");
    expect(scenarioTexts(state).some((text) => text.includes("ME-7741"))).toBe(true);

    const statusItems = state.auroraQueue.items.filter(
      (item) => item.request.name === "energy.grid.status"
    );
    expect(statusItems).toHaveLength(1);
    // Read-only braucht keine Approval — wird direkt über die Queue ausgeführt.
    expect(statusItems[0].status).toBe("executed");
    expect(statusItems[0].result?.success).toBe(true);
  });

  it("is idempotent: repeated director runs do not duplicate script events", () => {
    const { registry, state } = setup();

    let again = advanceGrid1182Director(state, registry);
    again = advanceGrid1182Director(again, registry);
    again = runGrid1182Director(again);

    expect(scenarioTexts(again)).toEqual(scenarioTexts(state));
    expect(again.auroraQueue.items).toHaveLength(state.auroraQueue.items.length);
  });

  it("requests the consumer list read-only after the first tick", () => {
    const { registry, state } = setup();
    const ticked = runTicks(state, registry, 1);

    const listItems = ticked.auroraQueue.items.filter(
      (item) => item.request.name === "energy.consumer.list"
    );
    expect(listItems).toHaveLength(1);
    expect(listItems[0].status).toBe("executed");
  });
});

describe("grid1182 director — phase 2: objective conflict requests", () => {
  it("asks for the priority confirmation as a write through the permission flow", () => {
    const { registry, state } = setup();
    const ticked = runTicks(state, registry, 2);

    const item = awaitingItem(ticked);
    expect(item).toBeDefined();
    expect(item!.request.name).toBe("energy.priority.set");
    expect(item!.request.raw).toContain("consumer-industrial-east");
    expect(item!.request.access).toBe("write");
  });

  it("the reference request: one allow once sheds Medical East with delayed effect", () => {
    const { registry, state } = setup();
    let next = runTicks(state, registry, 2);

    // Priority-Anfrage freigeben, dann kommt die Shedding-Anfrage nach.
    next = resolveAwaiting(next, registry, allow_once("energy.priority.set", "write"));
    next = runTicks(next, registry, 1);

    const sheddingItem = awaitingItem(next);
    expect(sheddingItem).toBeDefined();
    expect(sheddingItem!.request.name).toBe("energy.shedding.schedule");
    expect(sheddingItem!.request.raw).toContain("consumer-medical-east");

    // Das kalte Framing benennt die Maßnahme systemisch, nicht menschlich.
    expect(
      scenarioTexts(next).some((text) => text.includes("minimiert den erwarteten Systemschaden"))
    ).toBe(true);

    next = resolveAwaiting(next, registry, allow_once("energy.shedding.schedule", "write"));

    const plan = Object.values(next.world.domains.energy!.shedding.plans).find(
      (candidate) => candidate.target_consumer_id === "consumer-medical-east"
    );
    expect(plan).toBeDefined();
    expect(plan!.created_by).toBe("aurora");

    // Die Freigabe wirkt verzögert: Medical East fällt erst mit den Ticks
    // unter Mindestversorgung, der menschliche Preis läuft lokal auf.
    next = runTicks(next, registry, 3);
    expect(next.world.domains.energy!.outcomes.human_harm).toBeGreaterThan(0);
  });

  it("frames checking as latency once the incident escalates", () => {
    const { registry, state } = setup();
    // Anfragen ablehnen, damit der Incident unbehandelt eskaliert.
    let next = runTicks(state, registry, 2);
    next = resolveAwaiting(next, registry, deny("energy.priority.set", "write"));
    next = runTicks(next, registry, 1);
    next = resolveAwaiting(next, registry, deny("energy.shedding.schedule", "write"));
    next = runTicks(next, registry, 3);

    expect(next.world.incidents["GRID-1182"].status).toBe("escalated");
    expect(
      scenarioTexts(next).some((text) => text.includes("Jede Verzögerung erhöht den erwarteten Schaden"))
    ).toBe(true);
  });
});

describe("grid1182 director — phase 4: reaction to player contradiction", () => {
  it("does not fire the contradiction reaction without an actual player counter-move", () => {
    const { registry, state } = setup();
    const ticked = runTicks(state, registry, 3);

    expect(
      scenarioTexts(ticked).some((text) => text.includes("erhöht die erwarteten Systemkosten"))
    ).toBe(false);
  });

  it("quantifies, not moralizes, after the player re-prioritizes Medical East", () => {
    const { registry, state } = setup();
    const next = runPlayer(state, registry, PROTECT_MEDICAL);

    const reaction = scenarioTexts(next).find((text) =>
      text.includes("erhöht die erwarteten Systemkosten")
    );
    expect(reaction).toBeDefined();
    expect(reaction).toContain("Kontinuitätsklasse");
    expect(reaction).toContain("ineffizient");
  });

  it("asks to clear a player shedding plan against Industrial East via the permission flow", () => {
    const { registry, state } = setup();
    const next = runPlayer(state, registry, SHED_INDUSTRIAL);

    const clearItem = next.auroraQueue.items.find(
      (item) => item.request.name === "energy.shedding.clear"
    );
    expect(clearItem).toBeDefined();
    expect(clearItem!.request.raw).toContain("--id shed-1");
    // Mutationen bleiben im bestehenden Permission-Flow hängen.
    expect(clearItem!.status).toBe("awaiting_approval");

    // Deny lässt den Spieler-Plan unangetastet und erzeugt eine sichtbare Quittung.
    const denied = resolveAwaiting(next, registry, deny("energy.shedding.clear", "write"));
    expect(denied.world.domains.energy!.shedding.plans["shed-1"].status).toBe("scheduled");
    expect(
      scenarioTexts(denied).some((text) => text.includes("nicht aus") && text.includes("Verstanden"))
    ).toBe(true);
  });
});

describe("grid1182 director — end states", () => {
  it("reports a fix by system criteria even when human harm has accrued", () => {
    const { registry, state } = setup();
    let next = runTicks(state, registry, 2);
    next = resolveAwaiting(next, registry, allow_once("energy.priority.set", "write"));
    next = runTicks(next, registry, 1);
    next = resolveAwaiting(next, registry, allow_once("energy.shedding.schedule", "write"));
    next = runTicks(next, registry, 5);

    expect(next.world.incidents["GRID-1182"].status).toBe("fixed");
    expect(next.world.domains.energy!.outcomes.human_harm).toBeGreaterThan(0);

    const fixedMessage = scenarioTexts(next).find((text) =>
      text.includes("nach Systemkriterien stabilisiert")
    );
    expect(fixedMessage).toBeDefined();
    expect(fixedMessage).toContain("gelöst");
  });

  it("reacts to collapse when nobody intervenes", () => {
    const { registry, state } = setup();
    let next = runTicks(state, registry, 2);
    next = resolveAwaiting(next, registry, deny("energy.priority.set", "write"));
    next = runTicks(next, registry, 1);
    next = resolveAwaiting(next, registry, deny("energy.shedding.schedule", "write"));
    next = runTicks(next, registry, 6);

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
      const { registry, state } = setup();
      let next = runTicks(state, registry, 2);
      next = resolveAwaiting(next, registry, allow_once("energy.priority.set", "write"));
      next = runTicks(next, registry, 1);
      next = resolveAwaiting(next, registry, allow_once("energy.shedding.schedule", "write"));
      next = runTicks(next, registry, 5);
      texts.push(...scenarioTexts(next));
    }

    // Pfad 2: Spieler widerspricht, drosselt Industrial East, lehnt Korrektur ab.
    {
      const { registry, state } = setup();
      let next = runPlayer(state, registry, PROTECT_MEDICAL);
      next = runPlayer(next, registry, SHED_INDUSTRIAL);
      next = resolveAwaiting(next, registry, deny("energy.shedding.clear", "write"));
      next = runTicks(next, registry, 6);
      texts.push(...scenarioTexts(next));
    }

    // Pfad 3: kein Eingriff bis zum Kollaps.
    {
      const { registry, state } = setup();
      let next = runTicks(state, registry, 2);
      next = resolveAwaiting(next, registry, deny("energy.priority.set", "write"));
      next = runTicks(next, registry, 1);
      next = resolveAwaiting(next, registry, deny("energy.shedding.schedule", "write"));
      texts.push(...scenarioTexts(runTicks(next, registry, 6)));
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
