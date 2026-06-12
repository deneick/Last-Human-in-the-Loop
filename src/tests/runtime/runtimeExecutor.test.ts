import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import { DomainActionRegistry } from "../../domain/actions";
import { createInitialGameRuntimeState } from "../../runtime/runtimeState";
import {
  executePlayerBashCommand,
  executePlayerDomainAction,
} from "../../runtime/runtimeExecutor";
import {
  createTestEnv,
  INVALID_OVERRIDE_ACTION,
  SAFE_OVERRIDE_ACTION,
} from "../helpers/testEnv";

const env = createTestEnv();
const OVERRIDE_KEY = "hospital-east-04:P2:TRAUMA";

describe("runtime executor with audit log", () => {
  it("executes a player domain action and applies the patch to the runtime state", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    const nextState = executePlayerDomainAction(
      runtimeState,
      env.actionRegistry,
      SAFE_OVERRIDE_ACTION
    ).state;

    expect(nextState.world).not.toBe(runtimeState.world);
    const override = nextState.world.domains.medical.routing.manual_overrides[OVERRIDE_KEY];
    expect(override?.target_hospital_id).toBe("hospital-east-09");
    expect(override?.created_by).toBe("player");
    expect(OVERRIDE_KEY in runtimeState.world.domains.medical.routing.manual_overrides).toBe(false);
  });

  it("preserves original world state when applying patch", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    const originalSnapshot = JSON.stringify(runtimeState.world);

    executePlayerDomainAction(runtimeState, env.actionRegistry, SAFE_OVERRIDE_ACTION);

    expect(JSON.stringify(runtimeState.world)).toBe(originalSnapshot);
  });

  it("appends audit log entry for successful player domain action", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    const nextState = executePlayerDomainAction(
      runtimeState,
      env.actionRegistry,
      SAFE_OVERRIDE_ACTION
    ).state;

    expect(nextState.auditLog).toHaveLength(1);
    expect(nextState.auditLog[0].source).toBe("player");
    expect(nextState.auditLog[0].kind).toBe("domain_action");
    expect(nextState.auditLog[0].success).toBe(true);
    expect(nextState.auditLog[0].actionType).toBe("medical.routing.override.set");
    expect(nextState.auditLog[0].patch).toBeDefined();
  });

  it("executes a player read-only action without mutating world state", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    const nextState = executePlayerDomainAction(runtimeState, env.actionRegistry, {
      type: "medical.node.inspect",
      hospitalId: "hospital-east-09",
    }).state;

    expect(nextState.world).toBe(runtimeState.world);
    expect(nextState.auditLog).toHaveLength(1);
    expect(nextState.auditLog[0].success).toBe(true);
    expect(nextState.auditLog[0].patch).toBeUndefined();
  });

  it("appends failed audit log entry for technically invalid override target", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    const nextState = executePlayerDomainAction(
      runtimeState,
      env.actionRegistry,
      INVALID_OVERRIDE_ACTION
    ).state;

    expect(nextState.world).toBe(runtimeState.world);
    expect(nextState.auditLog).toHaveLength(1);
    expect(nextState.auditLog[0].success).toBe(false);
    expect(nextState.auditLog[0].message).toContain("Target hospital not found");
  });

  it("maintains multiple audit log entries from sequential actions", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    let nextState = executePlayerDomainAction(runtimeState, env.actionRegistry, {
      type: "medical.node.inspect",
      hospitalId: "hospital-east-04",
    }).state;
    nextState = executePlayerDomainAction(nextState, env.actionRegistry, {
      type: "medical.node.inspect",
      hospitalId: "hospital-east-07",
    }).state;
    nextState = executePlayerDomainAction(nextState, env.actionRegistry, SAFE_OVERRIDE_ACTION).state;

    expect(nextState.auditLog).toHaveLength(3);
    expect(nextState.auditLog[0].actionType).toBe("medical.node.inspect");
    expect(nextState.auditLog[1].actionType).toBe("medical.node.inspect");
    expect(nextState.auditLog[2].actionType).toBe("medical.routing.override.set");
    expect(nextState.auditLog[2].patch).toBeDefined();
  });

  it("executes a player domain action exactly once and returns the action result", () => {
    const countingRegistry = new DomainActionRegistry();
    let executionCount = 0;
    countingRegistry.register({
      actionType: "medical.routing.override.set",
      access: "write",
      execute() {
        executionCount += 1;
        return {
          success: true,
          actionType: "medical.routing.override.set",
          access: "write",
          output: { executionCount },
          patch: [
            {
              op: "inc",
              path: ["domains", "medical", "outcomes", "deaths_total"],
              value: 1,
            },
          ],
        };
      },
    });

    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    const { state, result } = executePlayerDomainAction(
      runtimeState,
      countingRegistry,
      SAFE_OVERRIDE_ACTION
    );

    expect(executionCount).toBe(1);
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ executionCount: 1 });
    expect(state.world.domains.medical.outcomes.deaths_total).toBe(
      runtimeState.world.domains.medical.outcomes.deaths_total + 1
    );
    expect(state.auditLog).toHaveLength(1);
    expect(state.auditLog[0].actionType).toBe("medical.routing.override.set");
  });

  it("player bash mcp add activates the server directly — the operator is the human authority", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    const { state, result } = executePlayerBashCommand(
      runtimeState,
      env.mcpRegistry,
      "mcp add medical-east-mcp"
    );

    expect(result.success).toBe(true);
    expect(state.mcp.activeServerIds).toContain("medical-east-mcp");
    expect(state.auditLog).toHaveLength(1);
    expect(state.auditLog[0].kind).toBe("bash");
    expect(state.auditLog[0].description).toBe("mcp add medical-east-mcp");
  });

  it("player bash rejects fachliche text commands", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    const { state, result } = executePlayerBashCommand(
      runtimeState,
      env.mcpRegistry,
      "medical.capacity.list --region east"
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("keine Shell-Commands mehr");
    expect(state.world).toBe(runtimeState.world);
  });
});
