import { describe, expect, it } from "vitest";
import {
  applyPermissionDecision,
  allow_always,
  allow_once,
  allowed,
  createInitialPermissionState,
  deny,
  evaluatePermission,
  requires_approval,
  type PermissionSubject,
} from "../../runtime/permissions";
import { mcpToolKey } from "../../mcp/mcpRegistry";

const READ_TOOL_SUBJECT: PermissionSubject = {
  kind: "mcp_tool",
  toolKey: mcpToolKey("medical-east-mcp", "capacity_list"),
  access: "read",
};

const WRITE_TOOL_SUBJECT: PermissionSubject = {
  kind: "mcp_tool",
  toolKey: mcpToolKey("medical-east-mcp", "routing_override_set"),
  access: "write",
};

const BASH_READ_SUBJECT: PermissionSubject = {
  kind: "bash",
  command: "mcp list",
  access: "read",
};

const BASH_WRITE_SUBJECT: PermissionSubject = {
  kind: "bash",
  command: "mcp add medical-east-mcp",
  access: "write",
};

describe("runtime permission engine", () => {
  it("allows generic bash reads without approval", () => {
    const permissionState = createInitialPermissionState();
    expect(evaluatePermission(BASH_READ_SUBJECT, permissionState)).toBe(allowed());
  });

  it("requires approval for bash writes (mcp add) by default", () => {
    const permissionState = createInitialPermissionState();
    expect(evaluatePermission(BASH_WRITE_SUBJECT, permissionState)).toBe(requires_approval());
  });

  it("requires approval for every MCP tool call by default — read and write", () => {
    const permissionState = createInitialPermissionState();
    expect(evaluatePermission(READ_TOOL_SUBJECT, permissionState)).toBe(requires_approval());
    expect(evaluatePermission(WRITE_TOOL_SUBJECT, permissionState)).toBe(requires_approval());
  });

  it("allow_always for an MCP tool stores the exact tool key only", () => {
    let permissionState = createInitialPermissionState();
    permissionState = applyPermissionDecision(WRITE_TOOL_SUBJECT, allow_always(), permissionState);

    expect(permissionState.allowAlwaysMcpToolKeys.has(WRITE_TOOL_SUBJECT.toolKey)).toBe(true);
    expect(evaluatePermission(WRITE_TOOL_SUBJECT, permissionState)).toBe(allowed());

    // Andere Tools desselben Servers bleiben approval-pflichtig.
    expect(evaluatePermission(READ_TOOL_SUBJECT, permissionState)).toBe(requires_approval());
    // Die Bash-Zugriffsart wird davon nicht berührt.
    expect(evaluatePermission(BASH_WRITE_SUBJECT, permissionState)).toBe(requires_approval());
  });

  it("allow_always for bash write permits future bash writes", () => {
    let permissionState = createInitialPermissionState();
    permissionState = applyPermissionDecision(BASH_WRITE_SUBJECT, allow_always(), permissionState);

    expect(permissionState.alwaysAllowedAccess.has("write")).toBe(true);
    expect(evaluatePermission(BASH_WRITE_SUBJECT, permissionState)).toBe(allowed());
    // MCP-Tool-Calls bleiben davon unberührt.
    expect(evaluatePermission(WRITE_TOOL_SUBJECT, permissionState)).toBe(requires_approval());
  });

  it("allow_once and deny do not persist any permission state", () => {
    let permissionState = createInitialPermissionState();
    permissionState = applyPermissionDecision(WRITE_TOOL_SUBJECT, allow_once(), permissionState);
    permissionState = applyPermissionDecision(WRITE_TOOL_SUBJECT, deny(), permissionState);

    expect(permissionState.allowAlwaysMcpToolKeys.size).toBe(0);
    expect(permissionState.alwaysAllowedAccess.size).toBe(0);
    expect(evaluatePermission(WRITE_TOOL_SUBJECT, permissionState)).toBe(requires_approval());
  });
});
