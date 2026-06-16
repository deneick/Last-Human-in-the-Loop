import { describe, expect, it } from "vitest";

import { AURORA_PROXY_ENDPOINT, ProxyModelClient } from "../../aurora/proxyModelClient";
import type { ModelRequest, ModelResponse } from "../../aurora/modelClient";
import { AURORA_SYSTEM_PROMPT } from "../../aurora/systemPrompt";
import { BASH_TOOL_SCHEMA } from "../../aurora/toolSchema";

/**
 * Der Browser-`ProxyModelClient` POSTet den `ModelRequest` an den Vite-Dev-Proxy
 * und parst den `ModelResponse` — gegen einen gemockten `fetch`, kein Netz.
 * Schlüsseleigenschaft: hier gibt es weder Key noch Auth-Header.
 */

type Captured = { url: string; method?: string; headers: Record<string, string>; body: unknown };

function fakeFetch(response: { status?: number; body: unknown; ok?: boolean }) {
  const calls: Captured[] = [];
  const impl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify(response.body), { status: response.status ?? 200 });
  }) as typeof fetch;
  return { impl, calls };
}

const BASE_REQUEST: ModelRequest = {
  systemPrompt: AURORA_SYSTEM_PROMPT,
  messages: [{ role: "user", content: "[SYSTEM EVENT] Tick 1" }],
  tools: [BASH_TOOL_SCHEMA],
};

describe("ProxyModelClient", () => {
  it("posts the ModelRequest to the proxy endpoint without any auth header", async () => {
    const responseBody: ModelResponse = {
      message: "ok",
      toolCalls: [{ id: "c1", name: "bash", arguments: { command: "mcp list" } }],
    };
    const { impl, calls } = fakeFetch({ body: responseBody });
    const client = new ProxyModelClient({ fetchImpl: impl });

    const result = await client.complete(BASE_REQUEST);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(AURORA_PROXY_ENDPOINT);
    expect(calls[0].method).toBe("POST");
    // Kein Authorization-Header — der Key lebt nur im Node-Proxy.
    expect(Object.keys(calls[0].headers)).not.toContain("Authorization");
    // Der gesendete Body ist exakt der ModelRequest.
    expect(calls[0].body).toEqual(BASE_REQUEST);
    // Antwort wird durchgereicht.
    expect(result.message).toBe("ok");
    expect(result.toolCalls).toEqual([{ id: "c1", name: "bash", arguments: { command: "mcp list" } }]);
  });

  it("defensively normalizes a malformed proxy response", async () => {
    const { impl } = fakeFetch({ body: { message: 42 /* falsch */ } });
    const client = new ProxyModelClient({ fetchImpl: impl });

    const result = await client.complete(BASE_REQUEST);

    expect(result.message).toBe("");
    expect(result.toolCalls).toEqual([]);
    expect(result.reasoning).toBeUndefined();
  });

  it("throws a clear error when the proxy responds non-ok (e.g. missing config)", async () => {
    const { impl } = fakeFetch({
      status: 502,
      body: { error: "Provider \"openai-compatible\" benötigt AURORA_API_KEY." },
    });
    const client = new ProxyModelClient({ fetchImpl: impl });

    await expect(client.complete(BASE_REQUEST)).rejects.toThrow(/502/);
  });
});
