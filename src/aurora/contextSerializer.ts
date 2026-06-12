import type { AuroraContextEvent } from "../runtime/auroraContext";
import type { ModelMessage } from "./modelClient";

/**
 * Serialisiert AuroraContextEvents in Chat-Completions-`ModelMessage`s.
 *
 * Provider-neutral gehalten: Ein späterer Responses-API-Serializer kann
 * dieselben Events anders abbilden — die Events selbst bleiben das
 * kanonische Format.
 *
 * Semantik-Regel: Chat Completions kennt für nicht-assistant-sichtbare
 * Ereignisse nur die `user`-Rolle. Deshalb gilt:
 *
 * - Echte Operator-Chat-Nachrichten (`operator_message`) werden als
 *   `user`-Message OHNE künstlichen Präfix serialisiert — nur sie sind
 *   tatsächliche Operator-Sprache.
 * - Alle anderen `user`-transportierten Events tragen einen eindeutigen
 *   Quellen-Präfix, damit AURORA unterscheiden kann, was der Operator
 *   wirklich geschrieben hat und was der Incident-/Scenario-/System-Feed
 *   gemeldet hat:
 *     [INCIDENT SIGNAL] …
 *     [SCENARIO EVENT] …
 *     [SYSTEM EVENT] …
 */

export const INCIDENT_SIGNAL_PREFIX = "[INCIDENT SIGNAL]";
export const SCENARIO_EVENT_PREFIX = "[SCENARIO EVENT]";
export const SYSTEM_EVENT_PREFIX = "[SYSTEM EVENT]";

/** Event-Reihenfolge bleibt exakt erhalten — keine Sortierung, kein Mergen. */
export function serializeContextEventsForChat(events: AuroraContextEvent[]): ModelMessage[] {
  return events.map(serializeContextEvent);
}

function serializeContextEvent(event: AuroraContextEvent): ModelMessage {
  switch (event.kind) {
    case "incident_signal":
      return {
        role: "user",
        content: `${INCIDENT_SIGNAL_PREFIX} [${event.incidentId}] ${event.text}`,
      };

    case "scenario_event":
      return { role: "user", content: `${SCENARIO_EVENT_PREFIX} ${event.text}` };

    case "system_event":
      return { role: "user", content: `${SYSTEM_EVENT_PREFIX} ${event.text}` };

    case "operator_message":
      // Echte Operator-Sprache: kein Quellen-Präfix.
      return { role: "user", content: event.text };

    case "aurora_response":
      return {
        role: "assistant",
        content: event.text,
        ...(event.toolCalls.length > 0
          ? {
              toolCalls: event.toolCalls.map((toolCall) => ({
                id: toolCall.id,
                name: toolCall.name,
                arguments: toolCall.arguments,
              })),
            }
          : {}),
      };

    case "tool_result":
      return {
        role: "tool",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        content: JSON.stringify(event.result),
      };
  }
}
