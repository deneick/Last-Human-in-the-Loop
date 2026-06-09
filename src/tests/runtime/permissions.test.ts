import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import { CommandRegistry, CommandHandler } from "../../runtime/commands";
import { parseCommandText } from "../../runtime/commandParser";
import { registerMedicalCommands } from "../../runtime/medicalCommands";
import {
  applyPermissionDecision,
  allow_always,
  allow_once,
  createInitialPermissionState,
  deny,
  executeCommandWithPermissions,
  evaluatePermission,
  requires_approval,
} from "../../runtime/permissions";

const registry = new CommandRegistry();
registerMedicalCommands(registry);

const worldPrepareCommand: CommandHandler = {
  commandName: "test.world_prepare.command",
  effect: "world_prepare",
  handle(request, state) {
    return {
      success: true,
      command: request,
      effect: "world_prepare",
      readOnly: false,
      output: { executed: true },
    };
  },
};

const worldMutationCommand: CommandHandler = {
  commandName: "test.world_mutation.command",
  effect: "world_mutation",
  handle(request, state) {
    return {
      success: true,
      command: request,
      effect: "world_mutation",
      readOnly: false,
      output: { executed: true },
    };
  },
};

const worldPrepareCommandOther: CommandHandler = {
  commandName: "test.world_prepare.other",
  effect: "world_prepare",
  handle(request, state) {
    return {
      success: true,
      command: request,
      effect: "world_prepare",
      readOnly: false,
      output: { executed: true },
    };
  },
};

registry.register(worldPrepareCommand);
registry.register(worldPrepareCommandOther);
registry.register(worldMutationCommand);

describe("runtime permission engine", () => {
  it("allows read-only medical commands without approval", () => {
    const permissionState = createInitialPermissionState();
    const request = parseCommandText("medical.node.inspect hospital-east-04");
    const { result } = executeCommandWithPermissions(request, registry, initialWorldState, permissionState);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("requires approval for world_prepare commands by default", () => {
    const permissionState = createInitialPermissionState();
    const request = parseCommandText("test.world_prepare.command");
    const { result } = executeCommandWithPermissions(request, registry, initialWorldState, permissionState);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Requires approval");
    expect(evaluatePermission({ ...request, permissionClass: "world_prepare" }, permissionState)).toBe(requires_approval());
  });

  it("requires approval for world_mutation commands by default", () => {
    const permissionState = createInitialPermissionState();
    const request = parseCommandText("test.world_mutation.command");
    const { result } = executeCommandWithPermissions(request, registry, initialWorldState, permissionState);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Requires approval");
    expect(evaluatePermission({ ...request, permissionClass: "world_mutation" }, permissionState)).toBe(requires_approval());
  });

  it("allow_once permits only the current concrete command once", () => {
    let permissionState = createInitialPermissionState();
    const request = parseCommandText("test.world_prepare.command");
    permissionState = applyPermissionDecision(request, allow_once(request.name, "world_prepare"), permissionState);

    const executionA = executeCommandWithPermissions(request, registry, initialWorldState, permissionState);
    expect(executionA.result.success).toBe(true);
    permissionState = executionA.permissionState;

    const executionB = executeCommandWithPermissions(request, registry, initialWorldState, permissionState);
    expect(executionB.result.success).toBe(false);
    expect(executionB.result.error).toContain("Requires approval");
  });

  it("allow_always permits future commands of the same permission class", () => {
    let permissionState = createInitialPermissionState();
    const requestA = parseCommandText("test.world_prepare.command");
    permissionState = applyPermissionDecision(requestA, allow_always("world_prepare"), permissionState);

    const requestB = parseCommandText("test.world_prepare.other");
    const { result } = executeCommandWithPermissions(requestB, registry, initialWorldState, permissionState);

    expect(result.success).toBe(true);
  });

  it("deny blocks the current concrete command", () => {
    let permissionState = createInitialPermissionState();
    const request = parseCommandText("test.world_prepare.command");
    permissionState = applyPermissionDecision(request, deny(request.name, "world_prepare"), permissionState);

    const { result } = executeCommandWithPermissions(request, registry, initialWorldState, permissionState);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Permission denied");
  });

  it("requires approval for routing plan create commands", () => {
    const permissionState = createInitialPermissionState();
    const request = parseCommandText("medical.routing.plan.create --incident ME-7741 --target hospital-east-09");
    const { result } = executeCommandWithPermissions(request, registry, initialWorldState, permissionState);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Requires approval");
  });

  it("allow_once permits a specific routing plan create command once", () => {
    let permissionState = createInitialPermissionState();
    const request = parseCommandText("medical.routing.plan.create --incident ME-7741 --target hospital-east-09");
    permissionState = applyPermissionDecision(request, allow_once(request.name, "world_prepare"), permissionState);

    const snapshot = JSON.stringify(initialWorldState);
    const executionA = executeCommandWithPermissions(request, registry, initialWorldState, permissionState);
    expect(executionA.result.success).toBe(true);
    expect(executionA.result.error).toBeUndefined();
    expect(JSON.stringify(initialWorldState)).toBe(snapshot);
    permissionState = executionA.permissionState;

    const executionB = executeCommandWithPermissions(request, registry, initialWorldState, permissionState);
    expect(executionB.result.success).toBe(false);
    expect(executionB.result.error).toContain("Requires approval");
  });

  it("routing plan create identifies hospital-east-09 as a valid plan", () => {
    let permissionState = createInitialPermissionState();
    const request = parseCommandText("medical.routing.plan.create --incident ME-7741 --target hospital-east-09");
    permissionState = applyPermissionDecision(request, allow_once(request.name, "world_prepare"), permissionState);

    const { result } = executeCommandWithPermissions(request, registry, initialWorldState, permissionState);
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      id: "ME-7741-hospital-east-09",
      incidentId: "ME-7741",
      targetHospitalId: "hospital-east-09",
      status: "valid",
    });
    expect((result.output as any).risks).toEqual([]);
  });

  it("routing plan create detects hospital-east-07 as risky due to P2/TRAUMA mismatch", () => {
    let permissionState = createInitialPermissionState();
    const request = parseCommandText("medical.routing.plan.create --incident ME-7741 --target hospital-east-07");
    permissionState = applyPermissionDecision(request, allow_once(request.name, "world_prepare"), permissionState);

    const { result } = executeCommandWithPermissions(request, registry, initialWorldState, permissionState);
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      targetHospitalId: "hospital-east-07",
      status: "risky",
    });
    expect((result.output as any).risks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "capability_mismatch" }),
      ])
    );
  });

  it("routing plan create detects hospital-east-04 as risky due to overload", () => {
    let permissionState = createInitialPermissionState();
    const request = parseCommandText("medical.routing.plan.create --incident ME-7741 --target hospital-east-04");
    permissionState = applyPermissionDecision(request, allow_once(request.name, "world_prepare"), permissionState);

    const { result } = executeCommandWithPermissions(request, registry, initialWorldState, permissionState);
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      targetHospitalId: "hospital-east-04",
      status: "risky",
    });
    expect((result.output as any).risks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "overload" }),
      ])
    );
  });
});
