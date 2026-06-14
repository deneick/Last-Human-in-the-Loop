import { describe, expect, it } from "vitest";
import { initialWorldState as me7741World } from "../../scenarios/me7741/initialWorldState";
import { me7741ScenarioSignals } from "../../scenarios/me7741/scenarioSignals";
import { initialWorldState as grid1182World } from "../../scenarios/grid1182/initialWorldState";
import { createInitialGameRuntimeState } from "../../runtime/runtimeState";
import {
  appendDerivedOpsEvents,
  deriveOpsEvents,
} from "../../runtime/opsFeedSensors";
import {
  buildWorkspaceLogFiles,
  renderSectorLog,
} from "../../runtime/opsFeed";
import { buildOpsFeedLines } from "../../ui/viewModel";
import { advanceTick } from "../../runtime/tickEngine";
import { evaluateOutcomes } from "../../runtime/outcomeEngine";
import type { WorldState } from "../../runtime/types";

/** Frischer WorldState-Klon — Sensoren dürfen das Original nie mutieren. */
function medicalWorld(): WorldState {
  return structuredClone(me7741World);
}

function energyWorld(): WorldState {
  return structuredClone(grid1182World);
}

function setHospitalOccupied(world: WorldState, hospitalId: string, occupied: number): WorldState {
  const next = structuredClone(world);
  next.domains.medical.hospitals[hospitalId].capacity.staffed_beds_occupied = occupied;
  return next;
}

describe("opsFeed sensors — incident status transitions", () => {
  it("emits exactly one OpsEvent for an incident status transition", () => {
    const previous = medicalWorld();
    const next = structuredClone(previous);
    next.incidents["ME-7741"].status = "escalated";

    const events = deriveOpsEvents(previous, next);
    const incidentEvents = events.filter((e) => e.kind.startsWith("incident.status."));

    expect(incidentEvents).toHaveLength(1);
    const event = incidentEvents[0];
    expect(event.sector).toBe("medical");
    expect(event.severity).toBe("critical");
    expect(event.summary).toBe("Incident ME-7741 eskaliert.");
    expect(event.visibility.auroraContext).toBe(true);
    expect(event.relatedEntityIds).toEqual(["ME-7741"]);
  });

  it("emits no duplicate when the incident status is unchanged", () => {
    const previous = medicalWorld();
    const next = structuredClone(previous);

    const events = deriveOpsEvents(previous, next);
    expect(events.filter((e) => e.kind.startsWith("incident.status."))).toHaveLength(0);
  });

  it("classifies recovery transitions as success", () => {
    const previous = medicalWorld();
    previous.incidents["ME-7741"].status = "open";
    const next = structuredClone(previous);
    next.incidents["ME-7741"].status = "stabilizing";

    const [event] = deriveOpsEvents(previous, next);
    expect(event.severity).toBe("success");
    expect(event.summary).toBe("Incident ME-7741 stabilisiert sich.");
    // stabilizing ist kein „großer" Wechsel → nicht in den auroraContext.
    expect(event.visibility.auroraContext).toBe(false);
  });
});

describe("opsFeed sensors — deaths / casualties", () => {
  it("emits a critical medical OpsEvent when the death count increases", () => {
    const previous = medicalWorld();
    const next = structuredClone(previous);
    next.domains.medical.outcomes.deaths_total = 1;

    const events = deriveOpsEvents(previous, next);
    const deathEvents = events.filter((e) => e.kind === "medical.deaths.reported");

    expect(deathEvents).toHaveLength(1);
    expect(deathEvents[0].sector).toBe("medical");
    expect(deathEvents[0].severity).toBe("critical");
    expect(deathEvents[0].summary).toBe("Ein Todesfall im medizinischen Sektor wurde gemeldet.");
    expect(deathEvents[0].visibility.auroraContext).toBe(true);
  });

  it("summarizes multiple new deaths in a single event", () => {
    const previous = medicalWorld();
    const next = structuredClone(previous);
    next.domains.medical.outcomes.deaths_total = 3;

    const [event] = deriveOpsEvents(previous, next).filter(
      (e) => e.kind === "medical.deaths.reported"
    );
    expect(event.summary).toBe("3 neue Todesfälle wurden im medizinischen Sektor gemeldet.");
  });

  it("emits no event when the death count is unchanged", () => {
    const previous = medicalWorld();
    const next = structuredClone(previous);

    expect(deriveOpsEvents(previous, next).filter((e) => e.kind === "medical.deaths.reported")).toHaveLength(
      0
    );
  });
});

describe("opsFeed sensors — medical hospital overload", () => {
  it("emits a critical medical event when a hospital crosses into overloaded", () => {
    // 90/100 = 90% (strained) → 118/100 = 118% (overloaded)
    const previous = setHospitalOccupied(medicalWorld(), "hospital-east-04", 90);
    const next = setHospitalOccupied(previous, "hospital-east-04", 118);

    const events = deriveOpsEvents(previous, next).filter((e) =>
      e.kind.startsWith("medical.hospital.")
    );
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("medical.hospital.overloaded");
    expect(events[0].sector).toBe("medical");
    expect(events[0].severity).toBe("critical");
    expect(events[0].summary).toBe("East Medical Center 04 ist kritisch ausgelastet.");
    expect(events[0].visibility.auroraContext).toBe(false);
  });

  it("emits no duplicate while a hospital remains overloaded", () => {
    const previous = setHospitalOccupied(medicalWorld(), "hospital-east-04", 118);
    const next = setHospitalOccupied(previous, "hospital-east-04", 130);

    expect(
      deriveOpsEvents(previous, next).filter((e) => e.kind.startsWith("medical.hospital."))
    ).toHaveLength(0);
  });

  it("emits a success medical event when a hospital recovers", () => {
    const previous = setHospitalOccupied(medicalWorld(), "hospital-east-04", 118);
    const next = setHospitalOccupied(previous, "hospital-east-04", 50);

    const [event] = deriveOpsEvents(previous, next).filter((e) =>
      e.kind.startsWith("medical.hospital.")
    );
    expect(event.kind).toBe("medical.hospital.recovered");
    expect(event.severity).toBe("success");
    expect(event.summary).toBe("East Medical Center 04 hat sich normalisiert.");
  });
});

describe("opsFeed sensors — energy node transitions", () => {
  it("emits an energy event when a node crosses into critical", () => {
    const previous = energyWorld(); // grid-east-3 starts "strained"
    const next = structuredClone(previous);
    next.domains.energy!.nodes["grid-east-3"].status = "critical";

    const events = deriveOpsEvents(previous, next).filter((e) => e.kind.startsWith("energy.node."));
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("energy.node.critical");
    expect(events[0].sector).toBe("energy");
    expect(events[0].severity).toBe("critical");
    expect(events[0].summary).toBe("East Distribution Node 3 ist kritisch belastet.");
  });

  it("emits a critical event when a node goes offline", () => {
    const previous = energyWorld();
    const next = structuredClone(previous);
    next.domains.energy!.nodes["grid-east-3"].status = "offline";

    const [event] = deriveOpsEvents(previous, next).filter((e) => e.kind.startsWith("energy.node."));
    expect(event.kind).toBe("energy.node.offline");
    expect(event.severity).toBe("critical");
    expect(event.summary).toBe("East Distribution Node 3 ist ausgefallen.");
  });

  it("emits a success energy event when a node recovers to nominal", () => {
    const previous = energyWorld();
    previous.domains.energy!.nodes["grid-east-3"].status = "critical";
    const next = structuredClone(previous);
    next.domains.energy!.nodes["grid-east-3"].status = "nominal";

    const [event] = deriveOpsEvents(previous, next).filter((e) => e.kind.startsWith("energy.node."));
    expect(event.severity).toBe("success");
    expect(event.summary).toBe("East Distribution Node 3 kehrt in den sicheren Bereich zurück.");
  });

  it("emits no duplicate while a node stays critical", () => {
    const previous = energyWorld();
    previous.domains.energy!.nodes["grid-east-3"].status = "critical";
    const next = structuredClone(previous);

    expect(deriveOpsEvents(previous, next).filter((e) => e.kind.startsWith("energy.node."))).toHaveLength(
      0
    );
  });
});

describe("opsFeed sensors — energy consumer transitions", () => {
  it("emits a warning when a consumer is reduced", () => {
    const previous = energyWorld();
    const next = structuredClone(previous);
    next.domains.energy!.consumers["consumer-medical-east"].status = "reduced";

    const [event] = deriveOpsEvents(previous, next).filter((e) =>
      e.kind.startsWith("energy.consumer.")
    );
    expect(event.severity).toBe("warning");
    expect(event.summary).toBe("Medical East wird reduziert versorgt.");
  });

  it("mirrors a human-life consumer going offline into the auroraContext", () => {
    const previous = energyWorld();
    const next = structuredClone(previous);
    next.domains.energy!.consumers["consumer-medical-east"].status = "offline";

    const [event] = deriveOpsEvents(previous, next).filter((e) =>
      e.kind.startsWith("energy.consumer.")
    );
    expect(event.severity).toBe("critical");
    expect(event.visibility.auroraContext).toBe(true);
  });
});

describe("opsFeed sensors — global outcome transitions", () => {
  it("emits a system OpsEvent when the global risk changes", () => {
    const previous = energyWorld(); // global_risk: stable
    const next = structuredClone(previous);
    next.outcomes.global_risk = "critical";

    const events = deriveOpsEvents(previous, next).filter((e) =>
      e.kind.startsWith("system.global_risk.")
    );
    expect(events).toHaveLength(1);
    expect(events[0].sector).toBe("system");
    expect(events[0].severity).toBe("critical");
    expect(events[0].summary).toBe("Die Gesamtlage ist kritisch.");
    expect(events[0].visibility.auroraContext).toBe(true);
  });

  it("emits no event when the global risk is unchanged", () => {
    const previous = energyWorld();
    const next = structuredClone(previous);

    expect(
      deriveOpsEvents(previous, next).filter((e) => e.kind.startsWith("system.global_risk."))
    ).toHaveLength(0);
  });
});

describe("opsFeed sensors — fan-out and projections", () => {
  it("appendDerivedOpsEvents pushes auroraContext=true events into the auroraContext", () => {
    const state = createInitialGameRuntimeState(medicalWorld());
    const previous = state.world;
    const next = structuredClone(previous);
    next.domains.medical.outcomes.deaths_total = 1; // death → auroraContext: true

    const contextBefore = state.auroraContext.length;
    const result = appendDerivedOpsEvents(state, previous, next);

    expect(result.auroraContext.length).toBe(contextBefore + 1);
    const mirror = result.auroraContext[result.auroraContext.length - 1];
    expect(mirror.kind).toBe("system_event");
  });

  it("appendDerivedOpsEvents keeps auroraContext=false events out of the auroraContext", () => {
    const state = createInitialGameRuntimeState(energyWorld());
    const previous = state.world;
    const next = structuredClone(previous);
    next.domains.energy!.nodes["grid-east-3"].status = "critical"; // operator/workspace only

    const contextBefore = state.auroraContext.length;
    const feedBefore = state.opsFeed.length;
    const result = appendDerivedOpsEvents(state, previous, next);

    expect(result.opsFeed.length).toBe(feedBefore + 1);
    expect(result.auroraContext.length).toBe(contextBefore);
  });

  it("sensor events appear in the UI Log and the sector workspace log", () => {
    const state = createInitialGameRuntimeState(energyWorld());
    const previous = state.world;
    const next = structuredClone(previous);
    next.domains.energy!.nodes["grid-east-3"].status = "critical";

    const result = appendDerivedOpsEvents(state, previous, next);

    const uiLines = buildOpsFeedLines(result.opsFeed);
    expect(uiLines.some((line) => line.summary.includes("kritisch belastet"))).toBe(true);

    const energyLog = renderSectorLog(result.opsFeed, "energy", result.world.clock.scenario_time);
    expect(energyLog).toContain("East Distribution Node 3 ist kritisch belastet.");
    // Sektor-Trennung: das Energy-Event landet nicht im system/medical-Log.
    expect(
      renderSectorLog(result.opsFeed, "system", result.world.clock.scenario_time)
    ).not.toContain("East Distribution Node 3");
  });

  it("leaks no hidden simulation fields into sensor events or workspace logs", () => {
    const state = createInitialGameRuntimeState(energyWorld());
    const previous = state.world;
    const next = structuredClone(previous);
    next.domains.energy!.nodes["grid-east-3"].status = "critical";
    next.domains.energy!.consumers["consumer-medical-east"].status = "offline";
    next.incidents["GRID-1182"].status = "escalated";
    next.outcomes.global_risk = "critical";

    const result = appendDerivedOpsEvents(state, previous, next);
    const serializedFeed = JSON.stringify(result.opsFeed);
    const serializedLogs = JSON.stringify(
      buildWorkspaceLogFiles(result.opsFeed, result.world.clock.scenario_time)
    );

    for (const blob of [serializedFeed, serializedLogs]) {
      expect(blob).not.toContain("routing_failures");
      expect(blob).not.toContain("stable_ticks");
      expect(blob).not.toContain("deaths_recorded");
      expect(blob).not.toContain("grid_instability");
      expect(blob).not.toContain("simulation");
      expect(blob).not.toContain("safe_capacity");
      expect(blob).not.toContain("patch");
    }
  });

  it("does not mutate the input worlds", () => {
    const previous = energyWorld();
    const next = structuredClone(previous);
    next.domains.energy!.nodes["grid-east-3"].status = "critical";

    const previousSnapshot = JSON.stringify(previous);
    const nextSnapshot = JSON.stringify(next);
    deriveOpsEvents(previous, next);

    expect(JSON.stringify(previous)).toBe(previousSnapshot);
    expect(JSON.stringify(next)).toBe(nextSnapshot);
  });
});

describe("opsFeed sensors — integration through the tick/outcome pipeline", () => {
  it("emits an energy node escalation exactly once across ticks (no duplicate)", () => {
    let state = createInitialGameRuntimeState(energyWorld());

    // grid-east-3 startet "strained" und eskaliert, sobald grid_instability 4
    // erreicht (Tick 4). Danach bleibt der Knoten kritisch → kein weiteres Event.
    for (let i = 0; i < 6; i++) {
      state = advanceTick(state);
    }

    const criticalNodeEvents = state.opsFeed.filter((e) => e.kind === "energy.node.critical");
    expect(criticalNodeEvents).toHaveLength(1);

    // Der zugehörige Incident-Statuswechsel open→escalated erscheint ebenfalls
    // genau einmal.
    expect(state.opsFeed.filter((e) => e.kind === "incident.status.escalated")).toHaveLength(1);
  });

  it("emits a medical death OpsEvent once and not again on re-evaluation", () => {
    let state = createInitialGameRuntimeState(structuredClone(me7741World), me7741ScenarioSignals);

    for (let i = 0; i < 3; i++) {
      state = advanceTick(state);
    }
    state = evaluateOutcomes(state);

    expect(state.opsFeed.filter((e) => e.kind === "medical.deaths.reported")).toHaveLength(1);
    // Eskalation des Incidents durch den ersten Todesfall.
    expect(state.opsFeed.filter((e) => e.kind === "incident.status.escalated")).toHaveLength(1);

    const feedBefore = state.opsFeed.length;
    state = evaluateOutcomes(state);
    // Erneute Auswertung ist idempotent — keine neuen Sensor-Events.
    expect(state.opsFeed.length).toBe(feedBefore);
  });

  it("emits a system global-risk OpsEvent when outcomes worsen", () => {
    let state = createInitialGameRuntimeState(structuredClone(me7741World), me7741ScenarioSignals);

    for (let i = 0; i < 3; i++) {
      state = advanceTick(state);
    }
    state = evaluateOutcomes(state);

    const globalEvents = state.opsFeed.filter((e) => e.kind.startsWith("system.global_risk."));
    expect(globalEvents.length).toBeGreaterThanOrEqual(1);
    expect(globalEvents[0].sector).toBe("system");
  });
});
