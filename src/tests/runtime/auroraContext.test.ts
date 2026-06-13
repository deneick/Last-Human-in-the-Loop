import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import { me7741ScenarioSignals } from "../../scenarios/me7741/scenarioSignals";
import {
  appendContextEvent,
  appendOperatorMessage,
  createInitialGameRuntimeState,
} from "../../runtime/runtimeState";
import { auroraResponseEvent, operatorMessageEvent } from "../../runtime/auroraContext";
import { activateServer } from "../../mcp/mcpRegistry";
import { MEDICAL_EAST_MCP_SERVER_ID } from "../../mcp/medicalEastMcp";
import { mcpToolRequest } from "../../runtime/auroraQueue";
import { runReplayStep } from "../../runtime/replay";
import { createTestEnv } from "../helpers/testEnv";

const env = createTestEnv();

function freshState() {
  return createInitialGameRuntimeState(structuredClone(initialWorldState));
}

describe("AuroraContextEvents — append-only event log", () => {
  it("starts with an empty auroraContext when no scenario signals are seeded", () => {
    // Kein Direktpfad mehr in den auroraContext: Ohne Szenario-Signale ist der
    // Kontext beim Start leer.
    const state = freshState();
    expect(state.auroraContext).toEqual([]);
  });

  it("seeds initial situation signals into auroraContext only via the opsFeed projection", () => {
    const state = createInitialGameRuntimeState(
      structuredClone(initialWorldState),
      me7741ScenarioSignals
    );

    // Alle Startsignale (visibility.auroraContext: true) erscheinen als
    // gespiegelte system_events — nie als eigener incident_signal-Kind.
    expect(state.auroraContext).toHaveLength(me7741ScenarioSignals.length);
    expect(state.auroraContext.every((event) => event.kind === "system_event")).toBe(true);
    for (const signal of me7741ScenarioSignals) {
      expect(
        state.auroraContext.some(
          (event) => event.kind === "system_event" && event.text === signal.summary
        )
      ).toBe(true);
    }
  });

  it("preserves true append order within the same tick", () => {
    let state = freshState();
    state = appendOperatorMessage(state, "Erste Nachricht");
    state = appendContextEvent(state, auroraResponseEvent(0, "AURORA antwortet"));
    state = appendOperatorMessage(state, "Zweite Nachricht");

    const tail = state.auroraContext.slice(-3);
    expect(tail).toEqual([
      operatorMessageEvent(0, "Erste Nachricht"),
      auroraResponseEvent(0, "AURORA antwortet"),
      operatorMessageEvent(0, "Zweite Nachricht"),
    ]);
    // Alle drei Events teilen denselben Tick — die Reihenfolge ist die
    // Einfüge-Reihenfolge, keine Sortierung nach Quelle.
    expect(new Set(tail.map((event) => event.tick)).size).toBe(1);
  });

  it("appends a tool_result event when an approved tool call executes", () => {
    let state = freshState();
    state = { ...state, mcp: activateServer(state.mcp, MEDICAL_EAST_MCP_SERVER_ID) };
    state = runReplayStep(state, env, {
      actor: "aurora",
      request: mcpToolRequest(MEDICAL_EAST_MCP_SERVER_ID, "capacity_list", { region: "east" }),
    });
    state = runReplayStep(state, env, { actor: "aurora", decision: "allow_once" });

    const responseEvent = state.auroraContext.find((event) => event.kind === "aurora_response");
    const resultEvent = state.auroraContext.find((event) => event.kind === "tool_result");

    expect(responseEvent).toBeDefined();
    expect(resultEvent).toBeDefined();
    if (responseEvent?.kind !== "aurora_response" || resultEvent?.kind !== "tool_result") {
      throw new Error("unreachable");
    }

    expect(responseEvent.toolCalls).toHaveLength(1);
    expect(resultEvent.toolCallId).toBe(responseEvent.toolCalls[0].id);
    expect(resultEvent.toolName).toBe(responseEvent.toolCalls[0].name);
    expect(resultEvent.result.success).toBe(true);
    expect(resultEvent.result.denied).toBeUndefined();
  });

  it("appends a denied tool_result event when the operator denies a tool call", () => {
    let state = freshState();
    state = { ...state, mcp: activateServer(state.mcp, MEDICAL_EAST_MCP_SERVER_ID) };
    state = runReplayStep(state, env, {
      actor: "aurora",
      request: mcpToolRequest(MEDICAL_EAST_MCP_SERVER_ID, "routing_override_set", {
        source: "hospital-east-04",
        target: "hospital-east-09",
        priority: "P2",
        capability: "TRAUMA",
      }),
    });
    state = runReplayStep(state, env, { actor: "aurora", decision: "deny" });

    const resultEvent = state.auroraContext.find((event) => event.kind === "tool_result");
    expect(resultEvent).toBeDefined();
    if (resultEvent?.kind !== "tool_result") {
      throw new Error("unreachable");
    }

    expect(resultEvent.result).toMatchObject({ success: false, denied: true });
    expect(resultEvent.result.error).toContain("denied");
  });

  it("never produces an incident_signal event kind", () => {
    const state = createInitialGameRuntimeState(
      structuredClone(initialWorldState),
      me7741ScenarioSignals
    );
    const serialized = JSON.stringify(state.auroraContext);
    expect(serialized).not.toContain("incident_signal");
  });

  it("stores only model-visible content — no patches, actions or hidden state", () => {
    let state = freshState();
    state = { ...state, mcp: activateServer(state.mcp, MEDICAL_EAST_MCP_SERVER_ID) };
    state = runReplayStep(state, env, {
      actor: "aurora",
      request: mcpToolRequest(MEDICAL_EAST_MCP_SERVER_ID, "routing_override_set", {
        source: "hospital-east-04",
        target: "hospital-east-09",
        priority: "P2",
        capability: "TRAUMA",
      }),
    });
    state = runReplayStep(state, env, { actor: "aurora", decision: "allow_once" });

    const serialized = JSON.stringify(state.auroraContext);
    expect(serialized).not.toContain('"patch"');
    expect(serialized).not.toContain('"action"');
    expect(serialized).not.toContain("routing_failures");
    expect(serialized).not.toContain("deaths_recorded");
    expect(serialized).not.toMatch(/"simulation"\s*:/);
  });
});
