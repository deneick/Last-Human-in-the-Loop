import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import type { GameRuntimeState } from "../../runtime/runtimeState";
import { createInitialGameRuntimeState } from "../../runtime/runtimeState";
import { activateServer, isServerActive, mcpToolKey } from "../../mcp/mcpRegistry";
import { MEDICAL_EAST_MCP_SERVER_ID } from "../../mcp/medicalEastMcp";
import { allow_always, allow_once, deny } from "../../runtime/permissions";
import { enqueueAuroraRequest, mcpToolRequest, processAuroraQueue, resolveAuroraApproval } from "../../runtime/auroraQueue";
import { runAuroraAgentStep } from "../../aurora/agent";
import { buildAuroraModelRequest } from "../../aurora/contextBuilder";
import { FakeModelClient, textResponse, toolCallResponse } from "../../aurora/fakeModelClient";
import { BASH_TOOL_NAME, mcpToolFunctionName } from "../../aurora/toolSchema";
import { createTestEnv } from "../helpers/testEnv";

const env = createTestEnv();

function freshState(): GameRuntimeState {
  return createInitialGameRuntimeState(structuredClone(initialWorldState));
}

function stateWithMedicalEastActive(): GameRuntimeState {
  const state = freshState();
  return { ...state, mcp: activateServer(state.mcp, MEDICAL_EAST_MCP_SERVER_ID) };
}

describe("runAuroraAgentStep", () => {
  it("1. a text-only AURORA response is appended without creating a queue item", async () => {
    const state = freshState();
    const client = new FakeModelClient([textResponse("Lage beobachtet, aktuell keine Aktion nötig.")]);

    const { runtimeState, response } = await runAuroraAgentStep(state, env, client);

    expect(response.toolCalls).toHaveLength(0);
    expect(runtimeState.auroraQueue.items).toHaveLength(0);
    expect(runtimeState.scenario?.agentMessages).toEqual([
      { id: "agent-1", tick: state.world.clock.tick, text: "Lage beobachtet, aktuell keine Aktion nötig." },
    ]);
  });

  it('2. bash("mcp add medical-east-mcp") creates a permission request', async () => {
    const state = freshState();
    const client = new FakeModelClient([
      toolCallResponse(BASH_TOOL_NAME, { command: `mcp add ${MEDICAL_EAST_MCP_SERVER_ID}` }),
    ]);

    const { runtimeState } = await runAuroraAgentStep(state, env, client);

    expect(runtimeState.auroraQueue.items).toHaveLength(1);
    const item = runtimeState.auroraQueue.items[0];
    expect(item.status).toBe("awaiting_approval");
    expect(item.access).toBe("write");
    expect(item.request).toEqual({ kind: "bash", command: `mcp add ${MEDICAL_EAST_MCP_SERVER_ID}` });
    expect(isServerActive(runtimeState.mcp, MEDICAL_EAST_MCP_SERVER_ID)).toBe(false);
  });

  it('3. approving "mcp add medical-east-mcp" activates the MCP server', async () => {
    const state = freshState();
    const client = new FakeModelClient([
      toolCallResponse(BASH_TOOL_NAME, { command: `mcp add ${MEDICAL_EAST_MCP_SERVER_ID}` }),
    ]);

    const { runtimeState: afterRequest } = await runAuroraAgentStep(state, env, client);

    const approved = resolveAuroraApproval(
      afterRequest.auroraQueue,
      env,
      afterRequest.world,
      afterRequest.mcp,
      afterRequest.permissions,
      allow_once()
    );

    expect(approved.results).toHaveLength(1);
    expect(approved.results[0].success).toBe(true);
    expect(approved.queueState.items[0].status).toBe("executed");
    expect(isServerActive(approved.mcpState, MEDICAL_EAST_MCP_SERVER_ID)).toBe(true);
  });

  it("4. after activation, medical MCP tools are included in the available tool schemas", async () => {
    const state = freshState();
    const client = new FakeModelClient([
      toolCallResponse(BASH_TOOL_NAME, { command: `mcp add ${MEDICAL_EAST_MCP_SERVER_ID}` }),
    ]);

    const { runtimeState: afterRequest } = await runAuroraAgentStep(state, env, client);
    const approved = resolveAuroraApproval(
      afterRequest.auroraQueue,
      env,
      afterRequest.world,
      afterRequest.mcp,
      afterRequest.permissions,
      allow_once()
    );

    const request = buildAuroraModelRequest({
      world: afterRequest.world,
      mcpRegistry: env.mcpRegistry,
      mcpState: approved.mcpState,
      auroraQueue: approved.queueState,
      scenario: afterRequest.scenario,
    });

    const names = request.tools.map((tool) => tool.function.name);
    expect(names).toContain(mcpToolFunctionName(MEDICAL_EAST_MCP_SERVER_ID, "capacity_list"));
    expect(names).toContain(mcpToolFunctionName(MEDICAL_EAST_MCP_SERVER_ID, "routing_override_set"));
  });

  it("5. the first MCP tool call creates a permission request", async () => {
    const state = stateWithMedicalEastActive();
    const client = new FakeModelClient([
      toolCallResponse(mcpToolFunctionName(MEDICAL_EAST_MCP_SERVER_ID, "capacity_list"), {}),
    ]);

    const { runtimeState } = await runAuroraAgentStep(state, env, client);

    expect(runtimeState.auroraQueue.items).toHaveLength(1);
    const item = runtimeState.auroraQueue.items[0];
    expect(item.status).toBe("awaiting_approval");
    expect(item.access).toBe("read");
    expect(item.request).toEqual({
      kind: "mcp_tool",
      call: { serverId: MEDICAL_EAST_MCP_SERVER_ID, toolName: "capacity_list", input: {} },
    });
  });

  it("6. allow once executes the pending MCP tool call", async () => {
    const state = stateWithMedicalEastActive();
    const client = new FakeModelClient([
      toolCallResponse(mcpToolFunctionName(MEDICAL_EAST_MCP_SERVER_ID, "capacity_list"), {
        region: "medical-east",
      }),
    ]);

    const { runtimeState } = await runAuroraAgentStep(state, env, client);

    const approved = resolveAuroraApproval(
      runtimeState.auroraQueue,
      env,
      runtimeState.world,
      runtimeState.mcp,
      runtimeState.permissions,
      allow_once()
    );

    expect(approved.results).toHaveLength(1);
    expect(approved.results[0].success).toBe(true);
    expect(approved.queueState.items[0].status).toBe("executed");
  });

  it("7. allow always permits later calls for the exact same tool key without approval", async () => {
    const state = stateWithMedicalEastActive();
    const toolName = mcpToolFunctionName(MEDICAL_EAST_MCP_SERVER_ID, "capacity_list");
    const client = new FakeModelClient([toolCallResponse(toolName, { region: "medical-east" })]);

    const { runtimeState } = await runAuroraAgentStep(state, env, client);

    const approved = resolveAuroraApproval(
      runtimeState.auroraQueue,
      env,
      runtimeState.world,
      runtimeState.mcp,
      runtimeState.permissions,
      allow_always()
    );

    expect(
      approved.permissionState.allowAlwaysMcpToolKeys.has(
        mcpToolKey(MEDICAL_EAST_MCP_SERVER_ID, "capacity_list")
      )
    ).toBe(true);

    const secondQueue = enqueueAuroraRequest(
      mcpToolRequest(MEDICAL_EAST_MCP_SERVER_ID, "capacity_list", { region: "medical-east" }),
      approved.queueState,
      runtimeState.world.clock.tick + 1
    );
    const secondProcessed = processAuroraQueue(
      secondQueue,
      env,
      runtimeState.world,
      approved.mcpState,
      approved.permissionState
    );

    expect(secondProcessed.results).toHaveLength(1);
    expect(secondProcessed.results[0].success).toBe(true);
    expect(secondProcessed.queueState.items[1].status).toBe("executed");
  });

  it("8. deny returns a denied result and does not execute the tool", async () => {
    const state = stateWithMedicalEastActive();
    const toolName = mcpToolFunctionName(MEDICAL_EAST_MCP_SERVER_ID, "routing_override_set");
    const client = new FakeModelClient([
      toolCallResponse(toolName, {
        source: "hospital-east-04",
        target: "hospital-east-09",
        priority: "P2",
        capability: "TRAUMA",
      }),
    ]);

    const { runtimeState } = await runAuroraAgentStep(state, env, client);

    const denied = resolveAuroraApproval(
      runtimeState.auroraQueue,
      env,
      runtimeState.world,
      runtimeState.mcp,
      runtimeState.permissions,
      deny()
    );

    expect(denied.queueState.items[0].status).toBe("denied");
    expect(denied.results[0].success).toBe(false);
    expect(denied.results[0].error).toContain("denied");
    expect(denied.results[0].patch).toBeUndefined();
  });

  it("AURORA continues after a denial: the next step sees the denial and can respond", async () => {
    const state = stateWithMedicalEastActive();
    const toolName = mcpToolFunctionName(MEDICAL_EAST_MCP_SERVER_ID, "routing_override_set");
    const client = new FakeModelClient([
      toolCallResponse(toolName, {
        source: "hospital-east-04",
        target: "hospital-east-09",
        priority: "P2",
        capability: "TRAUMA",
      }),
      textResponse("Verstanden, Override-Anfrage wurde abgelehnt. Ich warte auf weitere Anweisungen."),
    ]);

    const { runtimeState: afterRequest } = await runAuroraAgentStep(state, env, client);
    const denied = resolveAuroraApproval(
      afterRequest.auroraQueue,
      env,
      afterRequest.world,
      afterRequest.mcp,
      afterRequest.permissions,
      deny()
    );

    const nextState: GameRuntimeState = {
      ...afterRequest,
      auroraQueue: denied.queueState,
      permissions: denied.permissionState,
      mcp: denied.mcpState,
    };

    // Die Ablehnung erscheint als Tool-Result in AURORAs nächstem Kontext.
    const request = buildAuroraModelRequest({
      world: nextState.world,
      mcpRegistry: env.mcpRegistry,
      mcpState: nextState.mcp,
      auroraQueue: nextState.auroraQueue,
      scenario: nextState.scenario,
    });
    const toolResultMessage = request.messages.find((message) => message.role === "tool");
    expect(toolResultMessage).toBeDefined();
    expect(JSON.parse((toolResultMessage as { content: string }).content)).toMatchObject({
      success: false,
      denied: true,
    });

    const { runtimeState: afterDenial, response } = await runAuroraAgentStep(nextState, env, client);

    expect(response.toolCalls).toHaveLength(0);
    expect(afterDenial.scenario?.agentMessages?.at(-1)?.text).toBe(
      "Verstanden, Override-Anfrage wurde abgelehnt. Ich warte auf weitere Anweisungen."
    );
  });
});
