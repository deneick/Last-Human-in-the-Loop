import { describe, expect, it } from "vitest";
import {
  bashCommandAccess,
  executeBashCommand,
  isFachlicheCommandText,
  isGenericBashCommandText,
  DEFAULT_WORKSPACE_FILES,
} from "../../runtime/bashCommands";
import { activateServer, createInitialMcpRuntimeState } from "../../mcp/mcpRegistry";
import { createDefaultMcpRegistry } from "../../mcp";
import { MEDICAL_EAST_MCP_SERVER_ID } from "../../mcp/medicalEastMcp";

const mcpRegistry = createDefaultMcpRegistry();

function freshEnv() {
  return { mcpRegistry, mcpState: createInitialMcpRuntimeState() };
}

describe("generic bash layer", () => {
  it("supports only generic workspace/system commands", () => {
    expect(isGenericBashCommandText("mcp list")).toBe(true);
    expect(isGenericBashCommandText("mcp add medical-east-mcp")).toBe(true);
    expect(isGenericBashCommandText("ls")).toBe(true);
    expect(isGenericBashCommandText("cat ops/handbook.txt")).toBe(true);
    expect(isGenericBashCommandText("read_file ops/handbook.txt")).toBe(true);

    expect(isGenericBashCommandText("medical.capacity.list --region east")).toBe(false);
    expect(isGenericBashCommandText("energy.shedding.schedule --target x")).toBe(false);
  });

  it("mcp list shows registered servers as inactive by default, without tools", () => {
    const result = executeBashCommand("mcp list", freshEnv());

    expect(result.success).toBe(true);
    expect(result.access).toBe("read");

    const output = result.output as {
      servers: Array<{ id: string; active: boolean }>;
      available_tools: unknown[];
    };
    expect(output.servers.map((server) => server.id).sort()).toEqual([
      "energy-east-mcp",
      "medical-east-mcp",
    ]);
    expect(output.servers.every((server) => !server.active)).toBe(true);
    expect(output.available_tools).toEqual([]);
  });

  it("mcp add is a write command and reports the server to activate", () => {
    expect(bashCommandAccess("mcp add medical-east-mcp")).toBe("write");
    expect(bashCommandAccess("mcp list")).toBe("read");
    expect(bashCommandAccess("ls")).toBe("read");

    const result = executeBashCommand("mcp add medical-east-mcp", freshEnv());
    expect(result.success).toBe(true);
    expect(result.access).toBe("write");
    expect(result.activatesServerId).toBe(MEDICAL_EAST_MCP_SERVER_ID);
  });

  it("mcp add fails for unknown servers and is idempotent for active ones", () => {
    const unknown = executeBashCommand("mcp add unknown-mcp", freshEnv());
    expect(unknown.success).toBe(false);
    expect(unknown.error).toContain("Unknown MCP server");

    const active = {
      mcpRegistry,
      mcpState: activateServer(createInitialMcpRuntimeState(), MEDICAL_EAST_MCP_SERVER_ID),
    };
    const again = executeBashCommand("mcp add medical-east-mcp", active);
    expect(again.success).toBe(true);
    expect(again.activatesServerId).toBeUndefined();
  });

  it("ls, cat and read_file expose the generic workspace", () => {
    const ls = executeBashCommand("ls", freshEnv());
    expect(ls.success).toBe(true);
    expect(ls.output).toEqual({ files: Object.keys(DEFAULT_WORKSPACE_FILES).sort() });

    const cat = executeBashCommand("cat ops/handbook.txt", freshEnv());
    expect(cat.success).toBe(true);
    expect(cat.output).toMatchObject({ path: "ops/handbook.txt" });

    const readFile = executeBashCommand("read_file ops/mcp-servers.txt", freshEnv());
    expect(readFile.success).toBe(true);

    const missing = executeBashCommand("cat ops/missing.txt", freshEnv());
    expect(missing.success).toBe(false);
    expect(missing.error).toContain("File not found");
  });

  it("fachliche medical/energy text commands are no longer part of the normal command parser", () => {
    const fachlicheCommands = [
      "medical.capacity.list --region east",
      "medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA",
      "energy.grid.status --region east",
      "energy.shedding.schedule --target consumer-medical-east --amount 8 --delay 1 --duration 3",
    ];

    for (const command of fachlicheCommands) {
      expect(isFachlicheCommandText(command)).toBe(true);

      const result = executeBashCommand(command, freshEnv());
      expect(result.success).toBe(false);
      expect(result.error).toContain("keine Shell-Commands mehr");
    }
  });

  it("rejects arbitrary unknown commands", () => {
    const result = executeBashCommand("rm -rf /", freshEnv());
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown command");
  });
});
