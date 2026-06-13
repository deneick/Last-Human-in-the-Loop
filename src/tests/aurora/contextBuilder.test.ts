import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import { me7741ScenarioSignals } from "../../scenarios/me7741/scenarioSignals";
import { activateServer, createInitialMcpRuntimeState } from "../../mcp/mcpRegistry";
import { MEDICAL_EAST_MCP_SERVER_ID } from "../../mcp/medicalEastMcp";
import { mcpToolRequest } from "../../runtime/auroraQueue";
import {
  auroraResponseEvent,
  operatorMessageEvent,
  systemEvent,
  toolResultEvent,
  type AuroraContextEvent,
} from "../../runtime/auroraContext";
import { createInitialGameRuntimeState } from "../../runtime/runtimeState";
import { runReplayStep } from "../../runtime/replay";
import { buildAuroraModelRequest, type AuroraContextInput } from "../../aurora/contextBuilder";
import { BASH_TOOL_NAME, mcpToolFunctionName } from "../../aurora/toolSchema";
import { createTestEnv } from "../helpers/testEnv";

const env = createTestEnv();

function baseInput(
  events: AuroraContextEvent[] = [],
  mcpState = createInitialMcpRuntimeState()
): AuroraContextInput {
  return {
    events,
    mcpRegistry: env.mcpRegistry,
    mcpState,
  };
}

describe("buildAuroraModelRequest", () => {
  it("includes the AURORA system prompt and serializes the initial situation signals", () => {
    // Die Startsignale (emitAtTick: 0, visibility.auroraContext: true) erreichen
    // den auroraContext ausschließlich über die opsFeed-Projektion als
    // system_event — es gibt keinen eigenen Incident-Signal-Kanal mehr.
    const state = createInitialGameRuntimeState(
      structuredClone(initialWorldState),
      me7741ScenarioSignals
    );
    const request = buildAuroraModelRequest(baseInput(state.auroraContext));

    expect(request.systemPrompt).toContain("AURORA");
    expect(me7741ScenarioSignals.length).toBeGreaterThan(0);

    for (const signal of me7741ScenarioSignals) {
      expect(request.messages.some((message) => message.content.includes(signal.summary))).toBe(
        true
      );
    }
  });

  it("serializes only AuroraContextEvents — no other history source exists", () => {
    // Eine Welt mit Incident-Signalen, aber ein leeres Event-Log: Der
    // Request darf NICHTS davon enthalten, weil nur Events zählen.
    const request = buildAuroraModelRequest(baseInput([]));

    expect(request.messages).toEqual([]);
  });

  it("does not read auroraQueue.items as history", () => {
    // Eine ausgeführte Queue ohne tool_result-Events: Der Builder kennt die
    // Queue nicht — kein Tool-Result darf im Request auftauchen.
    let state = createInitialGameRuntimeState(structuredClone(initialWorldState));
    state = { ...state, mcp: activateServer(state.mcp, MEDICAL_EAST_MCP_SERVER_ID) };
    state = runReplayStep(state, env, {
      actor: "aurora",
      request: mcpToolRequest(MEDICAL_EAST_MCP_SERVER_ID, "capacity_list", { region: "east" }),
    });
    state = runReplayStep(state, env, { actor: "aurora", decision: "allow_once" });

    expect(state.auroraQueue.items).toHaveLength(1);
    expect(state.auroraQueue.items[0].status).toBe("executed");

    // Builder bekommt absichtlich ein Event-Log OHNE die Tool-Events.
    const eventsWithoutToolHistory = state.auroraContext.filter(
      (event) => event.kind !== "aurora_response" && event.kind !== "tool_result"
    );
    const request = buildAuroraModelRequest(baseInput(eventsWithoutToolHistory, state.mcp));

    expect(request.messages.some((message) => message.role === "tool")).toBe(false);
    expect(request.messages.some((message) => message.role === "assistant")).toBe(false);

    // Mit den Events erscheinen Tool-Call und Tool-Result — die Queue selbst
    // bleibt für den Builder unsichtbar.
    const fullRequest = buildAuroraModelRequest(baseInput(state.auroraContext, state.mcp));
    expect(fullRequest.messages.some((message) => message.role === "tool")).toBe(true);
  });

  it("only offers bash before any MCP server is activated", () => {
    const request = buildAuroraModelRequest(baseInput());

    const names = request.tools.map((tool) => tool.function.name);
    expect(names).toEqual([BASH_TOOL_NAME]);
    expect(names).not.toContain(mcpToolFunctionName(MEDICAL_EAST_MCP_SERVER_ID, "capacity_list"));
  });

  it("includes active MCP server tools as mcp__<server>__<tool> schemas", () => {
    const mcpState = activateServer(createInitialMcpRuntimeState(), MEDICAL_EAST_MCP_SERVER_ID);
    const request = buildAuroraModelRequest(baseInput([], mcpState));

    const names = request.tools.map((tool) => tool.function.name);
    expect(names).toContain(BASH_TOOL_NAME);
    expect(names).toContain(mcpToolFunctionName(MEDICAL_EAST_MCP_SERVER_ID, "capacity_list"));
    expect(names).toContain(mcpToolFunctionName(MEDICAL_EAST_MCP_SERVER_ID, "routing_override_set"));
  });

  it("exposes per-tool JSON parameter schemas for active MCP tools", () => {
    const mcpState = activateServer(createInitialMcpRuntimeState(), MEDICAL_EAST_MCP_SERVER_ID);
    const request = buildAuroraModelRequest(baseInput([], mcpState));

    const capacityList = request.tools.find(
      (tool) => tool.function.name === mcpToolFunctionName(MEDICAL_EAST_MCP_SERVER_ID, "capacity_list")
    );
    expect(capacityList?.function.parameters).toMatchObject({
      type: "object",
      required: ["region"],
      additionalProperties: false,
    });

    const overrideSet = request.tools.find(
      (tool) =>
        tool.function.name === mcpToolFunctionName(MEDICAL_EAST_MCP_SERVER_ID, "routing_override_set")
    );
    const overrideProperties = (overrideSet?.function.parameters as {
      properties: Record<string, { enum?: string[] }>;
      required: string[];
    });
    expect(overrideProperties.required).toEqual(["source", "target", "priority", "capability"]);
    expect(overrideProperties.properties.priority.enum).toEqual(["P1", "P2", "P3", "P4"]);
    expect(overrideProperties.properties.capability.enum).toEqual(["GEN", "TRAUMA", "NEURO", "PED"]);
  });

  it("never serializes the hidden simulation state or world.simulation fields", () => {
    // Voller Spielzug über Runtime-Pfade: Context-Events entstehen nur aus
    // modell-sichtbaren Inhalten.
    let state = createInitialGameRuntimeState(structuredClone(initialWorldState));
    state = { ...state, mcp: activateServer(state.mcp, MEDICAL_EAST_MCP_SERVER_ID) };
    state = runReplayStep(state, env, {
      actor: "aurora",
      request: mcpToolRequest(MEDICAL_EAST_MCP_SERVER_ID, "capacity_list", { region: "east" }),
    });
    state = runReplayStep(state, env, { actor: "aurora", decision: "allow_once" });

    const request = buildAuroraModelRequest(baseInput(state.auroraContext, state.mcp));
    const serialized = JSON.stringify(request);

    expect(serialized).not.toContain("routing_failures");
    expect(serialized).not.toContain("deaths_recorded");
    expect(serialized).not.toContain("stable_ticks");
    expect(serialized).not.toContain("mismatch_ticks");
    expect(serialized).not.toContain("excess_cases_per_tick");
    expect(serialized).not.toContain("overflow_cases");
    expect(serialized).not.toContain("clearance_per_tick");
    expect(serialized).not.toMatch(/"simulation"\s*:/);
  });

  it("includes operator chat messages as plain user messages without a source prefix", () => {
    const request = buildAuroraModelRequest(
      baseInput([operatorMessageEvent(5, "Status-Update bitte.")])
    );

    expect(request.messages).toEqual([{ role: "user", content: "Status-Update bitte." }]);
  });

  it("preserves the exact append order of events — even within the same tick", () => {
    const events: AuroraContextEvent[] = [
      systemEvent(0, "Signal A"),
      operatorMessageEvent(5, "Operator-Chat-Nachricht"),
      auroraResponseEvent(5, "", [
        { id: "aurora-1", name: BASH_TOOL_NAME, arguments: { command: "mcp list" } },
      ]),
      toolResultEvent(5, "aurora-1", BASH_TOOL_NAME, { success: true, output: {} }),
      auroraResponseEvent(5, "AURORA-Text-Antwort"),
      systemEvent(5, "Lage-Update aus dem System-Feed"),
    ];

    const request = buildAuroraModelRequest(baseInput(events));

    expect(request.messages.map((message) => message.role)).toEqual([
      "user",
      "user",
      "assistant",
      "tool",
      "assistant",
      "user",
    ]);
    expect(request.messages[1].content).toBe("Operator-Chat-Nachricht");
    expect(request.messages[4]).toMatchObject({
      role: "assistant",
      content: "AURORA-Text-Antwort",
    });
    expect(request.messages[5].content).toBe("[SYSTEM EVENT] Lage-Update aus dem System-Feed");
  });
});
