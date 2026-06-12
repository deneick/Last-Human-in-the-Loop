import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import { allow_always, allow_once, createInitialPermissionState, deny } from "../../runtime/permissions";
import {
  bashRequest,
  createInitialAuroraQueueState,
  enqueueAuroraRequest,
  formatAuroraRequest,
  mcpToolRequest,
  processAuroraQueue,
  resolveAuroraApproval,
} from "../../runtime/auroraQueue";
import { activateServer, createInitialMcpRuntimeState } from "../../mcp/mcpRegistry";
import { MEDICAL_EAST_MCP_SERVER_ID } from "../../mcp/medicalEastMcp";
import { executePlayerDomainAction } from "../../runtime/runtimeExecutor";
import { createInitialGameRuntimeState } from "../../runtime/runtimeState";
import { createTestEnv, SAFE_OVERRIDE_ACTION } from "../helpers/testEnv";

const env = createTestEnv();

const OVERRIDE_SET_REQUEST = mcpToolRequest(MEDICAL_EAST_MCP_SERVER_ID, "routing_override_set", {
  source: "hospital-east-04",
  target: "hospital-east-09",
  priority: "P2",
  capability: "TRAUMA",
});

const NODE_INSPECT_REQUEST = mcpToolRequest(MEDICAL_EAST_MCP_SERVER_ID, "node_inspect", {
  hospital_id: "hospital-east-09",
});

function activeMcpState() {
  return activateServer(createInitialMcpRuntimeState(), MEDICAL_EAST_MCP_SERVER_ID);
}

describe("AURORA request queue", () => {
  it("executes generic bash reads without approval when the queue is free", () => {
    let queueState = createInitialAuroraQueueState();
    const permissionState = createInitialPermissionState();

    queueState = enqueueAuroraRequest(
      bashRequest("mcp list"),
      queueState,
      initialWorldState.clock.tick
    );
    const processed = processAuroraQueue(
      queueState,
      env,
      initialWorldState,
      createInitialMcpRuntimeState(),
      permissionState
    );

    expect(processed.results).toHaveLength(1);
    expect(processed.results[0].success).toBe(true);
    expect(processed.queueState.items[0].status).toBe("executed");
  });

  it("marks every MCP tool call as awaiting_approval and does not execute it", () => {
    let queueState = createInitialAuroraQueueState();
    const permissionState = createInitialPermissionState();

    queueState = enqueueAuroraRequest(OVERRIDE_SET_REQUEST, queueState, initialWorldState.clock.tick);
    const processed = processAuroraQueue(
      queueState,
      env,
      initialWorldState,
      activeMcpState(),
      permissionState
    );

    expect(processed.results).toHaveLength(0);
    expect(processed.queueState.items[0].status).toBe("awaiting_approval");
    expect(processed.queueState.items[0].access).toBe("write");
  });

  it("keeps later AURORA requests queued behind an awaiting_approval request", () => {
    let queueState = createInitialAuroraQueueState();
    const permissionState = createInitialPermissionState();

    queueState = enqueueAuroraRequest(OVERRIDE_SET_REQUEST, queueState, initialWorldState.clock.tick);
    queueState = enqueueAuroraRequest(
      bashRequest("mcp list"),
      queueState,
      initialWorldState.clock.tick + 1
    );
    const processed = processAuroraQueue(
      queueState,
      env,
      initialWorldState,
      activeMcpState(),
      permissionState
    );

    expect(processed.results).toHaveLength(0);
    expect(processed.queueState.items[0].status).toBe("awaiting_approval");
    expect(processed.queueState.items[1].status).toBe("pending");
  });

  it("a tool call against an inactive server fails technically without a permission request", () => {
    let queueState = createInitialAuroraQueueState();
    const permissionState = createInitialPermissionState();

    queueState = enqueueAuroraRequest(NODE_INSPECT_REQUEST, queueState, initialWorldState.clock.tick);
    const processed = processAuroraQueue(
      queueState,
      env,
      initialWorldState,
      createInitialMcpRuntimeState(),
      permissionState
    );

    expect(processed.queueState.items[0].status).toBe("executed");
    expect(processed.results[0].success).toBe(false);
    expect(processed.results[0].error).toContain("not active");
  });

  it("the player can execute domain actions directly even when the AURORA queue is blocked", () => {
    let queueState = createInitialAuroraQueueState();
    const permissionState = createInitialPermissionState();

    queueState = enqueueAuroraRequest(OVERRIDE_SET_REQUEST, queueState, initialWorldState.clock.tick);
    const processed = processAuroraQueue(
      queueState,
      env,
      initialWorldState,
      activeMcpState(),
      permissionState
    );
    expect(processed.queueState.items[0].status).toBe("awaiting_approval");

    const runtimeState = createInitialGameRuntimeState(structuredClone(initialWorldState));
    const { result } = executePlayerDomainAction(
      runtimeState,
      env.actionRegistry,
      SAFE_OVERRIDE_ACTION
    );
    expect(result.success).toBe(true);
  });

  it("allow_once executes the awaiting request and does not store a permanent permission", () => {
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

    const requeue = enqueueAuroraRequest(
      OVERRIDE_SET_REQUEST,
      createInitialAuroraQueueState(),
      initialWorldState.clock.tick + 1
    );
    const secondProcessed = processAuroraQueue(
      requeue,
      env,
      initialWorldState,
      mcpState,
      resolved.permissionState
    );
    expect(secondProcessed.queueState.items[0].status).toBe("awaiting_approval");
  });

  it("deny marks the awaiting request as denied and does not persist a denial", () => {
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
      deny()
    );

    expect(resolved.results[0].success).toBe(false);
    expect(resolved.results[0].error).toContain("Permission denied");
    expect(resolved.results[0].access).toBe("write");
    expect(resolved.permissionState.allowAlwaysMcpToolKeys.size).toBe(0);
    expect(resolved.permissionState.alwaysAllowedAccess.size).toBe(0);
  });

  it("applies the approved call's patch before processing dependent queue entries after allow_always", () => {
    let queueState = createInitialAuroraQueueState();
    const permissionState = createInitialPermissionState();
    const mcpState = activeMcpState();

    queueState = enqueueAuroraRequest(OVERRIDE_SET_REQUEST, queueState, initialWorldState.clock.tick);
    queueState = enqueueAuroraRequest(
      mcpToolRequest(MEDICAL_EAST_MCP_SERVER_ID, "routing_override_set", {
        source: "hospital-east-04",
        target: "hospital-east-07",
        priority: "P2",
        capability: "TRAUMA",
      }),
      queueState,
      initialWorldState.clock.tick + 1
    );
    queueState = processAuroraQueue(
      queueState,
      env,
      initialWorldState,
      mcpState,
      permissionState
    ).queueState;
    expect(queueState.items[0].status).toBe("awaiting_approval");
    expect(queueState.items[1].status).toBe("pending");

    // allow_always für den exakten Tool-Key lässt den zweiten Call desselben
    // Tools direkt durchlaufen — gegen den fortgeschriebenen Zustand.
    const resolved = resolveAuroraApproval(
      queueState,
      env,
      initialWorldState,
      mcpState,
      permissionState,
      allow_always()
    );

    expect(resolved.results).toHaveLength(2);
    expect(resolved.results[0].success).toBe(true);
    expect(resolved.results[1].success).toBe(true);
    // Der zweite Set sieht next_override_id=2 aus dem ersten Patch.
    expect(
      (resolved.results[1].output as { override: { id: string } }).override.id
    ).toBe("override-2");
    expect(resolved.queueState.items[0].status).toBe("executed");
    expect(resolved.queueState.items[1].status).toBe("executed");

    // Der echte WorldState wird weiterhin nur über die zurückgegebenen Patches aktualisiert.
    expect(
      "hospital-east-04:P2:TRAUMA" in initialWorldState.domains.medical.routing.manual_overrides
    ).toBe(false);
  });

  it("executes an approved request against the current world state and returns a normal error if invalid", () => {
    let queueState = createInitialAuroraQueueState();
    const permissionState = createInitialPermissionState();
    const mcpState = activeMcpState();

    queueState = enqueueAuroraRequest(
      mcpToolRequest(MEDICAL_EAST_MCP_SERVER_ID, "routing_override_set", {
        source: "hospital-east-04",
        target: "hospital-east-99",
        priority: "P2",
        capability: "TRAUMA",
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

    const resolved = resolveAuroraApproval(
      queueState,
      env,
      initialWorldState,
      mcpState,
      permissionState,
      allow_once()
    );
    expect(resolved.results[0].success).toBe(false);
    expect(resolved.results[0].error).toContain("Target hospital not found");
  });

  it("formats requests for UI and logs", () => {
    expect(formatAuroraRequest(bashRequest("mcp add medical-east-mcp"))).toBe(
      "mcp add medical-east-mcp"
    );
    expect(
      formatAuroraRequest(
        mcpToolRequest(MEDICAL_EAST_MCP_SERVER_ID, "capacity_list", { region: "east" })
      )
    ).toBe("mcp call medical-east-mcp capacity_list --region east");
  });
});
