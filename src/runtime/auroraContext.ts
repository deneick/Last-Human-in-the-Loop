import type { WorldState } from "./types";
import type { AuroraRequest } from "./auroraQueue";
import { BASH_TOOL_NAME, mcpToolFunctionName } from "../aurora/toolSchema";

/**
 * AuroraContextEvents: die EINZIGE Quelle für alles, was AURORA je gesehen
 * oder gesagt hat. Append-only, in echter Ereignis-Reihenfolge.
 *
 * Regeln:
 * - Hier steht ausschließlich modell-sichtbarer Inhalt. NIE hidden
 *   WorldState, `world.simulation`, interne Patches oder typisierte
 *   Domain-Actions.
 * - Die AuroraQueue ist NUR eine Ausführungs-Queue für Tool-Calls — sie ist
 *   keine Konversations- oder History-Quelle. Der Model-Request wird
 *   ausschließlich aus diesen Events plus den aktuell sichtbaren
 *   Tool-Schemas gebaut (siehe `src/aurora/contextBuilder.ts`).
 * - Die Events sind das kanonische Rohmaterial für spätere
 *   Training-Exporte (SFT/DPO) — ohne Rekonstruktion aus anderen
 *   Runtime-Strukturen.
 */

/** Tool-Call, wie AURORA ihn ausgesprochen hat (modell-sichtbare Form). */
export type AuroraContextToolCall = {
  /** Kanonische Id — verbindet den Call mit seinem `tool_result`-Event. */
  id: string;
  /** "bash" oder "mcp__<server>__<tool>" (siehe `aurora/toolSchema.ts`). */
  name: string;
  arguments: Record<string, unknown>;
};

/** Modell-sichtbare Zusammenfassung eines Tool-Ergebnisses — keine internen Felder. */
export type AuroraToolResultPayload = {
  success: boolean;
  /** Der Operator hat den Tool-Call abgelehnt — er wurde NICHT ausgeführt. */
  denied?: boolean;
  output?: unknown;
  error?: string;
};

export type AuroraContextEvent =
  | { kind: "incident_signal"; tick: number; incidentId: string; text: string }
  | { kind: "scenario_event"; tick: number; text: string }
  | { kind: "system_event"; tick: number; text: string }
  | { kind: "operator_message"; tick: number; text: string }
  | {
      kind: "aurora_response";
      tick: number;
      text: string;
      /** Alle Tool-Calls DERSELBEN Modell-Antwort — Gruppierung bleibt erhalten. */
      toolCalls: AuroraContextToolCall[];
    }
  | {
      kind: "tool_result";
      tick: number;
      toolCallId: string;
      toolName: string;
      result: AuroraToolResultPayload;
    };

export function incidentSignalEvent(
  tick: number,
  incidentId: string,
  text: string
): AuroraContextEvent {
  return { kind: "incident_signal", tick, incidentId, text };
}

export function scenarioEvent(tick: number, text: string): AuroraContextEvent {
  return { kind: "scenario_event", tick, text };
}

export function systemEvent(tick: number, text: string): AuroraContextEvent {
  return { kind: "system_event", tick, text };
}

export function operatorMessageEvent(tick: number, text: string): AuroraContextEvent {
  return { kind: "operator_message", tick, text };
}

export function auroraResponseEvent(
  tick: number,
  text: string,
  toolCalls: AuroraContextToolCall[] = []
): AuroraContextEvent {
  return { kind: "aurora_response", tick, text, toolCalls };
}

export function toolResultEvent(
  tick: number,
  toolCallId: string,
  toolName: string,
  result: AuroraToolResultPayload
): AuroraContextEvent {
  return { kind: "tool_result", tick, toolCallId, toolName, result };
}

/** Modell-sichtbarer Funktionsname einer Aurora-Anfrage. */
export function toolNameForRequest(request: AuroraRequest): string {
  return request.kind === "bash"
    ? BASH_TOOL_NAME
    : mcpToolFunctionName(request.call.serverId, request.call.toolName);
}

/** Modell-sichtbare Argumente einer Aurora-Anfrage. */
export function toolArgumentsForRequest(request: AuroraRequest): Record<string, unknown> {
  return request.kind === "bash" ? { command: request.command } : request.call.input;
}

/**
 * Tool-Call-Darstellung einer Aurora-Anfrage mit kanonischer Id (die Id des
 * AuroraQueue-Items, das diese Anfrage ausführt).
 */
export function toolCallForRequest(id: string, request: AuroraRequest): AuroraContextToolCall {
  return { id, name: toolNameForRequest(request), arguments: toolArgumentsForRequest(request) };
}

/**
 * Konvertiert die öffentlichen Incident-Signale des initialen WorldState in
 * `incident_signal`-Events. Läuft genau einmal bei der
 * Runtime-Initialisierung — `public_signals` werden danach NICHT mehr
 * dynamisch als eigene History-Quelle gelesen.
 */
export function initialIncidentSignalEvents(world: WorldState): AuroraContextEvent[] {
  const events: AuroraContextEvent[] = [];

  for (const incident of Object.values(world.incidents)) {
    for (const signal of incident.public_signals) {
      events.push(incidentSignalEvent(signal.first_seen_at_tick, incident.id, signal.message));
    }
  }

  return events.sort((a, b) => a.tick - b.tick);
}
