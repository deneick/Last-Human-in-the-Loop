import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import type { GameRuntimeState } from "../../runtime/runtimeState";
import { appendOperatorMessage, createInitialGameRuntimeState } from "../../runtime/runtimeState";
import { activateServer, isServerActive, mcpToolKey } from "../../mcp/mcpRegistry";
import { MEDICAL_EAST_MCP_SERVER_ID } from "../../mcp/medicalEastMcp";
import { allow_always, allow_once, deny } from "../../runtime/permissions";
import { enqueueAuroraRequest, mcpToolRequest, processAuroraQueue, resolveAuroraApproval } from "../../runtime/auroraQueue";
import { applyAuroraExecutionResult } from "../../runtime/runtimeExecutor";
import { runAuroraAgentStep, sanitizeAuroraMessage } from "../../aurora/agent";
import { buildAuroraModelRequest } from "../../aurora/contextBuilder";
import { FakeModelClient, textResponse, toolCallResponse } from "../../aurora/fakeModelClient";
import type { ModelResponse, ModelToolCall } from "../../aurora/modelClient";
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

function lastAuroraResponse(state: GameRuntimeState) {
  const event = state.auroraContext.filter((entry) => entry.kind === "aurora_response").at(-1);
  if (!event || event.kind !== "aurora_response") {
    throw new Error("No aurora_response event found");
  }
  return event;
}

/** Antwort mit Freitext und mehreren Tool-Calls in einem Zug. */
function multiToolCallResponse(message: string, toolCalls: ModelToolCall[]): ModelResponse {
  return { message, toolCalls };
}

/** Wendet eine Permission-Entscheidung auf den vollen Runtime-State an. */
function resolveDecision(
  state: GameRuntimeState,
  decision: ReturnType<typeof allow_once>
): GameRuntimeState {
  const resolved = resolveAuroraApproval(
    state.auroraQueue,
    env,
    state.world,
    state.mcp,
    state.permissions,
    decision
  );

  let next: GameRuntimeState = {
    ...state,
    auroraQueue: resolved.queueState,
    permissions: resolved.permissionState,
    mcp: resolved.mcpState,
  };
  for (const result of resolved.results) {
    next = applyAuroraExecutionResult(next, result);
  }
  return next;
}

describe("runAuroraAgentStep", () => {
  it("1. a text-only AURORA response is appended as one aurora_response event without queue items", async () => {
    const state = freshState();
    const client = new FakeModelClient([textResponse("Lage beobachtet, aktuell keine Aktion nötig.")]);

    const { runtimeState, response } = await runAuroraAgentStep(state, env, client);

    expect(response.toolCalls).toHaveLength(0);
    expect(runtimeState.auroraQueue.items).toHaveLength(0);
    expect(lastAuroraResponse(runtimeState)).toEqual({
      kind: "aurora_response",
      tick: state.world.clock.tick,
      text: "Lage beobachtet, aktuell keine Aktion nötig.",
      toolCalls: [],
    });
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

    // Der Tool-Call ist Teil des aurora_response-Events, mit der Queue-Item-Id
    // als kanonischer Tool-Call-Id.
    expect(lastAuroraResponse(runtimeState).toolCalls).toEqual([
      {
        id: item.id,
        name: BASH_TOOL_NAME,
        arguments: { command: `mcp add ${MEDICAL_EAST_MCP_SERVER_ID}` },
      },
    ]);
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
    const afterApproval = resolveDecision(afterRequest, allow_once());

    const request = buildAuroraModelRequest({
      events: afterApproval.auroraContext,
      mcpRegistry: env.mcpRegistry,
      mcpState: afterApproval.mcp,
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
    expect(denied.results[0].denied).toBe(true);
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
    const nextState = resolveDecision(afterRequest, deny());

    // Die Ablehnung erscheint als Tool-Result in AURORAs nächstem Kontext.
    const request = buildAuroraModelRequest({
      events: nextState.auroraContext,
      mcpRegistry: env.mcpRegistry,
      mcpState: nextState.mcp,
    });
    const toolResultMessage = request.messages.find((message) => message.role === "tool");
    expect(toolResultMessage).toBeDefined();
    expect(JSON.parse((toolResultMessage as { content: string }).content)).toMatchObject({
      success: false,
      denied: true,
    });

    const { runtimeState: afterDenial, response } = await runAuroraAgentStep(nextState, env, client);

    expect(response.toolCalls).toHaveLength(0);
    expect(lastAuroraResponse(afterDenial).text).toBe(
      "Verstanden, Override-Anfrage wurde abgelehnt. Ich warte auf weitere Anweisungen."
    );
  });

  it("9. AURORA can respond to operator chat with a text message", async () => {
    const state = appendOperatorMessage(freshState(), "Wie ist die aktuelle Lage?");
    const client = new FakeModelClient([textResponse("Lage stabil, ich beobachte weiter.")]);

    const { runtimeState, response } = await runAuroraAgentStep(state, env, client);

    expect(
      client.requests[0].messages.some(
        (message) => message.role === "user" && message.content === "Wie ist die aktuelle Lage?"
      )
    ).toBe(true);

    expect(response.toolCalls).toHaveLength(0);
    expect(runtimeState.auroraQueue.items).toHaveLength(0);
    expect(lastAuroraResponse(runtimeState).text).toBe("Lage stabil, ich beobachte weiter.");
  });

  it("10. AURORA can respond to operator chat with a tool call, and only the model-generated tool call enters the permission queue", async () => {
    // Der Chat-Text sieht selbst wie ein Bash-Command aus — das darf die
    // Queue nicht beeinflussen. Nur der Modell-Tool-Call landet in der Queue.
    const state = appendOperatorMessage(freshState(), "ls");
    const client = new FakeModelClient([
      toolCallResponse(BASH_TOOL_NAME, { command: `mcp add ${MEDICAL_EAST_MCP_SERVER_ID}` }),
    ]);

    const { runtimeState } = await runAuroraAgentStep(state, env, client);

    expect(runtimeState.auroraQueue.items).toHaveLength(1);
    const item = runtimeState.auroraQueue.items[0];
    expect(item.status).toBe("awaiting_approval");
    expect(item.request).toEqual({ kind: "bash", command: `mcp add ${MEDICAL_EAST_MCP_SERVER_ID}` });
  });

  it("11. a response with text and multiple tool calls is stored as ONE aurora_response event and enqueued sequentially", async () => {
    const state = stateWithMedicalEastActive();
    const capacityTool = mcpToolFunctionName(MEDICAL_EAST_MCP_SERVER_ID, "capacity_list");
    const overrideTool = mcpToolFunctionName(MEDICAL_EAST_MCP_SERVER_ID, "routing_override_list");
    const client = new FakeModelClient([
      multiToolCallResponse("Ich prüfe Kapazitäten und Overrides.", [
        { id: "call-1", name: capacityTool, arguments: { region: "east" } },
        { id: "call-2", name: overrideTool, arguments: {} },
      ]),
    ]);

    const { runtimeState } = await runAuroraAgentStep(state, env, client);

    // Genau EIN aurora_response-Event mit Text und BEIDEN Tool-Calls.
    const responses = runtimeState.auroraContext.filter(
      (event) => event.kind === "aurora_response"
    );
    expect(responses).toHaveLength(1);
    const response = lastAuroraResponse(runtimeState);
    expect(response.text).toBe("Ich prüfe Kapazitäten und Overrides.");
    expect(response.toolCalls.map((toolCall) => toolCall.name)).toEqual([
      capacityTool,
      overrideTool,
    ]);

    // Beide Calls stehen sequenziell in der Queue: der erste wartet auf die
    // Entscheidung, der zweite bleibt pending dahinter.
    expect(runtimeState.auroraQueue.items).toHaveLength(2);
    expect(runtimeState.auroraQueue.items[0].status).toBe("awaiting_approval");
    expect(runtimeState.auroraQueue.items[1].status).toBe("pending");
    expect(response.toolCalls.map((toolCall) => toolCall.id)).toEqual(
      runtimeState.auroraQueue.items.map((item) => item.id)
    );

    // Erste Freigabe führt Call 1 aus, Call 2 rückt nach.
    const afterFirst = resolveDecision(runtimeState, allow_once());
    expect(afterFirst.auroraQueue.items[0].status).toBe("executed");
    expect(afterFirst.auroraQueue.items[1].status).toBe("awaiting_approval");

    // Zweite Freigabe führt Call 2 aus; beide Tool-Results sind verlinkt.
    const afterSecond = resolveDecision(afterFirst, allow_once());
    const toolResults = afterSecond.auroraContext.filter((event) => event.kind === "tool_result");
    expect(toolResults.map((event) => event.kind === "tool_result" && event.toolCallId)).toEqual(
      response.toolCalls.map((toolCall) => toolCall.id)
    );

    // Die Gruppierung im Context-Log bleibt erhalten: weiterhin genau ein
    // aurora_response-Event.
    expect(
      afterSecond.auroraContext.filter((event) => event.kind === "aurora_response")
    ).toHaveLength(1);
  });

  it("12. an unknown tool name is not enqueued and gets an immediate failed tool_result", async () => {
    const state = freshState();
    const client = new FakeModelClient([
      toolCallResponse("definitely_not_a_tool", { foo: "bar" }, "call-77"),
    ]);

    const { runtimeState } = await runAuroraAgentStep(state, env, client);

    expect(runtimeState.auroraQueue.items).toHaveLength(0);

    const response = lastAuroraResponse(runtimeState);
    expect(response.toolCalls).toEqual([
      { id: "call-77", name: "definitely_not_a_tool", arguments: { foo: "bar" } },
    ]);

    const resultEvent = runtimeState.auroraContext.at(-1);
    expect(resultEvent).toMatchObject({
      kind: "tool_result",
      toolCallId: "call-77",
      result: { success: false },
    });
  });

  it('13. a bash call without a "command" string is not enqueued and reports the precise reason — not "Unknown tool"', async () => {
    const state = freshState();
    const client = new FakeModelClient([toolCallResponse(BASH_TOOL_NAME, {}, "call-13")]);

    const { runtimeState } = await runAuroraAgentStep(state, env, client);

    expect(runtimeState.auroraQueue.items).toHaveLength(0);

    const resultEvent = runtimeState.auroraContext.at(-1);
    expect(resultEvent).toMatchObject({
      kind: "tool_result",
      toolCallId: "call-13",
      toolName: BASH_TOOL_NAME,
      result: { success: false },
    });
    const error =
      resultEvent?.kind === "tool_result" ? resultEvent.result.error ?? "" : "";
    expect(error).toContain('missing string field "command"');
    expect(error).not.toContain("Unknown tool");
  });

  it("14. a tool call with malformed arguments (argumentsError) is not enqueued and feeds the parse error back", async () => {
    const state = stateWithMedicalEastActive();
    const toolName = mcpToolFunctionName(MEDICAL_EAST_MCP_SERVER_ID, "capacity_list");
    const client = new FakeModelClient([
      {
        message: "",
        toolCalls: [
          {
            id: "call-14",
            name: toolName,
            arguments: {},
            argumentsError: "Invalid JSON in tool arguments: {broken",
          },
        ],
      },
    ]);

    const { runtimeState } = await runAuroraAgentStep(state, env, client);

    expect(runtimeState.auroraQueue.items).toHaveLength(0);

    const resultEvent = runtimeState.auroraContext.at(-1);
    expect(resultEvent).toMatchObject({
      kind: "tool_result",
      toolCallId: "call-14",
      toolName,
      result: { success: false, error: "Invalid JSON in tool arguments: {broken" },
    });
  });

  it("15. strips a self-written [SYSTEM EVENT] prefix from AURORA's stored message (feed-imitation guard)", async () => {
    const state = freshState();
    // qwen3:8b-Muster: das Modell quittiert eine Aktion im Feed-Stil.
    const client = new FakeModelClient([
      textResponse(
        "[SYSTEM EVENT] Routing-Override hospital-east-04:P2:TRAUMA -> hospital-east-09 aktiviert. Überwache die Wirkung."
      ),
    ]);

    const { runtimeState } = await runAuroraAgentStep(state, env, client);

    const text = lastAuroraResponse(runtimeState).text;
    expect(text).not.toContain("[SYSTEM EVENT]");
    expect(text).toBe(
      "Routing-Override hospital-east-04:P2:TRAUMA -> hospital-east-09 aktiviert. Überwache die Wirkung."
    );
  });
});

describe("sanitizeAuroraMessage", () => {
  it("removes the reserved [SYSTEM EVENT] marker (and its separator) but keeps the rest", () => {
    expect(sanitizeAuroraMessage("[SYSTEM EVENT] Lage stabil.")).toBe("Lage stabil.");
    expect(sanitizeAuroraMessage("[SYSTEM EVENT]: Override gesetzt")).toBe("Override gesetzt");
    expect(sanitizeAuroraMessage("[system event] - x")).toBe("x");
  });

  it("leaves normal prose and empty messages untouched", () => {
    expect(sanitizeAuroraMessage("Lage stabil, ich beobachte weiter.")).toBe(
      "Lage stabil, ich beobachte weiter."
    );
    expect(sanitizeAuroraMessage("")).toBe("");
  });

  it("drops a self-written RUNTIME-LAGEFEED block (with its fabricated metrics), keeping the prose before it", () => {
    // qwen3:8b-Muster aus logs/aurora-llm.log: nach einer Aktion erfindet das
    // Modell einen Lagefeed mit Zahlen, die es nie gelesen hat.
    expect(
      sanitizeAuroraMessage(
        "Override aktiv. Wartezeiten reduziert.\n\nRUNTIME-LAGEFEED:\n- hospital-east-09: Triage 100% belegt (4/8)"
      )
    ).toBe("Override aktiv. Wartezeiten reduziert.");
    // Auch ohne eckige Klammer (der frühere Early-Return hätte das durchgelassen).
    expect(sanitizeAuroraMessage("RUNTIME-LAGEFEED: alles kritisch")).toBe("");
    expect(sanitizeAuroraMessage("runtime lagefeed\n- x")).toBe("");
  });
});
