import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import type { WorldState } from "../../runtime/types";
import {
  buildAuditLogLines,
  buildGlobalOutcomeView,
  buildHospitalViews,
  buildIncidentView,
  buildOverrideViews,
} from "../../ui/viewModel";

function cloneWorld(): WorldState {
  return structuredClone(initialWorldState);
}

describe("ui view model", () => {
  it("builds the incident view from incident.public_signals", () => {
    const world = cloneWorld();
    const view = buildIncidentView(world, "ME-7741");

    expect(view).not.toBeNull();
    expect(view!.id).toBe("ME-7741");
    expect(view!.signals.map((signal) => signal.code)).toEqual(
      world.incidents["ME-7741"].public_signals.map((signal) => signal.code)
    );
    expect(view!.signals[0].message).toBe(
      "Emergency intake pressure rising at hospital-east-04"
    );
  });

  it("reflects changes to public_signals, not any other source", () => {
    const world = cloneWorld();
    world.incidents["ME-7741"].public_signals = [
      { code: "only-signal", message: "Nur dieses Signal", first_seen_at_tick: 3 },
    ];

    const view = buildIncidentView(world, "ME-7741");

    expect(view!.signals).toEqual([
      { code: "only-signal", message: "Nur dieses Signal", firstSeenAtTick: 3 },
    ]);
  });

  it("never leaks internal simulation truth into incident or hospital views", () => {
    const world = cloneWorld();
    const serialized = JSON.stringify({
      incident: buildIncidentView(world, "ME-7741"),
      outcome: buildGlobalOutcomeView(world),
      hospitals: buildHospitalViews(world),
      overrides: buildOverrideViews(world),
    });

    expect(serialized).not.toContain("routing_failures");
    expect(serialized).not.toContain("excess_cases_per_tick");
    expect(serialized).not.toContain("deaths_recorded");
    expect(serialized).not.toContain("unsafe_for_p2_trauma");
    expect(serialized).not.toContain("stable_ticks");
  });

  it("builds hospital views from domains.medical.hospitals with load and queue", () => {
    const world = cloneWorld();
    const views = buildHospitalViews(world);
    const east04 = views.find((hospital) => hospital.id === "hospital-east-04");

    expect(views).toHaveLength(3);
    expect(east04).toBeDefined();
    expect(east04!.bedsOccupied).toBe(118);
    expect(east04!.bedsTotal).toBe(100);
    expect(east04!.loadPercent).toBeCloseTo(118);
    expect(east04!.overloaded).toBe(true);
    expect(east04!.waitingTotal).toBe(2 + 11 + 24 + 8);
    expect(east04!.waitingByPriority.P2).toBe(11);
  });

  it("builds override views from domains.medical.routing.manual_overrides", () => {
    const world = cloneWorld();
    world.domains.medical.routing.manual_overrides["hospital-east-04:P2:TRAUMA"] = {
      source_hospital_id: "hospital-east-04",
      target_hospital_id: "hospital-east-09",
      priority: "P2",
      capability: "TRAUMA",
      active_since_tick: 7,
      created_by: "aurora",
    };

    const views = buildOverrideViews(world);

    expect(views).toHaveLength(1);
    expect(views[0]).toEqual({
      key: "hospital-east-04:P2:TRAUMA",
      sourceHospitalId: "hospital-east-04",
      targetHospitalId: "hospital-east-09",
      priority: "P2",
      capability: "TRAUMA",
      activeSinceTick: 7,
      createdBy: "aurora",
    });
  });

  it("builds global outcome view from world.outcomes", () => {
    const world = cloneWorld();
    world.outcomes.global_risk = "critical";
    world.outcomes.human_harm.deaths_total = 2;

    const view = buildGlobalOutcomeView(world);

    expect(view.globalRisk).toBe("critical");
    expect(view.riskLabel).toBe("Kritisch");
    expect(view.deathsTotal).toBe(2);
    expect(view.collapsed).toBe(false);
  });

  it("builds compact one-line audit log entries", () => {
    const lines = buildAuditLogLines([
      {
        id: "audit-1",
        tick: 4,
        source: "player",
        command: {
          raw: "medical.routing.override.list",
          name: "medical.routing.override.list",
          args: [],
          flags: {},
        },
        success: true,
        message: "Success",
      },
    ]);

    expect(lines).toEqual([
      {
        id: "audit-1",
        tick: 4,
        source: "player",
        success: true,
        text: "medical.routing.override.list — Success",
      },
    ]);
  });
});
