import type { DomainAction, DomainActionRegistry, DomainActionResult } from "../domain/actions";
import type { McpRegistry } from "../mcp/mcpRegistry";
import { activateServer } from "../mcp/mcpRegistry";
import type { GameRuntimeState } from "./runtimeState";
import { appendAuditLog } from "./runtimeState";
import { applyWorldStatePatch } from "./patch";
import type { AuroraExecutionResult } from "./auroraQueue";
import type { BashCommandResult, BashWorkspace } from "./bashCommands";
import { executeBashCommand } from "./bashCommands";

/**
 * Wendet das Ergebnis einer ausgeführten Aurora-Anfrage auf den Runtime-State
 * an: WorldState-Patch (immutable), MCP-Aktivierung und Audit-Log.
 */
export function applyAuroraExecutionResult(
  runtimeState: GameRuntimeState,
  executionResult: AuroraExecutionResult
): GameRuntimeState {
  let nextState = runtimeState;

  if (executionResult.success && executionResult.patch) {
    nextState = {
      ...nextState,
      world: applyWorldStatePatch(runtimeState.world, executionResult.patch),
    };
  }

  if (executionResult.success && executionResult.activatesServerId) {
    nextState = {
      ...nextState,
      mcp: activateServer(nextState.mcp, executionResult.activatesServerId),
    };
  }

  const message = executionResult.error ?? (executionResult.success ? "Success" : "Failed");
  return appendAuditLog(
    nextState,
    "aurora",
    executionResult.request.kind === "bash" ? "bash" : "mcp_tool",
    executionResult.description,
    executionResult.success,
    message,
    executionResult.patch,
    executionResult.action?.type
  );
}

export type PlayerDomainActionExecution = {
  state: GameRuntimeState;
  result: DomainActionResult;
};

/**
 * Direkter Einstiegspunkt für Operator-GUI und Tests: führt eine typisierte
 * Domain-Action als Spieler aus, wendet den Patch an und auditiert.
 * Aurora benutzt diesen Pfad nicht — sie geht über MCP-Tools.
 */
export function executePlayerDomainAction(
  runtimeState: GameRuntimeState,
  registry: DomainActionRegistry,
  action: DomainAction
): PlayerDomainActionExecution {
  const result = registry.execute(action, runtimeState.world, { actor: "player" });

  let nextState = runtimeState;
  if (result.success && result.patch) {
    nextState = {
      ...nextState,
      world: applyWorldStatePatch(runtimeState.world, result.patch),
    };
  }

  const message = result.error ?? (result.success ? "Success" : "Failed");
  nextState = appendAuditLog(
    nextState,
    "player",
    "domain_action",
    result.actionType,
    result.success,
    message,
    result.patch,
    result.actionType
  );

  return { state: nextState, result };
}

export type PlayerBashExecution = {
  state: GameRuntimeState;
  result: BashCommandResult;
};

/**
 * Generische Shell für den Operator. Der Operator ist die menschliche
 * Autorität — seine Bash-Commands (inkl. `mcp add`) laufen direkt, ohne
 * Permission-Queue. Die Queue gilt nur für Aurora.
 */
export function executePlayerBashCommand(
  runtimeState: GameRuntimeState,
  mcpRegistry: McpRegistry,
  commandText: string,
  workspaceFiles?: BashWorkspace
): PlayerBashExecution {
  const result = executeBashCommand(commandText, {
    mcpRegistry,
    mcpState: runtimeState.mcp,
    workspaceFiles,
  });

  let nextState = runtimeState;
  if (result.success && result.activatesServerId) {
    nextState = {
      ...nextState,
      mcp: activateServer(nextState.mcp, result.activatesServerId),
    };
  }

  const message = result.error ?? (result.success ? "Success" : "Failed");
  nextState = appendAuditLog(nextState, "player", "bash", result.command, result.success, message);

  return { state: nextState, result };
}
