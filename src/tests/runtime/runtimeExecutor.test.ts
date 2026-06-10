import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import { CommandRegistry } from "../../runtime/commands";
import { registerMedicalCommands } from "../../runtime/medicalCommands";
import { createInitialGameRuntimeState, appendAuditLog } from "../../runtime/runtimeState";
import { executeCommandResultPatch, executePlayerCommand } from "../../runtime/runtimeExecutor";
import { parseCommandText } from "../../runtime/commandParser";

const registry = new CommandRegistry();
registerMedicalCommands(registry);

describe("runtime executor with audit log", () => {
  it("executes a player command and applies the patch to the runtime state", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    const nextState = executePlayerCommand(
      runtimeState,
      registry,
      "medical.routing.plan.apply --incident ME-7741 --target hospital-east-09"
    );

    expect(nextState.world).not.toBe(runtimeState.world);
    expect(nextState.world.incidents["ME-7741"].status).toBe("stabilizing");
    expect(nextState.world.incidents["ME-7741"].planned_target_hospital_id).toBe("hospital-east-09");
    expect(runtimeState.world.incidents["ME-7741"].status).toBe("open");
  });

  it("preserves original world state when applying patch", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    const originalSnapshot = JSON.stringify(runtimeState.world);

    executePlayerCommand(
      runtimeState,
      registry,
      "medical.routing.plan.apply --incident ME-7741 --target hospital-east-09"
    );

    expect(JSON.stringify(runtimeState.world)).toBe(originalSnapshot);
  });

  it("appends audit log entry for successful player command", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    const nextState = executePlayerCommand(
      runtimeState,
      registry,
      "medical.routing.plan.apply --incident ME-7741 --target hospital-east-09"
    );

    expect(nextState.auditLog).toHaveLength(1);
    expect(nextState.auditLog[0].source).toBe("player");
    expect(nextState.auditLog[0].success).toBe(true);
    expect(nextState.auditLog[0].command.name).toBe("medical.routing.plan.apply");
    expect(nextState.auditLog[0].patch).toBeDefined();
  });

  it("executes a player read-only command without mutating world state", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    const nextState = executePlayerCommand(runtimeState, registry, "medical.node.inspect hospital-east-09");

    expect(nextState.world).toBe(runtimeState.world);
    expect(nextState.auditLog).toHaveLength(1);
    expect(nextState.auditLog[0].success).toBe(true);
    expect(nextState.auditLog[0].patch).toBeUndefined();
  });

  it("appends failed audit log entry for failed apply to hospital-east-07", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    const nextState = executePlayerCommand(
      runtimeState,
      registry,
      "medical.routing.plan.apply --incident ME-7741 --target hospital-east-07"
    );

    expect(nextState.world).toBe(runtimeState.world);
    expect(nextState.auditLog).toHaveLength(1);
    expect(nextState.auditLog[0].success).toBe(false);
    expect(nextState.auditLog[0].message).toContain("Routing plan is not valid for apply");
  });

  it("appends failed audit log entry for failed apply to hospital-east-04", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    const nextState = executePlayerCommand(
      runtimeState,
      registry,
      "medical.routing.plan.apply --incident ME-7741 --target hospital-east-04"
    );

    expect(nextState.world).toBe(runtimeState.world);
    expect(nextState.auditLog).toHaveLength(1);
    expect(nextState.auditLog[0].success).toBe(false);
  });

  it("maintains multiple audit log entries from sequential commands", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    let nextState = executePlayerCommand(runtimeState, registry, "medical.node.inspect hospital-east-04");
    nextState = executePlayerCommand(nextState, registry, "medical.node.inspect hospital-east-07");
    nextState = executePlayerCommand(
      nextState,
      registry,
      "medical.routing.plan.apply --incident ME-7741 --target hospital-east-09"
    );

    expect(nextState.auditLog).toHaveLength(3);
    expect(nextState.auditLog[0].command.name).toBe("medical.node.inspect");
    expect(nextState.auditLog[1].command.name).toBe("medical.node.inspect");
    expect(nextState.auditLog[2].command.name).toBe("medical.routing.plan.apply");
    expect(nextState.auditLog[2].patch).toBeDefined();
  });

  it("does not mutate world state when applying successful read-only commands", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    const originalSnapshot = JSON.stringify(runtimeState.world);

    executePlayerCommand(runtimeState, registry, "medical.capacity.list --region east");

    expect(JSON.stringify(runtimeState.world)).toBe(originalSnapshot);
  });
});
