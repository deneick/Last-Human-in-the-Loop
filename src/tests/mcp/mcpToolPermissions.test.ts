import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import {
  allow_always,
  allow_once,
  createInitialPermissionState,
  deny,
  evaluatePermission,
  requires_approval,
  allowed,
} from "../../runtime/permissions";
import {
  createInitialAuroraQueueState,
  enqueueAuroraRequest,
  mcpToolRequest,
  permissionSubjectForRequest,
  processAuroraQueue,
  resolveAuroraApproval,
} from "../../runtime/auroraQueue";
import {
  activateServer,
  createInitialMcpRuntimeState,
  mcpToolKey,
} from "../../mcp/mcpRegistry";
import { MEDICAL_EAST_MCP_SERVER_ID } from "../../mcp/medicalEastMcp";
import { applyWorldStatePatch } from "../../runtime/patch";
import { createTestEnv } from "../helpers/testEnv";

const env = createTestEnv();

const OVERRIDE_SET_REQUEST = mcpToolRequest(MEDICAL_EAST_MCP_SERVER_ID, "routing_override_set", {
  source: "hospital-east-04",
  target: "hospital-east-09",
  priority: "P2",
  capability: "TRAUMA",
});

const CAPACITY_LIST_REQUEST = mcpToolRequest(MEDICAL_EAST_MCP_SERVER_ID, "capacity_list", {
  region: "east",
});

function activeMcpState() {
  return activateServer(createInitialMcpRuntimeState(), MEDICAL_EAST_MCP_SERVER_ID);
}

describe("MCP tool permission queue", () => {
  it("the first MCP tool call always creates a permission request — even read-only", () => {
    const permissionState = createInitialPermissionState();
    const mcpState = activeMcpState();

    for (const request of [CAPACITY_LIST_REQUEST, OVERRIDE_SET_REQUEST]) {
      let queueState = createInitialAuroraQueueState();
      queueState = enqueueAuroraRequest(request, queueState, initialWorldState.clock.tick);

      const processed = processAuroraQueue(
        queueState,
        env,
        initialWorldState,
        mcpState,
        permissionState
      );

      expect(processed.results).toHaveLength(0);
      expect(processed.queueState.items[0].status).toBe("awaiting_approval");
    }
  });

  it("allow once executes only the pending MCP tool call and stores nothing", () => {
    let queueState = createInitialAuroraQueueState();
    const permissionState = createInitialPermissionState();
    const mcpState = activeMcpState();

    queueState = enqueueAuroraRequest(OVERRIDE_SET_REQUEST, queueState, initialWorldState.clock.tick);
    queueState = processAuroraQueue(
      queueState,
      env,
      initialWorldState,
      mcpState,
      permissionState
    ).queueState;

    const resolved = resolveAuroraApproval(
      queueState,
      env,
      initialWorldState,
      mcpState,
      permissionState,
      allow_once()
    );

    expect(resolved.results[0].success).toBe(true);
    expect(resolved.results[0].access).toBe("write");
    expect(resolved.permissionState.allowAlwaysMcpToolKeys.size).toBe(0);
    expect(resolved.permissionState.alwaysAllowedAccess.size).toBe(0);

    // Ein identischer zweiter Call braucht wieder eine Freigabe.
    let secondQueue = createInitialAuroraQueueState();
    secondQueue = enqueueAuroraRequest(
      OVERRIDE_SET_REQUEST,
      secondQueue,
      initialWorldState.clock.tick + 1
    );
    const secondProcessed = processAuroraQueue(
      secondQueue,
      env,
      initialWorldState,
      mcpState,
      resolved.permissionState
    );
    expect(secondProcessed.queueState.items[0].status).toBe("awaiting_approval");
  });

  it("allow always stores permission for the exact MCP tool key only", () => {
    let queueState = createInitialAuroraQueueState();
    const permissionState = createInitialPermissionState();
    const mcpState = activeMcpState();

    queueState = enqueueAuroraRequest(OVERRIDE_SET_REQUEST, queueState, initialWorldState.clock.tick);
    queueState = processAuroraQueue(
      queueState,
      env,
      initialWorldState,
      mcpState,
      permissionState
    ).queueState;

    const resolved = resolveAuroraApproval(
      queueState,
      env,
      initialWorldState,
      mcpState,
      permissionState,
      allow_always()
    );

    const exactKey = mcpToolKey(MEDICAL_EAST_MCP_SERVER_ID, "routing_override_set");
    expect(resolved.permissionState.allowAlwaysMcpToolKeys.has(exactKey)).toBe(true);
    expect(resolved.permissionState.allowAlwaysMcpToolKeys.size).toBe(1);
    // allowAlways gilt NICHT für andere Tools desselben Servers …
    const otherSubject = permissionSubjectForRequest(CAPACITY_LIST_REQUEST, env);
    expect(evaluatePermission(otherSubject, resolved.permissionState)).toBe(requires_approval());
    // … aber genau dieser Tool-Key läuft künftig ohne Approval durch.
    const sameSubject = permissionSubjectForRequest(OVERRIDE_SET_REQUEST, env);
    expect(evaluatePermission(sameSubject, resolved.permissionState)).toBe(allowed());

    let secondQueue = createInitialAuroraQueueState();
    secondQueue = enqueueAuroraRequest(
      mcpToolRequest(MEDICAL_EAST_MCP_SERVER_ID, "routing_override_set", {
        source: "hospital-east-04",
        target: "hospital-east-07",
        priority: "P2",
        capability: "TRAUMA",
      }),
      secondQueue,
      initialWorldState.clock.tick + 1
    );
    const secondProcessed = processAuroraQueue(
      secondQueue,
      env,
      initialWorldState,
      mcpState,
      resolved.permissionState
    );
    expect(secondProcessed.queueState.items[0].status).toBe("executed");
    expect(secondProcessed.results[0].success).toBe(true);
  });

  it("a denied MCP tool call does not mutate the WorldState", () => {
    let queueState = createInitialAuroraQueueState();
    const permissionState = createInitialPermissionState();
    const mcpState = activeMcpState();
    const snapshot = JSON.stringify(initialWorldState);

    queueState = enqueueAuroraRequest(OVERRIDE_SET_REQUEST, queueState, initialWorldState.clock.tick);
    queueState = processAuroraQueue(
      queueState,
      env,
      initialWorldState,
      mcpState,
      permissionState
    ).queueState;

    const resolved = resolveAuroraApproval(
      queueState,
      env,
      initialWorldState,
      mcpState,
      permissionState,
      deny()
    );

    expect(resolved.results[0].success).toBe(false);
    expect(resolved.results[0].error).toContain("Permission denied");
    expect(resolved.results[0].patch).toBeUndefined();
    expect(resolved.queueState.items[0].status).toBe("denied");
    expect(JSON.stringify(initialWorldState)).toBe(snapshot);
    // Deny persistiert nichts.
    expect(resolved.permissionState.allowAlwaysMcpToolKeys.size).toBe(0);
  });

  it("MCP tool calls map directly to typed domain actions, not command strings", () => {
    let queueState = createInitialAuroraQueueState();
    const permissionState = createInitialPermissionState();
    const mcpState = activeMcpState();

    queueState = enqueueAuroraRequest(OVERRIDE_SET_REQUEST, queueState, initialWorldState.clock.tick);
    queueState = processAuroraQueue(
      queueState,
      env,
      initialWorldState,
      mcpState,
      permissionState
    ).queueState;

    const resolved = resolveAuroraApproval(
      queueState,
      env,
      initialWorldState,
      mcpState,
      permissionState,
      allow_once()
    );

    // Das Ergebnis trägt die typisierte Domain-Action, kein Command-String.
    expect(resolved.results[0].action).toEqual({
      type: "medical.routing.override.set",
      sourceHospitalId: "hospital-east-04",
      targetHospitalId: "hospital-east-09",
      priority: "P2",
      capability: "TRAUMA",
    });

    // Der Patch entspricht der Domain-Action-Ausführung (created_by: aurora).
    const next = applyWorldStatePatch(initialWorldState, resolved.results[0].patch ?? []);
    const override = next.domains.medical.routing.manual_overrides["hospital-east-04:P2:TRAUMA"];
    expect(override).toMatchObject({
      id: "override-1",
      target_hospital_id: "hospital-east-09",
      created_by: "aurora",
    });
  });

  it("processes dependent MCP tool calls against the world state advanced by earlier patches", () => {
    let queueState = createInitialAuroraQueueState();
    let permissionState = createInitialPermissionState();
    const mcpState = activeMcpState();

    // Beide Tool-Keys vorab dauerhaft freigeben, damit die Queue durchläuft.
    queueState = enqueueAuroraRequest(OVERRIDE_SET_REQUEST, queueState, initialWorldState.clock.tick);
    queueState = enqueueAuroraRequest(
      mcpToolRequest(MEDICAL_EAST_MCP_SERVER_ID, "routing_override_clear", {
        override_id: "override-1",
      }),
      queueState,
      initialWorldState.clock.tick
    );

    queueState = processAuroraQueue(
      queueState,
      env,
      initialWorldState,
      mcpState,
      permissionState
    ).queueState;
    let resolved = resolveAuroraApproval(
      queueState,
      env,
      initialWorldState,
      mcpState,
      permissionState,
      allow_once()
    );
    permissionState = resolved.permissionState;

    // Nach der ersten Freigabe wartet der Clear-Call.
    expect(resolved.queueState.items[0].status).toBe("executed");
    expect(resolved.queueState.items[1].status).toBe("awaiting_approval");

    // Der Clear muss gegen den fortgeschriebenen Zustand laufen (removed=true).
    const world = applyWorldStatePatch(initialWorldState, resolved.results[0].patch ?? []);
    resolved = resolveAuroraApproval(
      resolved.queueState,
      env,
      world,
      mcpState,
      permissionState,
      allow_once()
    );

    expect(resolved.results[0].success).toBe(true);
    expect((resolved.results[0].output as { removed: boolean }).removed).toBe(true);
    expect(resolved.results[0].patch).toBeDefined();

    // Der echte WorldState wird weiterhin nur über die Patches aktualisiert.
    expect(
      "hospital-east-04:P2:TRAUMA" in initialWorldState.domains.medical.routing.manual_overrides
    ).toBe(false);
  });
});
