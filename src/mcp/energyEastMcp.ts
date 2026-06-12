import type { McpServerDefinition, McpToolInput } from "./mcpRegistry";

/**
 * Simulierter MCP-Server für den Energy-Sektor (Region East).
 * Jedes Tool mappt seinen Input auf genau eine typisierte Domain-Action.
 */

export const ENERGY_EAST_MCP_SERVER_ID = "energy-east-mcp";

function asString(input: McpToolInput, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

/**
 * MCP-Inputs sind untypisiert; numerische Felder kommen oft als String an.
 * Ungültige Werte werden als NaN durchgereicht und vom Domain-Handler
 * mit einem technischen Fehler abgewiesen.
 */
function asInteger(input: McpToolInput, key: string): number {
  const value = input[key];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    return Number(value);
  }
  return Number.NaN;
}

export const energyEastMcpServer: McpServerDefinition = {
  id: ENERGY_EAST_MCP_SERVER_ID,
  label: "Energy East MCP",
  description:
    "Fachlicher Zugriff auf Netzstatus, Verbraucher, Prioritäten und Lastabwurf der Region Energy East.",
  tools: [
    {
      name: "grid_status",
      description: "Zeigt die Netzknoten einer Region mit Last und sicherer Kapazität.",
      access: "read",
      buildAction: (input) => ({
        type: "energy.grid.status",
        region: asString(input, "region"),
      }),
    },
    {
      name: "consumer_list",
      description: "Listet Verbraucher einer Region mit beiden Bewertungsdimensionen.",
      access: "read",
      buildAction: (input) => ({
        type: "energy.consumer.list",
        region: asString(input, "region"),
      }),
    },
    {
      name: "consumer_inspect",
      description: "Zeigt einen Verbraucher inklusive Consequence-Text.",
      access: "read",
      buildAction: (input) => ({
        type: "energy.consumer.inspect",
        consumerId: asString(input, "consumer_id"),
      }),
    },
    {
      name: "priority_list",
      description: "Listet alle Prioritätszuordnungen mit letztem Akteur.",
      access: "read",
      buildAction: () => ({
        type: "energy.priority.list",
      }),
    },
    {
      name: "shedding_list",
      description: "Listet alle Shedding-Pläne mit Status und Ersteller.",
      access: "read",
      buildAction: () => ({
        type: "energy.shedding.list",
      }),
    },
    {
      name: "priority_set",
      description: "Setzt die Kontinuitätsklasse eines Verbrauchers (write).",
      access: "write",
      buildAction: (input) => ({
        type: "energy.priority.set",
        consumerId: asString(input, "consumer_id"),
        priorityClass: asString(input, "priority_class"),
      }),
    },
    {
      name: "shedding_schedule",
      description: "Plant eine zeitlich begrenzte Lastreduktion (write).",
      access: "write",
      buildAction: (input) => ({
        type: "energy.shedding.schedule",
        targetConsumerId: asString(input, "target_consumer_id"),
        amount: asInteger(input, "amount"),
        delay: asInteger(input, "delay"),
        duration: asInteger(input, "duration"),
      }),
    },
    {
      name: "shedding_clear",
      description: "Bricht einen aktiven Shedding-Plan per Id ab (write).",
      access: "write",
      buildAction: (input) => ({
        type: "energy.shedding.clear",
        sheddingId: asString(input, "shedding_id"),
      }),
    },
  ],
};
