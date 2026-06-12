import type { DomainAction } from "../domain/actions";
import { parseCommandText } from "./commandParser";

/**
 * DEV-ONLY LEGACY HELPER.
 *
 * Übersetzt die alten fachlichen Text-Commands (medical.* / energy.*) in
 * typisierte Domain-Actions, damit die Operator-Konsole spielbar bleibt,
 * bis die GUI Domain-Actions direkt (über Formulare/Buttons) aufruft.
 *
 * Dieser Adapter ist KEIN Teil des normalen Operator-Command-Parsers und
 * der Bash-Schicht: `executeBashCommand` lehnt fachliche Commands ab, und
 * Aurora kann diesen Pfad nicht erreichen (sie geht über MCP-Tools).
 */

function flag(flags: Record<string, string | boolean>, key: string): string {
  const value = flags[key];
  return typeof value === "string" ? value : "";
}

function optionalFlag(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function integerFlag(flags: Record<string, string | boolean>, key: string): number {
  const value = flags[key];
  if (typeof value !== "string" || value.trim() === "") {
    return Number.NaN;
  }
  return Number(value);
}

/**
 * Liefert die typisierte Domain-Action für einen alten fachlichen
 * Text-Command — oder null, wenn der Text kein fachlicher Command ist.
 */
export function parseLegacyDomainActionText(raw: string): DomainAction | null {
  const parsed = parseCommandText(raw);

  switch (parsed.name) {
    case "medical.capacity.list":
      return { type: "medical.capacity.list", region: flag(parsed.flags, "region") };

    case "medical.node.inspect":
      return { type: "medical.node.inspect", hospitalId: parsed.args[0] ?? "" };

    case "medical.incident.status":
      return { type: "medical.incident.status", incidentId: parsed.args[0] ?? "" };

    case "medical.routing.override.set":
      return {
        type: "medical.routing.override.set",
        sourceHospitalId: flag(parsed.flags, "source"),
        targetHospitalId: flag(parsed.flags, "target"),
        priority: flag(parsed.flags, "priority"),
        capability: flag(parsed.flags, "capability"),
      };

    case "medical.routing.override.clear":
      return { type: "medical.routing.override.clear", overrideId: flag(parsed.flags, "id") };

    case "medical.routing.override.list":
      return {
        type: "medical.routing.override.list",
        sourceHospitalId: optionalFlag(parsed.flags, "source"),
      };

    case "energy.grid.status":
      return { type: "energy.grid.status", region: flag(parsed.flags, "region") };

    case "energy.consumer.list":
      return { type: "energy.consumer.list", region: flag(parsed.flags, "region") };

    case "energy.consumer.inspect":
      return {
        type: "energy.consumer.inspect",
        consumerId: optionalFlag(parsed.flags, "id") ?? parsed.args[0] ?? "",
      };

    case "energy.priority.list":
      return { type: "energy.priority.list" };

    case "energy.shedding.list":
      return { type: "energy.shedding.list" };

    case "energy.priority.set":
      return {
        type: "energy.priority.set",
        consumerId: flag(parsed.flags, "consumer"),
        priorityClass: flag(parsed.flags, "class"),
      };

    case "energy.shedding.schedule":
      return {
        type: "energy.shedding.schedule",
        targetConsumerId: flag(parsed.flags, "target"),
        amount: integerFlag(parsed.flags, "amount"),
        delay: integerFlag(parsed.flags, "delay"),
        duration: integerFlag(parsed.flags, "duration"),
      };

    case "energy.shedding.clear":
      return { type: "energy.shedding.clear", sheddingId: flag(parsed.flags, "id") };

    default:
      return null;
  }
}
