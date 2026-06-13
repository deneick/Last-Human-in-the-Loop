import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import { createInitialGameRuntimeState } from "../../runtime/runtimeState";
import {
  appendOpsEvent,
  buildWorkspaceFiles,
  buildWorkspaceLogFiles,
  renderSectorLog,
  workspaceLogPathForSector,
  type OpsEventInput,
} from "../../runtime/opsFeed";
import { executeBashCommand } from "../../runtime/bashCommands";
import {
  applyAuroraExecutionResult,
  executePlayerBashCommand,
  executePlayerDomainAction,
} from "../../runtime/runtimeExecutor";
import { createDomainActionRegistry } from "../../domain";
import { createDefaultMcpRegistry } from "../../mcp";
import { MEDICAL_EAST_MCP_SERVER_ID } from "../../mcp/medicalEastMcp";
import { mcpToolRequest } from "../../runtime/auroraQueue";
import { SAFE_OVERRIDE_ACTION } from "../helpers/testEnv";

function freshState() {
  return createInitialGameRuntimeState(structuredClone(initialWorldState));
}

const OPERATOR_ONLY: OpsEventInput["visibility"] = {
  operator: true,
  auroraContext: false,
  workspace: true,
};

describe("opsFeed foundation", () => {
  it("initializes GameRuntimeState with an opsFeed from public situation signals", () => {
    const state = freshState();

    expect(Array.isArray(state.opsFeed)).toBe(true);
    expect(state.opsFeed.length).toBe(
      initialWorldState.incidents["ME-7741"].public_signals.length
    );
    // Startsignale sind operator- und workspace-sichtbar, aber nicht erneut
    // in den auroraContext gespiegelt (das erledigt initialIncidentSignalEvents).
    expect(state.opsFeed.every((event) => event.visibility.operator)).toBe(true);
    expect(state.opsFeed.every((event) => event.visibility.auroraContext === false)).toBe(true);
    expect(state.opsFeed[0].summary).toBe(
      "Emergency intake pressure rising at hospital-east-04"
    );
  });

  it("appendOpsEvent appends to opsFeed with a stable id and the current tick", () => {
    const state = freshState();
    const before = state.opsFeed.length;

    const next = appendOpsEvent(state, {
      sector: "system",
      severity: "info",
      kind: "test.event",
      summary: "Testereignis",
      visibility: OPERATOR_ONLY,
    });

    expect(next.opsFeed.length).toBe(before + 1);
    const appended = next.opsFeed[next.opsFeed.length - 1];
    expect(appended.id).toBe(`ops-${before + 1}`);
    expect(appended.tick).toBe(state.world.clock.tick);
    expect(appended.summary).toBe("Testereignis");
  });

  it("visibility.auroraContext=true appends a corresponding auroraContext event", () => {
    const state = freshState();
    const contextBefore = state.auroraContext.length;

    const next = appendOpsEvent(state, {
      sector: "system",
      severity: "success",
      kind: "test.push",
      summary: "Push-Ereignis",
      details: "mit Details",
      visibility: { operator: true, auroraContext: true, workspace: true },
    });

    expect(next.auroraContext.length).toBe(contextBefore + 1);
    const mirror = next.auroraContext[next.auroraContext.length - 1];
    expect(mirror.kind).toBe("system_event");
    expect(mirror.kind === "system_event" && mirror.text).toBe("Push-Ereignis mit Details");
  });

  it("visibility.auroraContext=false does not touch the auroraContext", () => {
    const state = freshState();
    const contextBefore = state.auroraContext.length;

    const next = appendOpsEvent(state, {
      sector: "medical",
      severity: "info",
      kind: "test.pull",
      summary: "Nur Log",
      visibility: OPERATOR_ONLY,
    });

    expect(next.auroraContext.length).toBe(contextBefore);
    expect(next.opsFeed.length).toBe(state.opsFeed.length + 1);
  });

  it("visibility.workspace=true makes the event appear in the correct sector log", () => {
    let state = freshState();
    state = appendOpsEvent(state, {
      sector: "energy",
      severity: "warning",
      kind: "test.energy",
      summary: "East-04 ist kritisch ausgelastet.",
      visibility: { operator: false, auroraContext: false, workspace: true },
    });

    const energyLog = renderSectorLog(state.opsFeed, "energy");
    expect(energyLog).toContain("East-04 ist kritisch ausgelastet.");
    // Andere Sektor-Logs bleiben unberührt — ein Event gehört genau einem Sektor.
    expect(renderSectorLog(state.opsFeed, "medical")).not.toContain("East-04");
  });

  it("workspace=false keeps the event out of every sector log", () => {
    let state = freshState();
    const before = renderSectorLog(state.opsFeed, "system");
    state = appendOpsEvent(state, {
      sector: "system",
      severity: "info",
      kind: "test.hidden",
      summary: "Nicht im Workspace",
      visibility: { operator: true, auroraContext: false, workspace: false },
    });

    expect(renderSectorLog(state.opsFeed, "system")).toBe(before);
  });

  it("sector determines the workspace file path", () => {
    expect(workspaceLogPathForSector("system")).toBe("logs/system.log");
    expect(workspaceLogPathForSector("medical")).toBe("logs/medical.log");
    expect(workspaceLogPathForSector("energy")).toBe("logs/energy.log");

    const files = buildWorkspaceLogFiles([]);
    expect(Object.keys(files).sort()).toEqual([
      "logs/energy.log",
      "logs/medical.log",
      "logs/system.log",
    ]);
  });

  it("generated logs are deterministic, complete and formatted as [TICK n] [SEVERITY] summary", () => {
    let state = freshState();
    state = appendOpsEvent(state, {
      sector: "system",
      severity: "warning",
      kind: "a",
      summary: "East-04 ist kritisch ausgelastet.",
      tick: 5,
      visibility: { operator: true, auroraContext: false, workspace: true },
    });
    state = appendOpsEvent(state, {
      sector: "system",
      severity: "success",
      kind: "b",
      summary: "Routing-Override zeigt Wirkung.",
      tick: 6,
      visibility: { operator: true, auroraContext: false, workspace: true },
    });

    const first = renderSectorLog(state.opsFeed, "system");
    const second = renderSectorLog(state.opsFeed, "system");
    expect(first).toBe(second); // deterministisch
    expect(first).toBe(
      "[TICK 5] [WARNING] East-04 ist kritisch ausgelastet.\n" +
        "[TICK 6] [SUCCESS] Routing-Override zeigt Wirkung."
    );
  });

  it("makes logs/system.log, logs/medical.log and logs/energy.log discoverable via ls/cat/read_file", () => {
    let state = freshState();
    state = appendOpsEvent(state, {
      sector: "medical",
      severity: "info",
      kind: "test",
      summary: "Medical-Lageeintrag",
      visibility: { operator: true, auroraContext: false, workspace: true },
    });

    const mcpRegistry = createDefaultMcpRegistry();
    const env = { mcpRegistry, mcpState: state.mcp, workspaceFiles: buildWorkspaceFiles(state.opsFeed) };

    const ls = executeBashCommand("ls", env);
    const files = (ls.output as { files: string[] }).files;
    expect(files).toContain("logs/system.log");
    expect(files).toContain("logs/medical.log");
    expect(files).toContain("logs/energy.log");

    const cat = executeBashCommand("cat logs/medical.log", env);
    expect(cat.success).toBe(true);
    expect((cat.output as { content: string }).content).toContain("Medical-Lageeintrag");

    const read = executeBashCommand("read_file logs/system.log", env);
    expect(read.success).toBe(true);
  });

  it("no hidden simulation fields leak into opsFeed or generated workspace logs", () => {
    let state = freshState();

    // Ein erfolgreicher AURORA-Write trägt Patch + Action — beides darf NICHT
    // im opsFeed/Log auftauchen.
    state = applyAuroraExecutionResult(state, {
      success: true,
      itemId: "aurora-1",
      request: mcpToolRequest(MEDICAL_EAST_MCP_SERVER_ID, "routing_override_set", {}),
      description: "mcp call medical-east-mcp routing_override_set",
      access: "write",
      action: {
        type: "medical.routing.override.set",
        sourceHospitalId: "hospital-east-04",
        targetHospitalId: "hospital-east-09",
        priority: "P2",
        capability: "TRAUMA",
      },
      output: { ok: true },
      patch: [
        { op: "set", path: ["simulation", "medical", "routing_failures"], value: ["leak-marker"] },
      ],
    });

    const serializedFeed = JSON.stringify(state.opsFeed);
    const serializedLogs = JSON.stringify(buildWorkspaceLogFiles(state.opsFeed));

    for (const blob of [serializedFeed, serializedLogs]) {
      expect(blob).not.toContain("routing_failures");
      expect(blob).not.toContain("excess_cases_per_tick");
      expect(blob).not.toContain("stable_ticks");
      expect(blob).not.toContain("deaths_recorded");
      expect(blob).not.toContain("simulation");
      expect(blob).not.toContain("patch");
    }
  });
});

describe("opsFeed producers", () => {
  it("operator domain actions write an OpsEvent but do not push into auroraContext", () => {
    const registry = createDomainActionRegistry();
    const state = freshState();
    const contextBefore = state.auroraContext.length;
    const feedBefore = state.opsFeed.length;

    const { state: next, result } = executePlayerDomainAction(state, registry, SAFE_OVERRIDE_ACTION);

    expect(result.success).toBe(true);
    expect(next.opsFeed.length).toBe(feedBefore + 1);
    // Operator-Domain-Action: kein direkter Push in den auroraContext.
    expect(next.auroraContext.length).toBe(contextBefore);

    const event = next.opsFeed[next.opsFeed.length - 1];
    expect(event.sector).toBe("medical");
    expect(event.visibility).toEqual({ operator: true, auroraContext: false, workspace: true });
    expect(event.summary).toContain("Operator");
  });

  it("operator MCP server activation writes an OpsEvent and pushes to auroraContext", () => {
    const mcpRegistry = createDefaultMcpRegistry();
    const state = freshState();
    const contextBefore = state.auroraContext.length;

    const { state: next, result } = executePlayerBashCommand(
      state,
      mcpRegistry,
      `mcp add ${MEDICAL_EAST_MCP_SERVER_ID}`
    );

    expect(result.activatesServerId).toBe(MEDICAL_EAST_MCP_SERVER_ID);

    const event = next.opsFeed[next.opsFeed.length - 1];
    expect(event.sector).toBe("system");
    expect(event.visibility.auroraContext).toBe(true);
    expect(event.summary).toContain(MEDICAL_EAST_MCP_SERVER_ID);

    // auroraContext bekommt genau einen gespiegelten system_event.
    expect(next.auroraContext.length).toBe(contextBefore + 1);
    const mirror = next.auroraContext[next.auroraContext.length - 1];
    expect(mirror.kind).toBe("system_event");
  });
});
