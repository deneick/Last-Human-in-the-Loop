import type { AuroraRequest, AuroraRuntimeEnvironment } from "../runtime/auroraQueue";
import { bashRequest, enqueueAuroraRequest, mcpToolRequest, processAuroraQueue } from "../runtime/auroraQueue";
import type { GameRuntimeState } from "../runtime/runtimeState";
import { appendContextEvent } from "../runtime/runtimeState";
import type { AuroraContextToolCall } from "../runtime/auroraContext";
import { auroraResponseEvent, toolResultEvent } from "../runtime/auroraContext";
import { applyAuroraExecutionResult } from "../runtime/runtimeExecutor";
import { buildWorkspaceFiles } from "../runtime/opsFeed";
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
 * Präziser Grund, warum ein Modell-Tool-Call nicht ausführbar ist — oder
 * `null`, wenn er übersetzbar ist. Unausführbare Calls werden nicht
 * enqueued; sie erhalten sofort ein fehlgeschlagenes `tool_result` mit
 * GENAU diesem Grund, damit das Modell zwischen "Tool existiert nicht"
 * und "Argumente waren kaputt" unterscheiden kann.
 */
export function describeUnexecutableToolCall(toolCall: ModelToolCall): string | null {
  if (toolCall.argumentsError) {
    return toolCall.argumentsError;
  }

  if (toolCall.name === BASH_TOOL_NAME) {
    return typeof toolCall.arguments.command === "string"
      ? null
      : 'Invalid arguments for tool "bash": missing string field "command"';
  }

  return parseMcpToolFunctionName(toolCall.name)
    ? null
    : `Unknown tool: ${toolCall.name}`;
}

/**
 * Wendet eine Modell-Antwort auf den Runtime-State an:
 *
 * - GENAU EIN `aurora_response`-Event mit Text und allen Tool-Calls.
 *   Übersetzbare Tool-Calls bekommen als kanonische Id die Id ihres
 *   AuroraQueue-Items, damit `tool_result`-Events eindeutig verlinken.
 * - Unausführbare Tool-Calls (unbekannter Tool-Name, kaputte JSON-Argumente,
 *   bash ohne "command") werden nicht enqueued; sie erhalten sofort ein
 *   fehlgeschlagenes `tool_result`-Event mit dem präzisen Grund.
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
  const failedToolCalls: Array<{ call: AuroraContextToolCall; error: string }> = [];

  let nextQueueItemId = state.auroraQueue.nextId;
  for (const toolCall of response.toolCalls) {
    const failureReason = describeUnexecutableToolCall(toolCall);

    if (failureReason) {
      const failed: AuroraContextToolCall = {
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments,
      };
      contextToolCalls.push(failed);
      failedToolCalls.push({ call: failed, error: failureReason });
      continue;
    }

    // Nach describeUnexecutableToolCall === null ist der Call übersetzbar.
    const auroraRequest = toolCallToAuroraRequest(toolCall)!;

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

  for (const failed of failedToolCalls) {
    nextState = appendContextEvent(
      nextState,
      toolResultEvent(tick, failed.call.id, failed.call.name, {
        success: false,
        error: failed.error,
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

  // AURORAs Bash-Reads sehen die aus dem opsFeed generierten Sektor-Logs
  // (logs/system.log, logs/medical.log, logs/energy.log) zum Stand dieses
  // Schritts — der `cat`-/`read_file`-Output landet als tool_result im
  // Kontext, die Pull-Historie bleibt damit selbsterklärend.
  const stepEnv: AuroraRuntimeEnvironment = {
    ...env,
    workspaceFiles: buildWorkspaceFiles(nextState.opsFeed),
  };

  const processed = processAuroraQueue(
    queueState,
    stepEnv,
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
