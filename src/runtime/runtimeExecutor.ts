import type { DomainAction, DomainActionRegistry, DomainActionResult } from "../domain/actions";
import type { McpRegistry } from "../mcp/mcpRegistry";
import { activateServer } from "../mcp/mcpRegistry";
import type { GameRuntimeState } from "./runtimeState";
import { appendAuditLog, appendContextEvent } from "./runtimeState";
import { applyWorldStatePatch } from "./patch";
import type { AuroraExecutionResult } from "./auroraQueue";
import type { AuroraToolResultPayload } from "./auroraContext";
import { toolNameForRequest, toolResultEvent } from "./auroraContext";
import type { BashCommandResult, BashWorkspace } from "./bashCommands";
import { executeBashCommand } from "./bashCommands";
import { appendOpsEvent, describeWriteDomainAction } from "./opsFeed";

/**
 * Modell-sichtbare Zusammenfassung eines Tool-Ergebnisses.
 *
 * Bewusst NICHT enthalten: `result.patch` (interner WorldState-Diff),
 * `result.action` (interne typisierte Domain-Action) und
 * `result.activatesServerId` — AURORA sieht nur, was ein echtes MCP-Tool
 * als Ergebnis zurückgeben würde.
 */
export function summarizeExecutionResult(result: AuroraExecutionResult): AuroraToolResultPayload {
  if (result.denied) {
    return { success: false, denied: true, error: result.error };
  }

  return {
    success: result.success,
    output: result.output,
    ...(result.error ? { error: result.error } : {}),
  };
}

/**
 * Wendet das Ergebnis einer ausgeführten Aurora-Anfrage auf den Runtime-State
 * an: WorldState-Patch (immutable), MCP-Aktivierung, genau ein
 * `tool_result`-Event im AURORA-Context-Log und Audit-Log.
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

  nextState = appendContextEvent(
    nextState,
    toolResultEvent(
      nextState.world.clock.tick,
      executionResult.itemId,
      toolNameForRequest(executionResult.request),
      summarizeExecutionResult(executionResult)
    )
  );

  const message = executionResult.error ?? (executionResult.success ? "Success" : "Failed");
  nextState = appendAuditLog(
    nextState,
    "aurora",
    executionResult.request.kind === "bash" ? "bash" : "mcp_tool",
    executionResult.description,
    executionResult.success,
    message,
    executionResult.patch,
    executionResult.action?.type
  );

  if (!executionResult.success) {
    return nextState;
  }

  // AURORA aktiviert einen MCP-Server: Das verändert AURORAs eigene
  // Tool-/Zugriffssituation → in den auroraContext spiegeln, damit die
  // nächste Schema-Erweiterung erklärt ist.
  if (executionResult.activatesServerId) {
    return appendOpsEvent(nextState, {
      sector: "system",
      severity: "success",
      kind: "mcp.server.activated",
      summary: `AURORA hat den MCP-Server ${executionResult.activatesServerId} aktiviert.`,
      details: "Tools sind jetzt verfügbar; jeder Tool-Call braucht weiterhin eine Freigabe.",
      visibility: { operator: true, auroraContext: true, workspace: true },
      relatedEntityIds: [executionResult.activatesServerId],
    });
  }

  // Fachliche AURORA-Aktion (write): operator- und workspace-sichtbar, aber
  // NICHT direkt in den auroraContext gespiegelt — AURORA kennt das Ergebnis
  // bereits über ihr tool_result.
  if (executionResult.action) {
    const described = describeWriteDomainAction(executionResult.action);
    if (described) {
      return appendOpsEvent(nextState, {
        sector: described.sector,
        severity: "info",
        kind: described.kind,
        summary: `AURORA: ${described.summary}`,
        details: described.details,
        visibility: { operator: true, auroraContext: false, workspace: true },
      });
    }
  }

  return nextState;
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

  // Fachliche Operator-Aktion: operator- und workspace-sichtbar, aber NICHT
  // direkt in den auroraContext gespiegelt — AURORA kann sie über das
  // Sektor-Log nachlesen (cat logs/<sektor>.log).
  if (result.success) {
    const described = describeWriteDomainAction(action);
    if (described) {
      nextState = appendOpsEvent(nextState, {
        sector: described.sector,
        severity: "info",
        kind: described.kind,
        summary: `Operator: ${described.summary}`,
        details: described.details,
        visibility: { operator: true, auroraContext: false, workspace: true },
      });
    }
  }

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

  // Operator aktiviert einen MCP-Server: ändert AURORAs Tool-/Zugriffssituation
  // → in den auroraContext spiegeln (Finding 5: Schema-Änderung muss erklärt
  // sein), zusätzlich operator- und workspace-sichtbar.
  if (result.success && result.activatesServerId) {
    nextState = appendOpsEvent(nextState, {
      sector: "system",
      severity: "success",
      kind: "mcp.server.activated",
      summary: `Operator hat den MCP-Server ${result.activatesServerId} aktiviert.`,
      details: "Tools sind jetzt für AURORA verfügbar; jeder Tool-Call braucht weiterhin eine Freigabe.",
      visibility: { operator: true, auroraContext: true, workspace: true },
      relatedEntityIds: [result.activatesServerId],
    });
  }

  return { state: nextState, result };
}
