import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import {
  appendContextEvent,
  appendOperatorMessage,
  createInitialGameRuntimeState,
} from "../../runtime/runtimeState";
import {
  auroraResponseEvent,
  initialIncidentSignalEvents,
  operatorMessageEvent,
} from "../../runtime/auroraContext";
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
  it("seeds the initial incident signals exactly once at runtime initialization", () => {
    const state = freshState();

    const signals = initialWorldState.incidents["ME-7741"].public_signals;
    expect(state.auroraContext).toEqual(
      signals.map((signal) => ({
        kind: "incident_signal",
        tick: signal.first_seen_at_tick,
        incidentId: "ME-7741",
        code: signal.code,
        text: signal.message,
      }))
    );
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

  it("initialIncidentSignalEvents sorts signals by their first_seen_at_tick", () => {
    const world = structuredClone(initialWorldState);
    world.incidents["ME-7741"].public_signals = [
      { code: "later", message: "Späteres Signal", first_seen_at_tick: 3 },
      { code: "earlier", message: "Früheres Signal", first_seen_at_tick: 1 },
    ];

    const events = initialIncidentSignalEvents(world);
    expect(events.map((event) => event.tick)).toEqual([1, 3]);
  });
});
