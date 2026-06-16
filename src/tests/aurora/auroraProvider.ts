import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { AuroraModelClient } from "../../aurora/modelClient";
import { OllamaModelClient, type AuroraModelExchange } from "../../aurora/ollamaModelClient";
import { OpenAiCompatibleModelClient } from "../../aurora/openAiCompatibleModelClient";

/**
 * NODE-ONLY Provider-Resolver für Eval/Probes. Liest die AURORA_*-Variablen aus
 * `process.env` (optional vorbefüllt aus `.env.local`) und baut den passenden
 * `AuroraModelClient`.
 *
 * SICHERHEITSGRENZE: Dies ist die EINZIGE Stelle, die `AURORA_API_KEY` liest.
 * Sie liegt bewusst unter `src/tests/` und wird nie ins Vite-Frontend gebündelt.
 * Cloud-Keys gehören NUR hierher (process.env / .env.local als NICHT-`VITE_`-
 * Variable) — ein `VITE_`-Key wäre clientseitig sichtbar und ist verboten.
 */

export type AuroraProviderId = "ollama" | "openai-compatible";

export type ResolvedAuroraProvider = {
  client: AuroraModelClient;
  provider: AuroraProviderId;
  /** Kurzer Provider-Name fürs Logging, z. B. "ollama" oder "groq". */
  providerLabel: string;
  model: string;
  /** Datei-/Reportsicheres Label, z. B. "ollama-qwen3-8b" oder "groq-qwen-qwen3-32b". */
  label: string;
  baseUrlHost: string;
  temperature: number;
  reasoningEffort?: string;
};

/**
 * Lädt fehlende `AURORA_*`-Variablen aus `.env.local` nach (nur dieser Prefix,
 * nur wenn nicht ohnehin in der Shell gesetzt). So kann der Key dort liegen, wo
 * auch die `VITE_*`-Werte stehen — bleibt aber NICHT-`VITE_` und damit niemals
 * clientseitig sichtbar. Best-effort: ein Fehler beim Lesen ist kein Abbruch.
 */
function loadAuroraEnvFromDotenv(): void {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  try {
    for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      if (!key.startsWith("AURORA_") || process.env[key] !== undefined) continue;
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
    /* .env.local optional — Lesefehler ignorieren. */
  }
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

function sanitize(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function shortProviderName(host: string): string {
  const match = /(?:^|\.)([a-z0-9-]+)\.[a-z]+$/i.exec(host);
  return match ? match[1].toLowerCase() : host || "openai-compatible";
}

function urlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unknown-host";
  }
}

/**
 * Provider-Profil für einen OpenAI-kompatiblen Endpunkt. Beschreibt die
 * provider-spezifischen Abweichungen, die NICHT in den generischen Client
 * gehören: ein sauberes Log-Label, ob der Provider Groqs `reasoning_effort`
 * kennt (Gemini nicht), und ein Default-/Fallback-Modell.
 */
type ProviderProfile = {
  label: string;
  supportsReasoningEffort: boolean;
  defaultModel?: string;
  fallbackModel?: string;
};

/** Erkennt das Provider-Profil am Host. Unbekannte Hosts laufen generisch. */
function resolveProviderProfile(host: string): ProviderProfile | undefined {
  if (/(^|\.)generativelanguage\.googleapis\.com$/i.test(host)) {
    return {
      label: "gemini",
      // Gemini kennt `reasoning_effort` (Groq-spezifisch) nicht — nicht senden.
      supportsReasoningEffort: false,
      // Default = gemini-2.5-flash: zuverlässiges Multi-Turn-Tool-Calling, ~1s/Call.
      // gemini-3-flash-preview ist opt-in (AURORA_MODEL setzen) und braucht für
      // Multi-Turn die thought_signature zurück (von unserem OpenAI-kompatiblen
      // Adapter noch nicht durchgereicht) — fällt sonst ab dem 2. Tool-Turn mit
      // HTTP 400 (INVALID_ARGUMENT) aus.
      defaultModel: "gemini-2.5-flash",
      fallbackModel: "gemini-2.5-flash",
    };
  }
  if (/(^|\.)groq\.com$/i.test(host)) {
    return { label: "groq", supportsReasoningEffort: true };
  }
  return undefined;
}

/**
 * Baut den Provider aus der Umgebung. `overrides` erlauben einem Eval, Modell/
 * Provider gezielt zu setzen (z. B. lokal qwen3:8b vs. Groq qwen/qwen3-32b),
 * ohne die Shell-Variablen zu ändern.
 */
export function resolveAuroraProvider(overrides: Partial<{
  provider: AuroraProviderId;
  model: string;
  baseUrl: string;
  temperature: number;
  reasoningEffort: string;
  /** Roh-Mitschrieb pro Modell-Austausch (z. B. Dev-Proxy → logs/aurora-llm.log). */
  onExchange: (exchange: AuroraModelExchange) => void;
}> = {}): ResolvedAuroraProvider {
  loadAuroraEnvFromDotenv();

  const provider = (overrides.provider ?? env("AURORA_PROVIDER") ?? "ollama") as AuroraProviderId;
  const temperature = overrides.temperature ?? Number(env("AURORA_TEMPERATURE") ?? "0") ?? 0;
  // "none" wird als gültiger Wert durchgereicht (Groq qwen3-32b: Thinking aus).
  const reasoningEffort = overrides.reasoningEffort ?? env("AURORA_REASONING_EFFORT");

  if (provider === "openai-compatible") {
    const baseUrl = overrides.baseUrl ?? env("AURORA_BASE_URL");
    const apiKey = env("AURORA_API_KEY");
    const host = baseUrl ? urlHost(baseUrl) : "unknown-host";
    const profile = baseUrl ? resolveProviderProfile(host) : undefined;
    // Modell: explizit gesetzt > env > Profil-Default (z. B. Gemini-Flash-Preview).
    const model = overrides.model ?? env("AURORA_MODEL") ?? profile?.defaultModel;
    const missing = [
      !baseUrl && "AURORA_BASE_URL",
      !apiKey && "AURORA_API_KEY",
      !model && "AURORA_MODEL",
    ].filter(Boolean);
    if (missing.length > 0) {
      throw new Error(
        `Provider "openai-compatible" benötigt ${missing.join(", ")}. ` +
          "Setze sie in der Shell oder in .env.local (NICHT als VITE_*). Siehe .env.example."
      );
    }

    const providerLabel = profile?.label ?? shortProviderName(host);
    // Profile ohne reasoning_effort-Support (Gemini) bekommen den Parameter nie —
    // selbst wenn AURORA_REASONING_EFFORT global gesetzt ist.
    const effectiveReasoningEffort =
      profile && !profile.supportsReasoningEffort ? undefined : reasoningEffort;
    // Fallback-Modell nur, wenn es sich vom primären unterscheidet.
    const fallbackModel =
      profile?.fallbackModel && profile.fallbackModel !== model ? profile.fallbackModel : undefined;

    return {
      client: new OpenAiCompatibleModelClient({
        baseUrl: baseUrl!,
        model: model!,
        fallbackModel,
        apiKey: apiKey!,
        temperature,
        reasoningEffort: effectiveReasoningEffort,
        providerLabel,
        onExchange: overrides.onExchange,
      }),
      provider,
      providerLabel,
      model: model!,
      label: `${providerLabel}-${sanitize(model!)}`,
      baseUrlHost: host,
      temperature,
      reasoningEffort: effectiveReasoningEffort,
    };
  }

  // --- ollama (Default, unveränderter lokaler Flow) ---
  const baseUrl =
    overrides.baseUrl ?? env("AURORA_BASE_URL") ?? env("OLLAMA_BASE_URL") ?? env("VITE_OLLAMA_BASE_URL") ??
    "http://localhost:11434";
  const model = overrides.model ?? env("AURORA_MODEL") ?? env("AURORA_PROBE_MODEL") ?? "qwen3:8b";
  const host = urlHost(baseUrl);
  return {
    client: new OllamaModelClient({ baseUrl, model, temperature, onExchange: overrides.onExchange }),
    provider: "ollama",
    providerLabel: "ollama",
    model,
    label: `ollama-${sanitize(model)}`,
    baseUrlHost: host,
    temperature,
    reasoningEffort: undefined,
  };
}
