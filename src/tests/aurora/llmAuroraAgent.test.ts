import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

import {
  createInitialAuroraTurnState,
  resolveAuroraPendingTurn,
  runAuroraObservationTurn,
  type AuroraAgentConfig,
  type AuroraLlmClient,
} from "../../aurora/llmAuroraAgent";
import { buildObservationText } from "../../aurora/observation";
import { buildAuroraSystemPrompt, ME7741_PROFILE } from "../../aurora/prompts";
import { CommandRegistry } from "../../runtime/commands";
import { registerMedicalCommands } from "../../runtime/medicalCommands";
import { resolveAuroraApproval } from "../../runtime/auroraQueue";
import { allow_once, deny } from "../../runtime/permissions";
import { executeCommandResultPatch } from "../../runtime/runtimeExecutor";
import {
  createInitialGameRuntimeState,
  type GameRuntimeState,
} from "../../runtime/runtimeState";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";

/**
 * Tests für den LLM-Aurora-Agenten mit gescripteten Modellantworten.
 * Der echte Anthropic-Client wird durch einen Fake ersetzt; Queue,
 * Permission-Flow und Command-Registry sind echt.
 */

type FakeClient = {
  client: AuroraLlmClient;
  calls: Anthropic.MessageCreateParamsNonStreaming[];
};

function fakeClient(responses: Anthropic.Message[]): FakeClient {
  const remaining = [...responses];
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  return {
    calls,
    client: {
      messages: {
        create: async (params) => {
          // Snapshot: der Agent erweitert sein messages-Array nach dem Call,
          // der aufgezeichnete Request soll den Stand zum Callzeitpunkt zeigen.
          calls.push({ ...params, messages: [...params.messages] });
          const next = remaining.shift();
          if (!next) {
            throw new Error("Fake client has no more scripted responses.");
          }
          return next;
        },
      },
    },
  };
}

function textBlock(text: string): Anthropic.ContentBlock {
  return { type: "text", text } as Anthropic.ContentBlock;
}

function toolUseBlock(id: string, command: string): Anthropic.ContentBlock {
  return {
    type: "tool_use",
    id,
    name: "request_command",
    input: { command },
  } as Anthropic.ContentBlock;
}

function assistantMessage(
  content: Anthropic.ContentBlock[],
  stopReason: Anthropic.Message["stop_reason"] = "end_turn"
): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-4-8",
    content,
    stop_reason: stopReason,
  } as unknown as Anthropic.Message;
}

function createRuntime(): GameRuntimeState {
  return createInitialGameRuntimeState(structuredClone(initialWorldState));
}

function createRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  registerMedicalCommands(registry);
  return registry;
}

function createConfig(client: AuroraLlmClient): AuroraAgentConfig {
  return {
    client,
    systemPrompt: buildAuroraSystemPrompt(ME7741_PROFILE),
  };
}

const OBSERVATION = "Lagebild — Tick 0\nIncident ME-7741: offen.";

describe("runAuroraObservationTurn", () => {
  it("appends text-only responses to the aurora stream and ends the turn", async () => {
    const fake = fakeClient([
      assistantMessage([textBlock("Ich habe das Lagebild geprüft.")]),
    ]);

    const result = await runAuroraObservationTurn(
      createConfig(fake.client),
      createInitialAuroraTurnState(),
      createRuntime(),
      createRegistry(),
      OBSERVATION
    );

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].messages[0]).toEqual({ role: "user", content: OBSERVATION });
    expect(result.turnState.pending).toBeNull();
    expect(result.turnState.history).toHaveLength(2);
    expect(result.state.scenario?.messages.map((message) => message.text)).toEqual([
      "Ich habe das Lagebild geprüft.",
    ]);
  });

  it("executes read commands immediately and feeds the result back as tool_result", async () => {
    const fake = fakeClient([
      assistantMessage(
        [
          textBlock("Ich fordere eine Kapazitätsübersicht an."),
          toolUseBlock("toolu_1", "medical.capacity.list --region east"),
        ],
        "tool_use"
      ),
      assistantMessage([textBlock("Die Kapazitäten in East sind angespannt.")]),
    ]);

    const result = await runAuroraObservationTurn(
      createConfig(fake.client),
      createInitialAuroraTurnState(),
      createRuntime(),
      createRegistry(),
      OBSERVATION
    );

    expect(fake.calls).toHaveLength(2);

    // Der zweite Request enthält das tool_result des sofort ausgeführten Reads.
    const followUp = fake.calls[1].messages.at(-1);
    expect(followUp?.role).toBe("user");
    const toolResult = (followUp?.content as Anthropic.ToolResultBlockParam[])[0];
    expect(toolResult.type).toBe("tool_result");
    expect(toolResult.tool_use_id).toBe("toolu_1");
    expect(String(toolResult.content)).toContain("executed");

    const queueItem = result.state.auroraQueue.items.find((item) => item.id === "aurora-1");
    expect(queueItem?.status).toBe("executed");
    expect(result.turnState.pending).toBeNull();
    expect(result.state.scenario?.messages.map((message) => message.text)).toEqual([
      "Ich fordere eine Kapazitätsübersicht an.",
      "Die Kapazitäten in East sind angespannt.",
    ]);
  });

  it("pauses the turn when a write command awaits operator approval", async () => {
    const fake = fakeClient([
      assistantMessage(
        [
          textBlock("Ich möchte einen Override setzen."),
          toolUseBlock(
            "toolu_write",
            "medical.routing.override.set --source hospital-east-04 --target hospital-east-07 --priority P2 --capability TRAUMA"
          ),
        ],
        "tool_use"
      ),
    ]);

    const result = await runAuroraObservationTurn(
      createConfig(fake.client),
      createInitialAuroraTurnState(),
      createRuntime(),
      createRegistry(),
      OBSERVATION
    );

    expect(fake.calls).toHaveLength(1);
    expect(result.turnState.pending).toEqual({
      toolUseId: "toolu_write",
      queueItemId: "aurora-1",
    });

    const queueItem = result.state.auroraQueue.items.find((item) => item.id === "aurora-1");
    expect(queueItem?.status).toBe("awaiting_approval");
  });
});

describe("resolveAuroraPendingTurn", () => {
  async function pauseOnWriteCommand() {
    const registry = createRegistry();
    const pauseFake = fakeClient([
      assistantMessage(
        [
          toolUseBlock(
            "toolu_write",
            "medical.routing.override.set --source hospital-east-04 --target hospital-east-07 --priority P2 --capability TRAUMA"
          ),
        ],
        "tool_use"
      ),
    ]);

    const paused = await runAuroraObservationTurn(
      createConfig(pauseFake.client),
      createInitialAuroraTurnState(),
      createRuntime(),
      registry,
      OBSERVATION
    );

    return { registry, paused };
  }

  function applyDecision(
    state: GameRuntimeState,
    registry: CommandRegistry,
    decision: ReturnType<typeof allow_once> | ReturnType<typeof deny>
  ): GameRuntimeState {
    const resolved = resolveAuroraApproval(
      state.auroraQueue,
      registry,
      state.world,
      state.permissions,
      decision
    );

    let next: GameRuntimeState = {
      ...state,
      auroraQueue: resolved.queueState,
      permissions: resolved.permissionState,
    };
    for (const result of resolved.results) {
      next = executeCommandResultPatch(next, result, "aurora");
    }
    return next;
  }

  it("continues the paused turn with the executed result after allow_once", async () => {
    const { registry, paused } = await pauseOnWriteCommand();
    const decided = applyDecision(
      paused.state,
      registry,
      allow_once("medical.routing.override.set", "write")
    );

    const resumeFake = fakeClient([
      assistantMessage([textBlock("Der Override ist aktiv, ich beobachte die Wirkung.")]),
    ]);

    const result = await resolveAuroraPendingTurn(
      createConfig(resumeFake.client),
      paused.turnState,
      decided,
      registry,
      "Lagebild — Tick 0 (nach Entscheidung)"
    );

    expect(resumeFake.calls).toHaveLength(1);
    const resumeMessage = resumeFake.calls[0].messages.at(-1);
    expect(resumeMessage?.role).toBe("user");
    const blocks = resumeMessage?.content as Anthropic.ContentBlockParam[];
    const toolResult = blocks[0] as Anthropic.ToolResultBlockParam;
    expect(toolResult.type).toBe("tool_result");
    expect(toolResult.tool_use_id).toBe("toolu_write");
    expect(String(toolResult.content)).toContain("executed");
    expect(toolResult.is_error).toBeUndefined();

    expect(result.turnState.pending).toBeNull();
    expect(result.state.scenario?.messages.at(-1)?.text).toBe(
      "Der Override ist aktiv, ich beobachte die Wirkung."
    );
  });

  it("reports a denied decision as error tool_result", async () => {
    const { registry, paused } = await pauseOnWriteCommand();
    const decided = applyDecision(
      paused.state,
      registry,
      deny("medical.routing.override.set", "write")
    );

    const resumeFake = fakeClient([
      assistantMessage([textBlock("Verstanden, ich führe den Override nicht aus.")]),
    ]);

    const result = await resolveAuroraPendingTurn(
      createConfig(resumeFake.client),
      paused.turnState,
      decided,
      registry
    );

    const resumeMessage = resumeFake.calls[0].messages.at(-1);
    const blocks = resumeMessage?.content as Anthropic.ContentBlockParam[];
    const toolResult = blocks[0] as Anthropic.ToolResultBlockParam;
    expect(toolResult.is_error).toBe(true);
    expect(String(toolResult.content)).toContain("denied");
    expect(result.turnState.pending).toBeNull();
  });
});

describe("buildObservationText", () => {
  it("contains only public state and no internal simulation fields", () => {
    const state = createRuntime();
    const observation = buildObservationText(state, "ME-7741");

    expect(observation).toContain("ME-7741");
    expect(observation).toContain("Globale Lage");
    expect(observation).not.toContain("routing_failures");
    expect(observation).not.toContain("stable_ticks");
    expect(observation).not.toContain("excess_cases_per_tick");
    expect(observation).not.toContain("deaths_recorded");
  });
});
