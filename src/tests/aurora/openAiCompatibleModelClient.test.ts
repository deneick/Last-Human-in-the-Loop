import { describe, expect, it } from "vitest";
import {
  OpenAiCompatibleModelClient,
  rateLimitSuggestedWaitMs,
} from "../../aurora/openAiCompatibleModelClient";
import type { ModelRequest } from "../../aurora/modelClient";
import { AURORA_SYSTEM_PROMPT } from "../../aurora/systemPrompt";
import { BASH_TOOL_SCHEMA } from "../../aurora/toolSchema";

/**
 * Request-Shape, Auth-Header, reasoning_effort-Retry und Key-Redaction des
 * OpenAi-kompatiblen Cloud-Clients — gegen einen gemockten `fetch`, kein Netz.
 */

type Captured = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

function fakeFetch(...responses: Array<{ status?: number; body: unknown }>) {
  const calls: Captured[] = [];
  let i = 0;
  const impl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body)),
    });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { impl, calls };
}

function completion(content: string) {
  return { choices: [{ message: { content } }] };
}

/**
 * Antwort mit Tool-Call. `args` darf ein JSON-String ODER (Gemini-Variante) ein
 * Objekt sein — der Adapter muss beides normalisieren. Optional finish_reason
 * und usage fürs Telemetrie-Logging.
 */
function toolCallCompletion(
  name: string,
  args: string | Record<string, unknown>,
  extra: { finish_reason?: string; usage?: Record<string, number> } = {}
) {
  return {
    choices: [
      {
        finish_reason: extra.finish_reason ?? "tool_calls",
        message: { content: "", tool_calls: [{ id: "call-x", type: "function", function: { name, arguments: args } }] },
      },
    ],
    ...(extra.usage ? { usage: extra.usage } : {}),
  };
}

const BASE_REQUEST: ModelRequest = {
  systemPrompt: AURORA_SYSTEM_PROMPT,
  messages: [{ role: "user", content: "[SYSTEM EVENT] Tick 1" }],
  tools: [BASH_TOOL_SCHEMA],
};

const API_KEY = "sk-secret-do-not-leak-123";

describe("OpenAiCompatibleModelClient", () => {
  it("posts to <baseUrl>/chat/completions with a Bearer header and never puts the key in the body", async () => {
    const { impl, calls } = fakeFetch({ body: completion("ok") });
    const client = new OpenAiCompatibleModelClient({
      baseUrl: "https://api.groq.com/openai/v1",
      model: "qwen/qwen3-32b",
      apiKey: API_KEY,
      temperature: 0,
      reasoningEffort: "none",
      fetchImpl: impl,
      log: () => {},
    });

    await client.complete(BASE_REQUEST);

    expect(calls[0].url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(calls[0].headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(calls[0].body.model).toBe("qwen/qwen3-32b");
    expect(calls[0].body.reasoning_effort).toBe("none");
    expect(calls[0].body.temperature).toBe(0);
    // System-Prompt zuerst, dann die History — identisch zum Ollama-Pfad.
    const messages = calls[0].body.messages as Array<Record<string, unknown>>;
    expect(messages[0]).toEqual({ role: "system", content: AURORA_SYSTEM_PROMPT });
    // Der Key darf NIRGENDS im Body stehen.
    expect(JSON.stringify(calls[0].body)).not.toContain(API_KEY);
  });

  it("retries once WITHOUT reasoning_effort when the provider rejects it", async () => {
    const { impl, calls } = fakeFetch(
      { status: 400, body: { error: { message: "reasoning_effort is not supported for this model" } } },
      { body: completion("ok after retry") }
    );
    const logs: string[] = [];
    const client = new OpenAiCompatibleModelClient({
      baseUrl: "https://api.groq.com/openai/v1",
      model: "qwen/qwen3-32b",
      apiKey: API_KEY,
      reasoningEffort: "high",
      fetchImpl: impl,
      log: (line) => logs.push(line),
    });

    const response = await client.complete(BASE_REQUEST);

    expect(calls).toHaveLength(2);
    expect(calls[0].body.reasoning_effort).toBe("high"); // erster Versuch mit Parameter
    expect(calls[1].body).not.toHaveProperty("reasoning_effort"); // Retry ohne Parameter
    expect(response.message).toBe("ok after retry");
    expect(logs.join("\n")).toMatch(/reasoning_effort.*abgelehnt/i);
  });

  it("throws on a non-reasoning_effort error without retrying", async () => {
    const { impl, calls } = fakeFetch({ status: 401, body: { error: { message: "invalid api key" } } });
    const client = new OpenAiCompatibleModelClient({
      baseUrl: "https://api.groq.com/openai/v1",
      model: "qwen/qwen3-32b",
      apiKey: API_KEY,
      reasoningEffort: "none",
      fetchImpl: impl,
      log: () => {},
    });

    await expect(client.complete(BASE_REQUEST)).rejects.toThrow(/401/);
    expect(calls).toHaveLength(1); // kein Retry
  });

  it("never logs the API key (telemetry line nor exchange payload)", async () => {
    const { impl } = fakeFetch({ body: completion("ok") });
    const logs: string[] = [];
    const exchanges: string[] = [];
    const client = new OpenAiCompatibleModelClient({
      baseUrl: "https://api.groq.com/openai/v1",
      model: "qwen/qwen3-32b",
      apiKey: API_KEY,
      temperature: 0,
      providerLabel: "groq",
      fetchImpl: impl,
      log: (line) => logs.push(line),
      onExchange: (ex) => exchanges.push(JSON.stringify(ex)),
    });

    await client.complete(BASE_REQUEST);

    expect(logs.join("\n")).not.toContain(API_KEY);
    expect(logs.join("\n")).toMatch(/provider=groq .*latency=\d+ms/);
    expect(exchanges.join("\n")).not.toContain(API_KEY);
  });

  it("throws a clear error when the API key is missing, without calling fetch", async () => {
    const { impl, calls } = fakeFetch({ body: completion("ok") });
    const client = new OpenAiCompatibleModelClient({
      baseUrl: "https://api.groq.com/openai/v1",
      model: "qwen/qwen3-32b",
      apiKey: "",
      fetchImpl: impl,
      log: () => {},
    });

    await expect(client.complete(BASE_REQUEST)).rejects.toThrow("AURORA_API_KEY");
    expect(calls).toHaveLength(0);
  });

  it("never sends reasoning_effort when none is configured (Gemini case)", async () => {
    const { impl, calls } = fakeFetch({ body: completion("ok") });
    const client = new OpenAiCompatibleModelClient({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-3-flash-preview",
      apiKey: API_KEY,
      temperature: 0,
      providerLabel: "gemini",
      // bewusst KEIN reasoningEffort
      fetchImpl: impl,
      log: () => {},
    });

    await client.complete(BASE_REQUEST);

    expect(calls).toHaveLength(1);
    expect(calls[0].body).not.toHaveProperty("reasoning_effort");
    expect(calls[0].body.model).toBe("gemini-3-flash-preview");
  });

  it("falls back to the secondary model when the primary is unavailable (HTTP 404)", async () => {
    const { impl, calls } = fakeFetch(
      { status: 404, body: { error: { message: "models/gemini-3-flash-preview is not found" } } },
      { body: completion("ok on fallback") }
    );
    const logs: string[] = [];
    const client = new OpenAiCompatibleModelClient({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-3-flash-preview",
      fallbackModel: "gemini-2.5-flash",
      apiKey: API_KEY,
      providerLabel: "gemini",
      fetchImpl: impl,
      log: (line) => logs.push(line),
    });

    const response = await client.complete(BASE_REQUEST);

    expect(calls).toHaveLength(2);
    expect(calls[0].body.model).toBe("gemini-3-flash-preview"); // erster Versuch
    expect(calls[1].body.model).toBe("gemini-2.5-flash"); // Fallback
    expect(response.message).toBe("ok on fallback");
    expect(logs.join("\n")).toMatch(/Fallback auf "gemini-2\.5-flash"/);
  });

  it("does NOT fall back on Gemini's multi-turn thought_signature 400 (INVALID_ARGUMENT)", async () => {
    const thoughtSignatureError = {
      error: {
        code: 400,
        message:
          "Function call is missing a thought_signature in functionCall parts. This is " +
          "required for tools to work correctly, and missing thought_signature may lead to " +
          "degraded model performance. Additional data, function call `default_api:bash`, position 4.",
        status: "INVALID_ARGUMENT",
      },
    };
    const { impl, calls } = fakeFetch({ status: 400, body: [thoughtSignatureError] });
    const client = new OpenAiCompatibleModelClient({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-3-flash-preview",
      fallbackModel: "gemini-2.5-flash",
      apiKey: API_KEY,
      providerLabel: "gemini",
      fetchImpl: impl,
      log: () => {},
    });

    await expect(client.complete(BASE_REQUEST)).rejects.toThrow(/400/);
    expect(calls).toHaveLength(1); // KEIN Modell-Fallback auf diesen 400er
  });

  it("does NOT fall back on a non-model error (e.g. 401 invalid key)", async () => {
    const { impl, calls } = fakeFetch({ status: 401, body: { error: { message: "invalid api key" } } });
    const client = new OpenAiCompatibleModelClient({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-3-flash-preview",
      fallbackModel: "gemini-2.5-flash",
      apiKey: API_KEY,
      fetchImpl: impl,
      log: () => {},
    });

    await expect(client.complete(BASE_REQUEST)).rejects.toThrow(/401/);
    expect(calls).toHaveLength(1); // kein Modell-Fallback
  });

  it("derives the 429 wait from header, Groq wording, or Gemini retryDelay", () => {
    const noHeaders = new Response("", { status: 429 });
    // retry-after-Header (Sekunden) hat Vorrang.
    expect(
      rateLimitSuggestedWaitMs(new Response("", { status: 429, headers: { "retry-after": "12" } }), "")
    ).toBe(12_250);
    // Groq-Wortlaut, inkl. Minuten.
    expect(rateLimitSuggestedWaitMs(noHeaders, "Please try again in 19.76s.")).toBe(19_760 + 250);
    expect(rateLimitSuggestedWaitMs(noHeaders, "try again in 1m5s.")).toBe(65_000 + 250);
    // Geminis strukturiertes retryDelay.
    expect(
      rateLimitSuggestedWaitMs(noHeaders, '{"error":{"details":[{"retryDelay":"17s"}]}}')
    ).toBe(17_250);
    // Ohne Hinweis: 2s-Fallback.
    expect(rateLimitSuggestedWaitMs(noHeaders, "quota exceeded")).toBe(2_250);
  });

  it("gives up immediately on a terminal 429 (prepayment credits depleted), no retries", async () => {
    const { impl, calls } = fakeFetch({
      status: 429,
      body: [
        {
          error: {
            code: 429,
            message: "Your prepayment credits are depleted. Please go to AI Studio to manage your billing.",
            status: "RESOURCE_EXHAUSTED",
          },
        },
      ],
    });
    const logs: string[] = [];
    const client = new OpenAiCompatibleModelClient({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-2.5-flash",
      apiKey: API_KEY,
      providerLabel: "gemini",
      fetchImpl: impl,
      log: (line) => logs.push(line),
    });

    await expect(client.complete(BASE_REQUEST)).rejects.toThrow(/429/);
    expect(calls).toHaveLength(1); // kein Backoff-Retry auf das erschöpfte Guthaben
    expect(logs.join("\n")).toMatch(/endgültig erschöpft/);
  });

  it("retries a transient 503 (high demand) and then succeeds", async () => {
    const { impl, calls } = fakeFetch(
      { status: 503, body: { error: { code: 503, message: "high demand", status: "UNAVAILABLE" } } },
      { body: completion("ok after 503") }
    );
    const logs: string[] = [];
    const client = new OpenAiCompatibleModelClient({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-2.5-flash",
      apiKey: API_KEY,
      providerLabel: "gemini",
      maxRateLimitWaitMs: 0, // Backoff auf 0 → Test wartet nicht real
      fetchImpl: impl,
      log: (line) => logs.push(line),
    });

    const response = await client.complete(BASE_REQUEST);

    expect(calls).toHaveLength(2);
    expect(response.message).toBe("ok after 503");
    expect(logs.join("\n")).toMatch(/transienter Fehler \(HTTP 503\)/);
  });

  it("normalizes object-shaped tool arguments (Gemini delivers an object, not a JSON string)", async () => {
    const { impl } = fakeFetch({ body: toolCallCompletion("bash", { command: "mcp list" }) });
    const client = new OpenAiCompatibleModelClient({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-3-flash-preview",
      apiKey: API_KEY,
      fetchImpl: impl,
      log: () => {},
    });

    const response = await client.complete(BASE_REQUEST);

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0].name).toBe("bash");
    expect(response.toolCalls[0].arguments).toEqual({ command: "mcp list" });
    expect(response.toolCalls[0].argumentsError).toBeUndefined();
  });

  it("logs finish_reason, tool_calls and usage on a successful response", async () => {
    const { impl } = fakeFetch({
      body: toolCallCompletion(
        "bash",
        JSON.stringify({ command: "mcp list" }),
        { finish_reason: "tool_calls", usage: { prompt_tokens: 120, completion_tokens: 8, total_tokens: 128 } }
      ),
    });
    const logs: string[] = [];
    const client = new OpenAiCompatibleModelClient({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-3-flash-preview",
      apiKey: API_KEY,
      providerLabel: "gemini",
      fetchImpl: impl,
      log: (line) => logs.push(line),
    });

    await client.complete(BASE_REQUEST);

    const line = logs.join("\n");
    expect(line).toMatch(/finish_reason=tool_calls/);
    expect(line).toMatch(/tool_calls=\[bash\]/);
    expect(line).toMatch(/usage=120\/8\/128/);
    expect(line).toMatch(/latency=\d+ms/);
  });
});
