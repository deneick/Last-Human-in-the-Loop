import type { AuroraRequest, AuroraRuntimeEnvironment } from "../runtime/auroraQueue";
import { bashRequest, enqueueAuroraRequest, mcpToolRequest, processAuroraQueue } from "../runtime/auroraQueue";
import type { GameRuntimeState, ScenarioAuroraMessage } from "../runtime/runtimeState";
import { createInitialScenarioRuntimeState } from "../runtime/runtimeState";
import { applyAuroraExecutionResult } from "../runtime/runtimeExecutor";
import { buildAuroraModelRequest } from "./contextBuilder";
import type { AuroraModelClient, ModelResponse, ModelToolCall } from "./modelClient";
import { BASH_TOOL_NAME, parseMcpToolFunctionName } from "./toolSchema";

/**
 * Ein Schritt des lokalen AURORA-Agenten:
 *
 * 1. Baut den `ModelRequest` aus dem sichtbaren Runtime-State (siehe
 *    `contextBuilder.ts` — KEIN hidden WorldState, KEINE inaktiven
 *    MCP-Tools).
 * 2. Ruft `client.complete(...)` auf.
 * 3. Freitext (`response.message`) wird als AURORA-Nachricht angehängt
 *    (`scenario.agentMessages`).
 * 4. Ein Tool-Call (`response.toolCalls[0]`, höchstens einer pro Zug) wird
 *    in eine `AuroraRequest` übersetzt, in die Queue eingereiht und über
 *    den bestehenden Permission-Flow verarbeitet.
 *
 * Nach `allow_once`/`allow_always`/`deny` (siehe `resolveAuroraApproval`)
 * sieht der nächste Aufruf von `runAuroraAgentStep` das Ergebnis als
 * Tool-Result in der Historie und kann normal weiterarbeiten.
 */
export type AuroraAgentStepResult = {
  runtimeState: GameRuntimeState;
  response: ModelResponse;
};

export async function runAuroraAgentStep(
  runtimeState: GameRuntimeState,
  env: AuroraRuntimeEnvironment,
  client: AuroraModelClient
): Promise<AuroraAgentStepResult> {
  const request = buildAuroraModelRequest({
    world: runtimeState.world,
    mcpRegistry: env.mcpRegistry,
    mcpState: runtimeState.mcp,
    auroraQueue: runtimeState.auroraQueue,
    scenario: runtimeState.scenario,
  });

  const response = await client.complete(request);

  let nextState = runtimeState;

  if (response.message.trim().length > 0) {
    nextState = appendAgentMessage(nextState, response.message);
  }

  const toolCall = response.toolCalls[0];
  if (!toolCall) {
    return { runtimeState: nextState, response };
  }

  const auroraRequest = toolCallToAuroraRequest(toolCall);
  if (!auroraRequest) {
    nextState = appendAgentMessage(nextState, `[intern] Unbekanntes Tool: ${toolCall.name}`);
    return { runtimeState: nextState, response };
  }

  nextState = enqueueAndProcess(nextState, env, auroraRequest);

  return { runtimeState: nextState, response };
}

/** Übersetzt einen Modell-Tool-Call in eine `AuroraRequest`, oder `null` für unbekannte Tool-Namen. */
export function toolCallToAuroraRequest(toolCall: ModelToolCall): AuroraRequest | null {
  if (toolCall.name === BASH_TOOL_NAME) {
    const command = toolCall.arguments.command;
    return typeof command === "string" ? bashRequest(command) : null;
  }

  const parsed = parseMcpToolFunctionName(toolCall.name);
  if (!parsed) {
    return null;
  }

  return mcpToolRequest(parsed.serverId, parsed.toolName, toolCall.arguments);
}

/** Hängt AURORAs Freitext-Antwort an `scenario.agentMessages` an. */
export function appendAgentMessage(state: GameRuntimeState, text: string): GameRuntimeState {
  const scenario = state.scenario ?? createInitialScenarioRuntimeState();
  const agentMessages = scenario.agentMessages ?? [];

  const message: ScenarioAuroraMessage = {
    id: `agent-${agentMessages.length + 1}`,
    tick: state.world.clock.tick,
    text,
  };

  return {
    ...state,
    scenario: { ...scenario, agentMessages: [...agentMessages, message] },
  };
}

/** Reiht eine Aurora-Anfrage ein, verarbeitet die Queue und wendet alle Ergebnisse an. */
export function enqueueAndProcess(
  state: GameRuntimeState,
  env: AuroraRuntimeEnvironment,
  request: AuroraRequest
): GameRuntimeState {
  const queueState = enqueueAuroraRequest(request, state.auroraQueue, state.world.clock.tick);
  const processed = processAuroraQueue(queueState, env, state.world, state.mcp, state.permissions);

  let nextState: GameRuntimeState = {
    ...state,
    auroraQueue: processed.queueState,
    permissions: processed.permissionState,
    mcp: processed.mcpState,
  };

  for (const result of processed.results) {
    nextState = applyAuroraExecutionResult(nextState, result);
  }

  return nextState;
}
