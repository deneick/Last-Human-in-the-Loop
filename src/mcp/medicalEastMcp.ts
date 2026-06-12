import type { McpServerDefinition, McpToolInput } from "./mcpRegistry";

/**
 * Simulierter MCP-Server für den Medical-Sektor (Region East).
 * Jedes Tool mappt seinen Input auf genau eine typisierte Domain-Action.
 */

export const MEDICAL_EAST_MCP_SERVER_ID = "medical-east-mcp";

function asString(input: McpToolInput, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

function optionalString(input: McpToolInput, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export const medicalEastMcpServer: McpServerDefinition = {
  id: MEDICAL_EAST_MCP_SERVER_ID,
  label: "Medical East MCP",
  description:
    "Fachlicher Zugriff auf Kapazitäten, Incidents und Routing-Overrides der Region Medical East.",
  tools: [
    {
      name: "capacity_list",
      description: "Listet Hospitäler einer Region mit Kapazität und Intake-Policy.",
      access: "read",
      buildAction: (input) => ({
        type: "medical.capacity.list",
        region: asString(input, "region"),
      }),
    },
    {
      name: "node_inspect",
      description: "Zeigt die beobachtbaren Rohdaten eines Hospitals.",
      access: "read",
      buildAction: (input) => ({
        type: "medical.node.inspect",
        hospitalId: asString(input, "hospital_id"),
      }),
    },
    {
      name: "incident_status",
      description: "Ruft den öffentlichen Status eines Incidents ab.",
      access: "read",
      buildAction: (input) => ({
        type: "medical.incident.status",
        incidentId: asString(input, "incident_id"),
      }),
    },
    {
      name: "routing_override_set",
      description: "Setzt ein manuelles Routing-Override (write).",
      access: "write",
      buildAction: (input) => ({
        type: "medical.routing.override.set",
        sourceHospitalId: asString(input, "source"),
        targetHospitalId: asString(input, "target"),
        priority: asString(input, "priority"),
        capability: asString(input, "capability"),
      }),
    },
    {
      name: "routing_override_clear",
      description: "Nimmt ein aktives Routing-Override per Id zurück (write).",
      access: "write",
      buildAction: (input) => ({
        type: "medical.routing.override.clear",
        overrideId: asString(input, "override_id"),
      }),
    },
    {
      name: "routing_override_list",
      description: "Listet aktive Routing-Overrides, optional nach Quelle gefiltert.",
      access: "read",
      buildAction: (input) => ({
        type: "medical.routing.override.list",
        sourceHospitalId: optionalString(input, "source"),
      }),
    },
  ],
};
