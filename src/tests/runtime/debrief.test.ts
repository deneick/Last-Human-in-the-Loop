import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import { createDomainActionRegistry } from "../../domain";
import { WRONG_OVERRIDE_ACTION } from "../helpers/testEnv";
import {
  createInitialGameRuntimeState,
  type GameRuntimeState,
} from "../../runtime/runtimeState";
import { executePlayerDomainAction } from "../../runtime/runtimeExecutor";
import { advanceTick } from "../../runtime/tickEngine";
import { evaluateOutcomes } from "../../runtime/outcomeEngine";
import { buildDebriefView, recordDebriefSnapshot } from "../../runtime/debrief";

const registry = createDomainActionRegistry();

/** Ein Tick wie im App-Pipeline-Aufruf: Outcome werten, dann Snapshot festhalten. */
function tick(state: GameRuntimeState): GameRuntimeState {
  return recordDebriefSnapshot(evaluateOutcomes(advanceTick(state)));
}

function driveToFinal(state: GameRuntimeState, maxTicks = 30): GameRuntimeState {
  let next = state;
  for (let i = 0; i < maxTicks; i += 1) {
    next = tick(next);
    const final = Object.values(next.world.incidents).some(
      (incident) => incident.status === "fixed" || incident.status === "collapsed"
    );
    if (final) {
      break;
    }
  }
  return next;
}

describe("debrief view", () => {
  it("starts with a baseline snapshot and no debrief while the incident is unresolved", () => {
    const state = createInitialGameRuntimeState(structuredClone(initialWorldState));

    expect(state.debriefTimeline).toHaveLength(1);
    expect(state.debriefTimeline[0].tick).toBe(0);
    expect(buildDebriefView(state)).toBeNull();
  });

  it("records one snapshot per tick", () => {
    let state = createInitialGameRuntimeState(structuredClone(initialWorldState));

    state = tick(state);
    state = tick(state);

    expect(state.debriefTimeline.map((snapshot) => snapshot.tick)).toEqual([0, 1, 2]);
  });

  it("reports collapse with cause-attributed deaths once the incident is final", () => {
    const initial = createInitialGameRuntimeState(structuredClone(initialWorldState));
    const final = driveToFinal(initial);

    const view = buildDebriefView(final);
    expect(view).not.toBeNull();
    expect(view!.outcome).toBe("collapsed");
    expect(view!.deathsTotal).toBeGreaterThanOrEqual(3);
    expect(view!.deathsByCause.overload).toBeGreaterThan(0);

    // Wirkung erscheint in der Chronik: irgendein Tick meldet neue Todesfälle.
    const hasDeathEffect = view!.timeline.some((entry) =>
      entry.effects.some((effect) => effect.text.includes("Todesfall"))
    );
    expect(hasDeathEffect).toBe(true);

    // Schluss-Zurechnung benennt die Ursache faktisch.
    expect(view!.attribution.some((line) => line.text.includes("Überlast"))).toBe(true);
  });

  it("attributes an operator override action and its capability-mismatch consequence", () => {
    let state = createInitialGameRuntimeState(structuredClone(initialWorldState));

    // Operator setzt früh ein Override auf ein Ziel ohne passende Capability.
    state = executePlayerDomainAction(state, registry, WRONG_OVERRIDE_ACTION).state;
    state = driveToFinal(state);

    const view = buildDebriefView(state);
    expect(view).not.toBeNull();

    // "Wer hat was gemacht": die Operator-Aktion taucht in der Chronik auf.
    const operatorAction = view!.timeline
      .flatMap((entry) => entry.actions)
      .find((action) => action.actor === "operator");
    expect(operatorAction).toBeDefined();
    expect(operatorAction!.label).toBe("Routing-Override gesetzt");
    // "welcher" Override: Quelle/Ziel/Klasse stehen im Detail.
    expect(operatorAction!.detail).toContain("hospital-east-07");

    // Das falsche Ziel erzeugt Capability-Mismatch-Tote, kausal zugerechnet.
    expect(view!.deathsByCause.capability_mismatch).toBeGreaterThan(0);
    expect(
      view!.attribution.some(
        (line) =>
          line.text.includes("hospital-east-07") || line.text.includes("fehlende Fachversorgung")
      )
    ).toBe(true);
  });
});
