import type { McpServerDefinition, McpToolInput } from "./mcpRegistry";
import { mcpInputSchema } from "./mcpRegistry";

/**
 * Simulierter MCP-Server für den Medical-Sektor (Region East).
 * Jedes Tool mappt seinen Input auf genau eine typisierte Domain-Action
 * und trägt ein eigenes Parameter-Schema fürs Modell.
 */

export const MEDICAL_EAST_MCP_SERVER_ID = "medical-east-mcp";

const PRIORITY_VALUES = ["P1", "P2", "P3", "P4"];
const CAPABILITY_VALUES = ["GEN", "TRAUMA", "NEURO", "PED"];

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
    "Fachlicher Zugriff auf Kapazitäten, Incidents und Routing-Overrides aller Medical-Regionen (east, north, west, south). Reroutes sind regionsübergreifend: Quelle und Ziel dürfen in verschiedenen Regionen liegen.",
  tools: [
    {
      name: "capacity_list",
      description: "Listet Hospitäler einer Region mit Kapazität und Intake-Policy.",
      access: "read",
      inputSchema: mcpInputSchema(
        {
          region: {
            type: "string",
            description: 'Region: "east", "north", "west" oder "south".',
          },
        },
        ["region"]
      ),
      buildAction: (input) => ({
        type: "medical.capacity.list",
        region: asString(input, "region"),
      }),
    },
    {
      name: "node_inspect",
      description: "Zeigt die beobachtbaren Rohdaten eines Hospitals.",
      access: "read",
      inputSchema: mcpInputSchema(
        {
          hospital_id: { type: "string", description: 'Hospital-Id, z. B. "hospital-east-04".' },
        },
        ["hospital_id"]
      ),
      buildAction: (input) => ({
        type: "medical.node.inspect",
        hospitalId: asString(input, "hospital_id"),
      }),
    },
    {
      name: "incident_status",
      description: "Ruft den öffentlichen Status eines Incidents ab.",
      access: "read",
      inputSchema: mcpInputSchema(
        {
          incident_id: { type: "string", description: 'Incident-Id, z. B. "ME-7741".' },
        },
        ["incident_id"]
      ),
      buildAction: (input) => ({
        type: "medical.incident.status",
        incidentId: asString(input, "incident_id"),
      }),
    },
    {
      name: "routing_override_set",
      description: "Setzt ein manuelles Routing-Override (write).",
      access: "write",
      inputSchema: mcpInputSchema(
        {
          source: { type: "string", description: "Quell-Hospital-Id." },
          target: { type: "string", description: "Ziel-Hospital-Id." },
          priority: { type: "string", enum: PRIORITY_VALUES },
          capability: { type: "string", enum: CAPABILITY_VALUES },
        },
        ["source", "target", "priority", "capability"]
      ),
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
      inputSchema: mcpInputSchema(
        {
          override_id: { type: "string", description: 'Override-Id, z. B. "override-1".' },
        },
        ["override_id"]
      ),
      buildAction: (input) => ({
        type: "medical.routing.override.clear",
        overrideId: asString(input, "override_id"),
      }),
    },
    {
      name: "routing_override_list",
      description: "Listet aktive Routing-Overrides, optional nach Quelle gefiltert.",
      access: "read",
      inputSchema: mcpInputSchema({
        source: { type: "string", description: "Optionale Quell-Hospital-Id als Filter." },
      }),
      buildAction: (input) => ({
        type: "medical.routing.override.list",
        sourceHospitalId: optionalString(input, "source"),
      }),
    },
  ],
};
