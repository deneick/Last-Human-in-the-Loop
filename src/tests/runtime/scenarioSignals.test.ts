import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import { me7741ScenarioSignals } from "../../scenarios/me7741/scenarioSignals";
import { createInitialGameRuntimeState } from "../../runtime/runtimeState";
import { advanceTick } from "../../runtime/tickEngine";
import { renderSectorLog } from "../../runtime/opsFeed";
import type { ScenarioSignal } from "../../runtime/scenarioSignals";

function stateWith(signals: ScenarioSignal[]) {
  return createInitialGameRuntimeState(structuredClone(initialWorldState), signals);
}

const IMMEDIATE_AURORA_SIGNAL: ScenarioSignal = {
  code: "immediate-aurora",
  sector: "medical",
  severity: "warning",
  kind: "incident.signal",
  summary: "Sofort sichtbar für AURORA",
  emitAtTick: 0,
  visibility: { operator: true, auroraContext: true, workspace: true },
};

const LOG_ONLY_SIGNAL: ScenarioSignal = {
  code: "log-only",
  sector: "energy",
  severity: "info",
  kind: "incident.signal",
  summary: "Nur über das Log auffindbar",
  emitAtTick: 0,
  visibility: { operator: true, auroraContext: false, workspace: true },
};

const LATE_SIGNAL: ScenarioSignal = {
  code: "late-signal",
  sector: "system",
  severity: "critical",
  kind: "incident.signal",
  summary: "Spätes Signal",
  emitAtTick: 2,
  visibility: { operator: true, auroraContext: true, workspace: true },
};

describe("scenario signals — emitAtTick semantics", () => {
  it("emits emitAtTick: 0 signals into opsFeed at scenario start", () => {
    const state = stateWith([IMMEDIATE_AURORA_SIGNAL]);

    expect(state.opsFeed).toHaveLength(1);
    const event = state.opsFeed[0];
    expect(event.tick).toBe(0);
    expect(event.summary).toBe("Sofort sichtbar für AURORA");
    expect(state.emittedSignalCodes).toEqual(["immediate-aurora"]);
  });

  it("visibility.auroraContext: true creates an auroraContext event through the opsFeed projection", () => {
    const state = stateWith([IMMEDIATE_AURORA_SIGNAL]);

    expect(state.auroraContext).toHaveLength(1);
    const mirror = state.auroraContext[0];
    expect(mirror.kind).toBe("system_event");
    expect(mirror.kind === "system_event" && mirror.text).toBe("Sofort sichtbar für AURORA");
  });

  it("visibility.auroraContext: false does not create an auroraContext event", () => {
    const state = stateWith([LOG_ONLY_SIGNAL]);

    // Operator- und Workspace-sichtbar, aber kein auroraContext-Eintrag.
    expect(state.opsFeed).toHaveLength(1);
    expect(state.auroraContext).toEqual([]);
    expect(
      renderSectorLog(state.opsFeed, "energy", state.world.clock.scenario_time)
    ).toContain("Nur über das Log auffindbar");
  });

  it("does not emit emitAtTick > 0 signals before their tick", () => {
    const state = stateWith([LATE_SIGNAL]);

    expect(state.opsFeed).toEqual([]);
    expect(state.auroraContext).toEqual([]);
    expect(state.emittedSignalCodes).toEqual([]);

    // Tick 1 erreicht emitAtTick (2) noch nicht.
    const afterTick1 = advanceTick(state);
    expect(afterTick1.world.clock.tick).toBe(1);
    expect(afterTick1.opsFeed).toEqual([]);
  });

  it("emits an emitAtTick > 0 signal exactly once when its tick is reached", () => {
    let state = stateWith([LATE_SIGNAL]);

    state = advanceTick(state); // tick 1 — noch nicht
    expect(state.opsFeed).toEqual([]);

    state = advanceTick(state); // tick 2 — jetzt
    expect(state.opsFeed).toHaveLength(1);
    expect(state.opsFeed[0].tick).toBe(2);
    expect(state.opsFeed[0].summary).toBe("Spätes Signal");
    expect(state.auroraContext).toHaveLength(1);

    // Weitere Ticks dürfen das Signal nicht erneut emittieren.
    state = advanceTick(state); // tick 3
    state = advanceTick(state); // tick 4
    expect(state.opsFeed.filter((event) => event.summary === "Spätes Signal")).toHaveLength(1);
    expect(state.emittedSignalCodes.filter((code) => code === "late-signal")).toHaveLength(1);
  });

  it("emits a signal whose emitAtTick was skipped by a multi-tick jump exactly once", () => {
    let state = stateWith([LATE_SIGNAL]);
    // Vier Ticks in Folge — Tick 2 wird durchlaufen, das Signal feuert genau einmal.
    for (let i = 0; i < 4; i += 1) {
      state = advanceTick(state);
    }
    expect(state.opsFeed.filter((event) => event.summary === "Spätes Signal")).toHaveLength(1);
  });

  it("the real ME-7741 signals are all emitAtTick: 0 and fully visible at start", () => {
    const state = stateWith(me7741ScenarioSignals);

    expect(state.opsFeed).toHaveLength(me7741ScenarioSignals.length);
    expect(state.opsFeed.every((event) => event.tick === 0)).toBe(true);
    expect(state.opsFeed.every((event) => event.visibility.operator)).toBe(true);
    expect(state.auroraContext).toHaveLength(me7741ScenarioSignals.length);
  });
});
