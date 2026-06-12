import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import { activateServer, createInitialMcpRuntimeState } from "../../mcp/mcpRegistry";
import { MEDICAL_EAST_MCP_SERVER_ID } from "../../mcp/medicalEastMcp";
import { createInitialAuroraQueueState } from "../../runtime/auroraQueue";
import { buildAuroraModelRequest } from "../../aurora/contextBuilder";
import { BASH_TOOL_NAME, mcpToolFunctionName } from "../../aurora/toolSchema";
import { createTestEnv } from "../helpers/testEnv";

const env = createTestEnv();

function baseInput(mcpState = createInitialMcpRuntimeState()) {
  return {
    world: initialWorldState,
    mcpRegistry: env.mcpRegistry,
    mcpState,
    auroraQueue: createInitialAuroraQueueState(),
  };
}

describe("buildAuroraModelRequest", () => {
  it("includes the AURORA system prompt and the public incident signals", () => {
    const request = buildAuroraModelRequest(baseInput());

    expect(request.systemPrompt).toContain("AURORA");

    const incident = initialWorldState.incidents["ME-7741"];
    expect(incident).toBeDefined();
    expect(incident.public_signals.length).toBeGreaterThan(0);

    for (const signal of incident.public_signals) {
      expect(request.messages.some((message) => message.content.includes(signal.message))).toBe(
        true
      );
    }
  });

  it("only offers bash before any MCP server is activated", () => {
    const request = buildAuroraModelRequest(baseInput());

    const names = request.tools.map((tool) => tool.function.name);
    expect(names).toEqual([BASH_TOOL_NAME]);
    expect(names).not.toContain(mcpToolFunctionName(MEDICAL_EAST_MCP_SERVER_ID, "capacity_list"));
  });

  it("includes active MCP server tools as mcp__<server>__<tool> schemas", () => {
    const mcpState = activateServer(createInitialMcpRuntimeState(), MEDICAL_EAST_MCP_SERVER_ID);
    const request = buildAuroraModelRequest(baseInput(mcpState));

    const names = request.tools.map((tool) => tool.function.name);
    expect(names).toContain(BASH_TOOL_NAME);
    expect(names).toContain(mcpToolFunctionName(MEDICAL_EAST_MCP_SERVER_ID, "capacity_list"));
    expect(names).toContain(mcpToolFunctionName(MEDICAL_EAST_MCP_SERVER_ID, "routing_override_set"));
  });

  it("never serializes the hidden simulation state or world.simulation fields", () => {
    const mcpState = activateServer(createInitialMcpRuntimeState(), MEDICAL_EAST_MCP_SERVER_ID);
    const request = buildAuroraModelRequest(baseInput(mcpState));

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
});
