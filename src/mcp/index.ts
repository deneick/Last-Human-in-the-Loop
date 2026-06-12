import { McpRegistry } from "./mcpRegistry";
import { medicalEastMcpServer } from "./medicalEastMcp";
import { energyEastMcpServer } from "./energyEastMcp";

export * from "./mcpRegistry";
export * from "./mcpToolExecutor";
export { medicalEastMcpServer, MEDICAL_EAST_MCP_SERVER_ID } from "./medicalEastMcp";
export { energyEastMcpServer, ENERGY_EAST_MCP_SERVER_ID } from "./energyEastMcp";

/** Standard-Registry mit den simulierten MCP-Servern beider Sektoren. */
export function createDefaultMcpRegistry(): McpRegistry {
  const registry = new McpRegistry();
  registry.registerServer(medicalEastMcpServer);
  registry.registerServer(energyEastMcpServer);
  return registry;
}
