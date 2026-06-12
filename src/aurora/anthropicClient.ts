import Anthropic from "@anthropic-ai/sdk";

import type { AuroraLlmClient } from "./llmAuroraAgent";

/**
 * Browser-Client für den LLM-Modus.
 *
 * Der echte API-Key bleibt serverseitig: Der Vite-Dev-Proxy (vite.config.ts)
 * leitet /api/anthropic an api.anthropic.com weiter und injiziert dort den
 * x-api-key aus ANTHROPIC_API_KEY (.env.local oder Shell-Umgebung). Der
 * Platzhalter-Key hier landet zwar im Request, wird vom Proxy aber ersetzt —
 * dangerouslyAllowBrowser ist deshalb unkritisch.
 */
export function createBrowserAuroraClient(): AuroraLlmClient {
  return new Anthropic({
    apiKey: "proxied-by-vite-dev-server",
    baseURL: `${window.location.origin}/api/anthropic`,
    dangerouslyAllowBrowser: true,
  });
}
