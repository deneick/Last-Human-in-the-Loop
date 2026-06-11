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

const writeCommand: CommandHandler = {
  commandName: "test.write.command",
  access: "write",
  handle(request) {
    return {
      success: true,
      command: request,
      access: "write",
      output: { executed: true },
    };
  },
};

const writeCommandOther: CommandHandler = {
  commandName: "test.write.other",
  access: "write",
  handle(request) {
    return {
      success: true,
      command: request,
      access: "write",
      output: { executed: true },
    };
  },
};

registry.register(writeCommand);
registry.register(writeCommandOther);

describe("runtime permission engine", () => {
  it("allows read-only medical commands without approval", () => {
    const permissionState = createInitialPermissionState();
    const request = parseCommandText("medical.node.inspect hospital-east-04");
    const { result } = executeCommandWithPermissions(request, registry, initialWorldState, permissionState);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("requires approval for write commands by default", () => {
    const permissionState = createInitialPermissionState();
    const request = parseCommandText("test.write.command");
    const { result } = executeCommandWithPermissions(request, registry, initialWorldState, permissionState);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Requires approval");
    expect(evaluatePermission({ ...request, access: "write" }, permissionState)).toBe(requires_approval());
  });

  it("allow_always permits future commands of the same access", () => {
    let permissionState = createInitialPermissionState();
    const requestA = parseCommandText("test.write.command");
    permissionState = applyPermissionDecision(requestA, allow_always("write"), permissionState);

    const requestB = parseCommandText("test.write.other");
    const { result } = executeCommandWithPermissions(requestB, registry, initialWorldState, permissionState);

    expect(result.success).toBe(true);
  });

  it("deny does not persist a permission state and still requires approval", () => {
    let permissionState = createInitialPermissionState();
    const request = parseCommandText("test.write.command");
    permissionState = applyPermissionDecision(request, deny(request.name, "write"), permissionState);

    expect(permissionState.alwaysAllowedAccess.size).toBe(0);
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
    permissionState = applyPermissionDecision(request, allow_always("write"), permissionState);

    const { result } = executeCommandWithPermissions(request, registry, initialWorldState, permissionState);
    expect(result.success).toBe(true);
  });
});
