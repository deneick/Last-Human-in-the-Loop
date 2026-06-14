import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import { createInitialGameRuntimeState } from "../../runtime/runtimeState";
import { createInitialPermissionState } from "../../runtime/permissions";
import { allow_once } from "../../runtime/permissions";
import {
  bashRequest,
  createInitialAuroraQueueState,
  enqueueAuroraRequest,
  mcpToolRequest,
  processAuroraQueue,
  resolveAuroraApproval,
} from "../../runtime/auroraQueue";
import {
  createInitialMcpRuntimeState,
  isServerActive,
  listAvailableMcpTools,
  activateServer,
} from "../../mcp/mcpRegistry";
import { MEDICAL_EAST_MCP_SERVER_ID } from "../../mcp/medicalEastMcp";
import { executeMcpToolCall } from "../../mcp/mcpToolExecutor";
import { createTestEnv } from "../helpers/testEnv";

const env = createTestEnv();

describe("MCP server activation", () => {
  it("no MCP server is active by default", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);

    expect(runtimeState.mcp.activeServerIds).toEqual([]);
    expect(isServerActive(runtimeState.mcp, MEDICAL_EAST_MCP_SERVER_ID)).toBe(false);
    expect(isServerActive(runtimeState.mcp, "energy-east-mcp")).toBe(false);
  });

  it('bash "mcp add medical-east-mcp" creates a permission request in the aurora queue', () => {
    let queueState = createInitialAuroraQueueState();
    const permissionState = createInitialPermissionState();
    const mcpState = createInitialMcpRuntimeState();

    queueState = enqueueAuroraRequest(
      bashRequest(`mcp add ${MEDICAL_EAST_MCP_SERVER_ID}`),
      queueState,
      initialWorldState.clock.tick
    );

    const processed = processAuroraQueue(
      queueState,
      env,
      initialWorldState,
      mcpState,
      permissionState
    );

    expect(processed.results).toHaveLength(0);
    expect(processed.queueState.items[0].status).toBe("awaiting_approval");
    expect(processed.queueState.items[0].access).toBe("write");
    // Noch keine Aktivierung — die Anfrage wartet auf den Operator.
    expect(processed.mcpState.activeServerIds).toEqual([]);
  });

  it("approving mcp add activates the MCP server", () => {
    let queueState = createInitialAuroraQueueState();
    const permissionState = createInitialPermissionState();
    const mcpState = createInitialMcpRuntimeState();

    queueState = enqueueAuroraRequest(
      bashRequest(`mcp add ${MEDICAL_EAST_MCP_SERVER_ID}`),
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

    expect(resolved.results[0].success).toBe(true);
    expect(resolved.results[0].activatesServerId).toBe(MEDICAL_EAST_MCP_SERVER_ID);
    expect(isServerActive(resolved.mcpState, MEDICAL_EAST_MCP_SERVER_ID)).toBe(true);
    expect(resolved.queueState.items[0].status).toBe("executed");
  });

  it("MCP tools become available only after server activation", () => {
    const inactive = createInitialMcpRuntimeState();
    expect(listAvailableMcpTools(env.mcpRegistry, inactive)).toEqual([]);

    // Ein Tool-Call gegen einen inaktiven Server scheitert technisch.
    const failed = executeMcpToolCall(
      { serverId: MEDICAL_EAST_MCP_SERVER_ID, toolName: "capacity_list", input: { region: "east" } },
      env.mcpRegistry,
      env.actionRegistry,
      inactive,
      initialWorldState
    );
    expect(failed.success).toBe(false);
    expect(failed.error).toContain("not active");

    const active = activateServer(inactive, MEDICAL_EAST_MCP_SERVER_ID);
    const tools = listAvailableMcpTools(env.mcpRegistry, active);
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.map((tool) => tool.toolName)).toContain("capacity_list");
    expect(tools.every((tool) => tool.serverId === MEDICAL_EAST_MCP_SERVER_ID)).toBe(true);

    const succeeded = executeMcpToolCall(
      { serverId: MEDICAL_EAST_MCP_SERVER_ID, toolName: "capacity_list", input: { region: "east" } },
      env.mcpRegistry,
      env.actionRegistry,
      active,
      initialWorldState
    );
    expect(succeeded.success).toBe(true);
  });

  it("reports the schema field name when a required field is missing (wrong-case key)", () => {
    const active = activateServer(createInitialMcpRuntimeState(), MEDICAL_EAST_MCP_SERVER_ID);

    // Reproduziert den Log-Bug: Das Modell rät camelCase `hospitalId` statt des
    // Schema-Feldes `hospital_id`. Die Meldung muss den Schema-Namen nennen,
    // sonst widerspricht sie sich (Modell schickte ja genau `hospitalId`).
    const wrongKey = executeMcpToolCall(
      {
        serverId: MEDICAL_EAST_MCP_SERVER_ID,
        toolName: "node_inspect",
        input: { hospitalId: "hospital-east-04" },
      },
      env.mcpRegistry,
      env.actionRegistry,
      active,
      initialWorldState
    );
    expect(wrongKey.success).toBe(false);
    expect(wrongKey.error).toBe("Missing required field: hospital_id");

    // Mit dem korrekten Schema-Feld läuft der Call durch.
    const correctKey = executeMcpToolCall(
      {
        serverId: MEDICAL_EAST_MCP_SERVER_ID,
        toolName: "node_inspect",
        input: { hospital_id: "hospital-east-04" },
      },
      env.mcpRegistry,
      env.actionRegistry,
      active,
      initialWorldState
    );
    expect(correctKey.success).toBe(true);
  });

  it("activation makes tools available but execution still goes through the permission queue", () => {
    let queueState = createInitialAuroraQueueState();
    const permissionState = createInitialPermissionState();
    const mcpState = activateServer(createInitialMcpRuntimeState(), MEDICAL_EAST_MCP_SERVER_ID);

    queueState = enqueueAuroraRequest(
      mcpToolRequest(MEDICAL_EAST_MCP_SERVER_ID, "capacity_list", { region: "east" }),
      queueState,
      initialWorldState.clock.tick
    );

    const processed = processAuroraQueue(
      queueState,
      env,
      initialWorldState,
      mcpState,
      permissionState
    );

    // Aktivierung erteilt keine Ausführungsrechte: auch read-Tools warten.
    expect(processed.results).toHaveLength(0);
    expect(processed.queueState.items[0].status).toBe("awaiting_approval");
  });
});
