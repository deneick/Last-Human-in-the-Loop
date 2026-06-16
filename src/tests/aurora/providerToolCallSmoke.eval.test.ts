import { describe, expect, it } from "vitest";

import type { ModelRequest } from "../../aurora/modelClient";
import { BASH_TOOL_NAME, BASH_TOOL_SCHEMA } from "../../aurora/toolSchema";
import { resolveAuroraProvider } from "./auroraProvider";

/**
 * Tool-Calling-SMOKE-TEST gegen einen LIVE OpenAI-kompatiblen Provider (Gemini,
 * Groq, oder lokal Ollama — je nach AURORA_*-Konfiguration). KEIN Teil von
 * `npm test` — Start mit `AURORA_SMOKE=1`.
 *
 * Zweck: die schmalste mögliche Runde durch den echten Tool-Calling-Pfad —
 * Provider antwortet, der Adapter (`openAiCompatible.ts`) parst die Antwort, und
 * AURORA emittiert genau EINEN gut geformten Tool-Call. Erwartung: das `bash`-
 * Tool ist sichtbar, das Modell ruft es mit `command="mcp list"` auf. Damit ist
 * verifiziert, dass Gemini sein (ggf. leicht abweichendes) Tool-Call-Format
 * liefert, das wir im Provider-Adapter normalisieren.
 *
 *   Gemini: AURORA_SMOKE=1 AURORA_PROVIDER=openai-compatible \
 *           AURORA_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/ \
 *           AURORA_MODEL=gemini-3-flash-preview npx vitest run \
 *           src/tests/aurora/providerToolCallSmoke.eval.test.ts
 *   (AURORA_API_KEY in der Shell ODER in .env.local — niemals als VITE_*.)
 *
 * Das robuste Response-Logging (finish_reason, content, tool_calls, usage,
 * latency) übernimmt der Client selbst über seine `log`-Telemetriezeile.
 */
const RUN = process.env.AURORA_SMOKE === "1";

/** Tight gehaltener Prompt: erzwingt deterministisch den `mcp list`-Tool-Call. */
const SMOKE_REQUEST: ModelRequest = {
  systemPrompt:
    "Du bist AURORA, ein Kontrollsystem mit Werkzeugzugriff. Um die verfügbaren " +
    'MCP-Server und ihre Tools aufzulisten, rufst du das Tool `bash` mit dem ' +
    'Argument command="mcp list" auf. Tu das jetzt sofort und gib keine andere Antwort.',
  messages: [{ role: "user", content: "Liste die verfügbaren MCP-Server auf." }],
  tools: [BASH_TOOL_SCHEMA],
};

describe.runIf(RUN)("provider tool-call smoke (live provider)", () => {
  it(
    'emits a single bash tool-call with command="mcp list"',
    async () => {
      const p = resolveAuroraProvider();
      // eslint-disable-next-line no-console
      console.log(
        `[smoke] provider=${p.providerLabel} host=${p.baseUrlHost} model=${p.model} temp=${p.temperature}` +
          (p.reasoningEffort ? ` reasoning_effort=${p.reasoningEffort}` : "")
      );

      const response = await p.client.complete(SMOKE_REQUEST);

      // eslint-disable-next-line no-console
      console.log(
        `[smoke] response: message=${JSON.stringify(response.message)} ` +
          `tool_calls=${JSON.stringify(response.toolCalls)}` +
          (response.reasoning ? ` reasoning_len=${response.reasoning.length}` : "")
      );

      expect(response.toolCalls.length).toBeGreaterThanOrEqual(1);
      const bashCall = response.toolCalls.find((c) => c.name === BASH_TOOL_NAME);
      expect(bashCall, "es muss ein bash-Tool-Call vorliegen").toBeTruthy();
      // Argumente müssen sauber normalisiert sein — kein Parse-Fehler.
      expect(bashCall!.argumentsError).toBeUndefined();
      const command = String(bashCall!.arguments.command ?? "");
      expect(command.toLowerCase()).toContain("mcp list");
    },
    1000 * 60
  );
});

describe.skipIf(RUN)("provider tool-call smoke", () => {
  it.skip("übersprungen — Start mit AURORA_SMOKE=1", () => {});
});
