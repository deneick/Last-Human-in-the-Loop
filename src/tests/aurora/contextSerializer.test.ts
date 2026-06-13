import { describe, expect, it } from "vitest";
import {
  auroraResponseEvent,
  operatorMessageEvent,
  scenarioEvent,
  systemEvent,
  toolResultEvent,
  type AuroraContextEvent,
} from "../../runtime/auroraContext";
import {
  PENDING_TOOL_RESULT_CONTENT,
  SCENARIO_EVENT_PREFIX,
  SYSTEM_EVENT_PREFIX,
  serializeContextEventsForChat,
} from "../../aurora/contextSerializer";

describe("serializeContextEventsForChat", () => {
  it("serializes scenario/system events as user messages with a clear source prefix", () => {
    // Lage-/Situationssignale erreichen den Kontext als system_event über die
    // opsFeed-Projektion — kein eigener Incident-Signal-Kanal mehr.
    const messages = serializeContextEventsForChat([
      systemEvent(0, "Emergency intake pressure rising"),
      scenarioEvent(1, "Schichtwechsel in 10 Minuten"),
      systemEvent(2, "Telemetrie-Feed wiederhergestellt"),
    ]);

    expect(messages).toEqual([
      { role: "user", content: `${SYSTEM_EVENT_PREFIX} Emergency intake pressure rising` },
      { role: "user", content: `${SCENARIO_EVENT_PREFIX} Schichtwechsel in 10 Minuten` },
      { role: "user", content: `${SYSTEM_EVENT_PREFIX} Telemetrie-Feed wiederhergestellt` },
    ]);
  });

  it("serializes real operator chat as a plain user message without any source prefix", () => {
    const [message] = serializeContextEventsForChat([
      operatorMessageEvent(3, "Bitte Lagebericht für Region Ost."),
    ]);

    expect(message).toEqual({ role: "user", content: "Bitte Lagebericht für Region Ost." });
    expect(message.content).not.toContain(SCENARIO_EVENT_PREFIX);
    expect(message.content).not.toContain(SYSTEM_EVENT_PREFIX);
  });

  it("serializes aurora responses as assistant messages with their grouped tool calls", () => {
    const [message, ...rest] = serializeContextEventsForChat([
      auroraResponseEvent(4, "Ich prüfe zwei Dinge parallel.", [
        { id: "aurora-1", name: "bash", arguments: { command: "mcp list" } },
        {
          id: "aurora-2",
          name: "mcp__medical-east-mcp__capacity_list",
          arguments: { region: "east" },
        },
      ]),
    ]);

    expect(message).toEqual({
      role: "assistant",
      content: "Ich prüfe zwei Dinge parallel.",
      toolCalls: [
        { id: "aurora-1", name: "bash", arguments: { command: "mcp list" } },
        {
          id: "aurora-2",
          name: "mcp__medical-east-mcp__capacity_list",
          arguments: { region: "east" },
        },
      ],
    });

    // Guard: Ohne tool_result-Events bekommen beide Calls ein synthetisches
    // pending-Result, damit kein assistant-tool_call ohne tool-Antwort bleibt.
    expect(rest).toEqual([
      { role: "tool", toolCallId: "aurora-1", toolName: "bash", content: PENDING_TOOL_RESULT_CONTENT },
      {
        role: "tool",
        toolCallId: "aurora-2",
        toolName: "mcp__medical-east-mcp__capacity_list",
        content: PENDING_TOOL_RESULT_CONTENT,
      },
    ]);
  });

  it("emits a synthetic pending result only for unresolved tool calls", () => {
    const messages = serializeContextEventsForChat([
      auroraResponseEvent(4, "", [
        { id: "aurora-1", name: "bash", arguments: { command: "mcp list" } },
        { id: "aurora-2", name: "bash", arguments: { command: "ls" } },
      ]),
      toolResultEvent(4, "aurora-1", "bash", { success: true, output: {} }),
    ]);

    // assistant + pending(aurora-2) + echtes Result(aurora-1) — der bereits
    // aufgelöste Call bekommt KEIN synthetisches pending-Result.
    expect(messages.map((message) => message.role)).toEqual(["assistant", "tool", "tool"]);
    const pendingMessages = messages.filter(
      (message) => message.role === "tool" && message.content === PENDING_TOOL_RESULT_CONTENT
    );
    expect(pendingMessages).toHaveLength(1);
    expect(pendingMessages[0]).toMatchObject({ toolCallId: "aurora-2" });
  });

  it("serializes a text-only aurora response without a toolCalls field", () => {
    const [message] = serializeContextEventsForChat([auroraResponseEvent(4, "Lage stabil.")]);

    expect(message).toEqual({ role: "assistant", content: "Lage stabil." });
  });

  it("serializes tool results as tool messages linked to the correct tool_call_id", () => {
    const [message] = serializeContextEventsForChat([
      toolResultEvent(5, "aurora-2", "mcp__medical-east-mcp__capacity_list", {
        success: false,
        denied: true,
        error: "Permission denied",
      }),
    ]);

    expect(message).toMatchObject({
      role: "tool",
      toolCallId: "aurora-2",
      toolName: "mcp__medical-east-mcp__capacity_list",
    });
    expect(JSON.parse((message as { content: string }).content)).toEqual({
      success: false,
      denied: true,
      error: "Permission denied",
    });
  });

  it("preserves event order exactly as stored", () => {
    const events: AuroraContextEvent[] = [
      operatorMessageEvent(1, "Erste Nachricht"),
      systemEvent(1, "Signal"),
      auroraResponseEvent(1, "Antwort"),
      operatorMessageEvent(1, "Zweite Nachricht"),
    ];

    const contents = serializeContextEventsForChat(events).map((message) => message.content);

    expect(contents).toEqual([
      "Erste Nachricht",
      `${SYSTEM_EVENT_PREFIX} Signal`,
      "Antwort",
      "Zweite Nachricht",
    ]);
  });
});
