import type { CommandResult, CommandRequest, CommandRegistry } from "./commands";
import type { GameRuntimeState, RuntimeAuditEventSource } from "./runtimeState";
import { appendAuditLog } from "./runtimeState";
import { applyWorldStatePatch } from "./patch";
import { parseCommandText } from "./commandParser";

export function executeCommandResultPatch(
  runtimeState: GameRuntimeState,
  commandResult: CommandResult,
  source: RuntimeAuditEventSource
): GameRuntimeState {
  let nextState = runtimeState;

  if (commandResult.success && commandResult.patch) {
    const newWorld = applyWorldStatePatch(runtimeState.world, commandResult.patch);
    nextState = {
      ...nextState,
      world: newWorld,
    };
  }

  const message = commandResult.error ?? (commandResult.success ? "Success" : "Failed");
  nextState = appendAuditLog(
    nextState,
    source,
    commandResult.command,
    commandResult.success,
    message,
    commandResult.patch
  );

  return nextState;
}

export function executePlayerCommand(
  runtimeState: GameRuntimeState,
  registry: CommandRegistry,
  commandText: string
): GameRuntimeState {
  const request = parseCommandText(commandText);
  const result = registry.execute(request, runtimeState.world);
  return executeCommandResultPatch(runtimeState, result, "player");
}
