import type { AuroraRequest, AuroraRuntimeEnvironment } from "../runtime/auroraQueue";
import { bashRequest, enqueueAuroraRequest, mcpToolRequest, processAuroraQueue } from "../runtime/auroraQueue";
import type { GameRuntimeState } from "../runtime/runtimeState";
import { appendContextEvent } from "../runtime/runtimeState";
import type { AuroraContextToolCall } from "../runtime/auroraContext";
import { auroraResponseEvent, toolResultEvent } from "../runtime/auroraContext";
import { applyAuroraExecutionResult } from "../runtime/runtimeExecutor";
import { buildAuroraModelRequest } from "./contextBuilder";
import type { AuroraModelClient, ModelResponse, ModelToolCall } from "./modelClient";
import { BASH_TOOL_NAME, parseMcpToolFunctionName } from "./toolSchema";

/**
 * Ein Schritt des lokalen AURORA-Agenten:
 *
 * 1. Baut den `ModelRequest` ausschließlich aus dem AURORA-Context-Log
 *    (`runtimeState.auroraContext`) plus den sichtbaren Tool-Schemas
 *    (siehe `contextBuilder.ts` — KEIN hidden WorldState, KEINE inaktiven
 *    MCP-Tools, KEIN Lesen der AuroraQueue als History).
 * 2. Ruft `client.complete(...)` auf.
 * 3. Hängt GENAU EIN `aurora_response`-Event mit Text und ALLEN Tool-Calls
 *    dieser Antwort an das Context-Log (Gruppierung bleibt erhalten).
 * 4. Reiht jeden Tool-Call als `AuroraRequest` in die AuroraQueue ein —
 *    die Queue ist eine reine Ausführungs-Queue für den sequenziellen
 *    Permission-/Execution-Flow, keine History.
 *
 * Ausgeführte/abgelehnte/fehlgeschlagene Tool-Calls erzeugen je genau ein
 * `tool_result`-Event (siehe `runtimeExecutor.applyAuroraExecutionResult`).
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
    events: runtimeState.auroraContext,
    mcpRegistry: env.mcpRegistry,
    mcpState: runtimeState.mcp,
  });

  const response = await client.complete(request);
  const nextState = applyAuroraModelResponse(runtimeState, env, response);

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

/**
 * Wendet eine Modell-Antwort auf den Runtime-State an:
 *
 * - GENAU EIN `aurora_response`-Event mit Text und allen Tool-Calls.
 *   Übersetzbare Tool-Calls bekommen als kanonische Id die Id ihres
 *   AuroraQueue-Items, damit `tool_result`-Events eindeutig verlinken.
 * - Unbekannte Tool-Namen werden nicht enqueued; sie erhalten sofort ein
 *   fehlgeschlagenes `tool_result`-Event.
 * - Alle übersetzten Tool-Calls werden sequenziell enqueued und die Queue
 *   über den bestehenden Permission-Flow verarbeitet.
 */
export function applyAuroraModelResponse(
  state: GameRuntimeState,
  env: AuroraRuntimeEnvironment,
  response: ModelResponse
): GameRuntimeState {
  const tick = state.world.clock.tick;

  const contextToolCalls: AuroraContextToolCall[] = [];
  const requests: AuroraRequest[] = [];
  const unknownToolCalls: AuroraContextToolCall[] = [];

  let nextQueueItemId = state.auroraQueue.nextId;
  for (const toolCall of response.toolCalls) {
    const auroraRequest = toolCallToAuroraRequest(toolCall);

    if (!auroraRequest) {
      const unknown: AuroraContextToolCall = {
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments,
      };
      contextToolCalls.push(unknown);
      unknownToolCalls.push(unknown);
      continue;
    }

    contextToolCalls.push({
      id: `aurora-${nextQueueItemId}`,
      name: toolCall.name,
      arguments: toolCall.arguments,
    });
    requests.push(auroraRequest);
    nextQueueItemId += 1;
  }

  let nextState = appendContextEvent(
    state,
    auroraResponseEvent(tick, response.message, contextToolCalls)
  );

  for (const unknown of unknownToolCalls) {
    nextState = appendContextEvent(
      nextState,
      toolResultEvent(tick, unknown.id, unknown.name, {
        success: false,
        error: `Unknown tool: ${unknown.name}`,
      })
    );
  }

  if (requests.length === 0) {
    return nextState;
  }

  let queueState = nextState.auroraQueue;
  for (const request of requests) {
    queueState = enqueueAuroraRequest(request, queueState, tick);
  }

  const processed = processAuroraQueue(
    queueState,
    env,
    nextState.world,
    nextState.mcp,
    nextState.permissions
  );

  nextState = {
    ...nextState,
    auroraQueue: processed.queueState,
    permissions: processed.permissionState,
    mcp: processed.mcpState,
  };

  for (const result of processed.results) {
    nextState = applyAuroraExecutionResult(nextState, result);
  }

  return nextState;
}
