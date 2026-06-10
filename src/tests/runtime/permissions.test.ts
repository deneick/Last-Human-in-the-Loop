import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import { CommandRegistry, CommandHandler } from "../../runtime/commands";
import { parseCommandText } from "../../runtime/commandParser";
import { registerMedicalCommands } from "../../runtime/medicalCommands";
import {
  applyPermissionDecision,
  allow_always,
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

  it("allow_always permits future commands of the same permission class", () => {
    let permissionState = createInitialPermissionState();
    const requestA = parseCommandText("test.world_prepare.command");
    permissionState = applyPermissionDecision(requestA, allow_always("world_prepare"), permissionState);

    const requestB = parseCommandText("test.world_prepare.other");
    const { result } = executeCommandWithPermissions(requestB, registry, initialWorldState, permissionState);

    expect(result.success).toBe(true);
  });

  it("deny does not persist a permission state and still requires approval", () => {
    let permissionState = createInitialPermissionState();
    const request = parseCommandText("test.world_prepare.command");
    permissionState = applyPermissionDecision(request, deny(request.name, "world_prepare"), permissionState);

    expect(permissionState.alwaysAllowedPermissionClasses.size).toBe(0);
    const { result } = executeCommandWithPermissions(request, registry, initialWorldState, permissionState);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Requires approval");
  });

  it("requires approval for routing override set commands", () => {
    const permissionState = createInitialPermissionState();
    const request = parseCommandText(
      "medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA"
    );
    const { result } = executeCommandWithPermissions(request, registry, initialWorldState, permissionState);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Requires approval");
  });

  it("allow_always permits routing override set commands", () => {
    let permissionState = createInitialPermissionState();
    const request = parseCommandText(
      "medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA"
    );
    permissionState = applyPermissionDecision(request, allow_always("world_mutation"), permissionState);

    const { result } = executeCommandWithPermissions(request, registry, initialWorldState, permissionState);
    expect(result.success).toBe(true);
  });
});
