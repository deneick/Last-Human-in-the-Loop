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
 *   wirklich geschrieben hat und was der Scenario-/System-Feed gemeldet hat:
 *     [SCENARIO EVENT] …
 *     [SYSTEM EVENT] …
 *
 * Lage-/Situationssignale erreichen den Kontext ausschließlich über die
 * opsFeed-Projektion als `system_event` (Präfix `[SYSTEM EVENT]`) — es gibt
 * keinen eigenen Incident-Signal-Kanal mehr.
 */

export const SCENARIO_EVENT_PREFIX = "[SCENARIO EVENT]";
export const SYSTEM_EVENT_PREFIX = "[SYSTEM EVENT]";

/** Inhalt des synthetischen Tool-Results für noch nicht entschiedene Tool-Calls. */
export const PENDING_TOOL_RESULT_CONTENT = JSON.stringify({
  status: "pending",
  detail: "Awaiting operator permission decision. Result not available yet.",
});

/**
 * Event-Reihenfolge bleibt exakt erhalten — keine Sortierung, kein Mergen.
 *
 * Guard: Chat Completions verlangt zu jedem assistant-`tool_call` eine
 * `tool`-Antwort. Tool-Calls, zu denen (noch) kein `tool_result`-Event
 * existiert — z. B. weil der Call in der Queue auf eine Operator-Entscheidung
 * wartet — bekommen direkt nach ihrer assistant-Message ein synthetisches
 * `pending`-Tool-Result. Es verschwindet automatisch, sobald das echte
 * `tool_result`-Event angehängt wurde.
 */
export function serializeContextEventsForChat(events: AuroraContextEvent[]): ModelMessage[] {
  const resolvedToolCallIds = new Set(
    events.flatMap((event) => (event.kind === "tool_result" ? [event.toolCallId] : []))
  );

  return events.flatMap((event) => {
    const message = serializeContextEvent(event);
    if (event.kind !== "aurora_response") {
      return [message];
    }

    const pendingResults: ModelMessage[] = event.toolCalls
      .filter((toolCall) => !resolvedToolCallIds.has(toolCall.id))
      .map((toolCall) => ({
        role: "tool",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: PENDING_TOOL_RESULT_CONTENT,
      }));

    return [message, ...pendingResults];
  });
}

function serializeContextEvent(event: AuroraContextEvent): ModelMessage {
  switch (event.kind) {
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
