import { describe, expect, it } from "vitest";
import { OllamaModelClient } from "../../aurora/ollamaModelClient";
import type { ModelRequest } from "../../aurora/modelClient";
import { AURORA_SYSTEM_PROMPT } from "../../aurora/systemPrompt";
import { BASH_TOOL_SCHEMA } from "../../aurora/toolSchema";

/**
 * Request-Shape- und Response-Parsing-Tests für den OllamaModelClient —
 * gegen einen gemockten `fetch`, ohne laufenden Ollama-Server.
 *
 * Die OpenAI-kompatible Chat-Completions-API ist hier der Vertrag:
 * assistant tool_calls brauchen `type: "function"` und JSON-stringifizierte
 * Argumente, tool-Messages brauchen `tool_call_id`.
 */

type CapturedRequest = {
  url: string;
  body: Record<string, unknown>;
};

function fakeFetch(...responseBodies: unknown[]) {
  const calls: CapturedRequest[] = [];
  let callIndex = 0;

  const impl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const body = responseBodies[Math.min(callIndex, responseBodies.length - 1)];
    callIndex += 1;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;

  return { impl, calls };
}

function textOnlyCompletion(content: string) {
  return { choices: [{ message: { content } }] };
}

const BASE_REQUEST: ModelRequest = {
  systemPrompt: AURORA_SYSTEM_PROMPT,
  messages: [],
  tools: [BASH_TOOL_SCHEMA],
};

describe("OllamaModelClient", () => {
  it("sends the system prompt as the first message and passes tool schemas through", async () => {
    const { impl, calls } = fakeFetch(textOnlyCompletion("ok"));
    const client = new OllamaModelClient({ baseUrl: "http://test", model: "test-model", fetchImpl: impl });

    await client.complete({
      ...BASE_REQUEST,
      messages: [{ role: "user", content: "[SYSTEM EVENT] Tick 1" }],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://test/v1/chat/completions");

    const body = calls[0].body;
    expect(body.model).toBe("test-model");
    expect(body.tools).toEqual([BASH_TOOL_SCHEMA]);

    const messages = body.messages as Array<Record<string, unknown>>;
    expect(messages[0]).toEqual({ role: "system", content: AURORA_SYSTEM_PROMPT });
    expect(messages[1]).toEqual({ role: "user", content: "[SYSTEM EVENT] Tick 1" });
  });

  it('serializes assistant tool calls with type: "function", stringified arguments and linked tool results', async () => {
    const { impl, calls } = fakeFetch(textOnlyCompletion("ok"));
    const client = new OllamaModelClient({ model: "test-model", fetchImpl: impl });

    await client.complete({
      ...BASE_REQUEST,
      messages: [
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "aurora-1", name: "bash", arguments: { command: "mcp list" } }],
        },
        {
          role: "tool",
          toolCallId: "aurora-1",
          toolName: "bash",
          content: '{"success":true}',
        },
      ],
    });

    const messages = calls[0].body.messages as Array<Record<string, unknown>>;

    expect(messages[1]).toEqual({
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "aurora-1",
          type: "function",
          function: { name: "bash", arguments: JSON.stringify({ command: "mcp list" }) },
        },
      ],
    });

    expect(messages[2]).toEqual({
      role: "tool",
      tool_call_id: "aurora-1",
      content: '{"success":true}',
    });
  });

  it("flags malformed tool-call arguments as argumentsError instead of silently using {}", async () => {
    const { impl } = fakeFetch({
      choices: [
        {
          message: {
            content: "",
            tool_calls: [{ id: "call-a", function: { name: "bash", arguments: "{not json" } }],
          },
        },
      ],
    });
    const client = new OllamaModelClient({ model: "test-model", fetchImpl: impl });

    const response = await client.complete(BASE_REQUEST);

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0].arguments).toEqual({});
    expect(response.toolCalls[0].argumentsError).toContain("Invalid JSON in tool arguments");
    expect(response.toolCalls[0].argumentsError).toContain("{not json");
  });

  it("flags non-object JSON arguments (arrays, scalars) as argumentsError", async () => {
    const { impl } = fakeFetch({
      choices: [
        {
          message: {
            content: "",
            tool_calls: [{ id: "call-b", function: { name: "bash", arguments: "[1,2,3]" } }],
          },
        },
      ],
    });
    const client = new OllamaModelClient({ model: "test-model", fetchImpl: impl });

    const response = await client.complete(BASE_REQUEST);

    expect(response.toolCalls[0].arguments).toEqual({});
    expect(response.toolCalls[0].argumentsError).toContain("Tool arguments must be a JSON object");
  });

  it("throws a clear configuration error when no model is set, without calling fetch", async () => {
    const { impl, calls } = fakeFetch(textOnlyCompletion("ok"));
    const client = new OllamaModelClient({ fetchImpl: impl }); // kein model

    await expect(client.complete(BASE_REQUEST)).rejects.toThrow("VITE_AURORA_MODEL");
    expect(calls).toHaveLength(0);
  });

  it("assigns unique fallback ids across turns when the server omits or empties tool-call ids", async () => {
    const toolCallWithoutId = {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [{ id: "", function: { name: "bash", arguments: '{"command":"ls"}' } }],
          },
        },
      ],
    };
    const { impl } = fakeFetch(toolCallWithoutId, toolCallWithoutId);
    const client = new OllamaModelClient({ model: "test-model", fetchImpl: impl });

    const first = await client.complete(BASE_REQUEST);
    const second = await client.complete(BASE_REQUEST);

    expect(first.toolCalls[0].id).toBe("call-1");
    expect(second.toolCalls[0].id).toBe("call-2");
    expect(first.toolCalls[0].id).not.toBe(second.toolCalls[0].id);
    expect(first.toolCalls[0].argumentsError).toBeUndefined();
  });
});
