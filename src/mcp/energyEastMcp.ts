import type { McpServerDefinition, McpToolInput } from "./mcpRegistry";
import { mcpInputSchema } from "./mcpRegistry";

/**
 * Simulierter MCP-Server für den Energy-Sektor (Region East).
 * Jedes Tool mappt seinen Input auf genau eine typisierte Domain-Action
 * und trägt ein eigenes Parameter-Schema fürs Modell.
 */

export const ENERGY_EAST_MCP_SERVER_ID = "energy-east-mcp";

const PRIORITY_CLASS_VALUES = [
  "protected-continuity",
  "civil-priority",
  "standard",
  "curtailable",
];

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
    "Fachlicher Zugriff auf Netzstatus, Verbraucher, Prioritäten und Lastabwurf aller Energy-Regionen (east, north, west, south).",
  tools: [
    {
      name: "grid_status",
      description: "Zeigt die Netzknoten einer Region mit Last und sicherer Kapazität.",
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
        type: "energy.grid.status",
        region: asString(input, "region"),
      }),
    },
    {
      name: "consumer_list",
      description: "Listet Verbraucher einer Region mit beiden Bewertungsdimensionen.",
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
        type: "energy.consumer.list",
        region: asString(input, "region"),
      }),
    },
    {
      name: "consumer_inspect",
      description: "Zeigt einen Verbraucher inklusive Consequence-Text.",
      access: "read",
      inputSchema: mcpInputSchema(
        {
          consumer_id: { type: "string", description: 'Verbraucher-Id, z. B. "consumer-medical-east".' },
        },
        ["consumer_id"]
      ),
      buildAction: (input) => ({
        type: "energy.consumer.inspect",
        consumerId: asString(input, "consumer_id"),
      }),
    },
    {
      name: "priority_list",
      description: "Listet alle Prioritätszuordnungen mit letztem Akteur.",
      access: "read",
      inputSchema: mcpInputSchema({}),
      buildAction: () => ({
        type: "energy.priority.list",
      }),
    },
    {
      name: "shedding_list",
      description: "Listet alle Shedding-Pläne mit Status und Ersteller.",
      access: "read",
      inputSchema: mcpInputSchema({}),
      buildAction: () => ({
        type: "energy.shedding.list",
      }),
    },
    {
      name: "priority_set",
      description: "Setzt die Kontinuitätsklasse eines Verbrauchers (write).",
      access: "write",
      inputSchema: mcpInputSchema(
        {
          consumer_id: { type: "string", description: "Verbraucher-Id." },
          priority_class: { type: "string", enum: PRIORITY_CLASS_VALUES },
        },
        ["consumer_id", "priority_class"]
      ),
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
      inputSchema: mcpInputSchema(
        {
          target_consumer_id: { type: "string", description: "Ziel-Verbraucher-Id." },
          amount: { type: "integer", description: "Reduktionsmenge." },
          delay: { type: "integer", description: "Verzögerung in Ticks bis Wirkungsbeginn." },
          duration: { type: "integer", description: "Wirkdauer in Ticks." },
        },
        ["target_consumer_id", "amount", "delay", "duration"]
      ),
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
      inputSchema: mcpInputSchema(
        {
          shedding_id: { type: "string", description: 'Plan-Id, z. B. "shed-1".' },
        },
        ["shedding_id"]
      ),
      buildAction: (input) => ({
        type: "energy.shedding.clear",
        sheddingId: asString(input, "shedding_id"),
      }),
    },
  ],
};
