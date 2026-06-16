import type {
  AuroraModelClient,
  ModelRequest,
  ModelResponse,
  ModelToolCall,
  ModelToolSchema,
} from "./modelClient";
import type { AuroraModelExchange } from "./ollamaModelClient";
import {
  parseChatCompletionResponse,
  toOpenAiMessages,
  type OpenAiChatCompletionResponse,
} from "./openAiCompatible";

/**
 * `AuroraModelClient` für einen beliebigen OpenAI-kompatiblen Cloud-Provider
 * (z. B. Groq: baseUrl `https://api.groq.com/openai/v1`, Modell
 * `qwen/qwen3-32b`).
 *
 * SICHERHEIT: Dieser Client liest NIE selbst Umgebungsvariablen. Der API-Key
 * kommt ausschließlich als Konstruktor-Option herein (aus `process.env` über
 * den Node-only-Resolver `src/tests/aurora/auroraProvider.ts`). Damit kann der
 * Key niemals über ein `VITE_*`-Bundle ins Frontend gelangen. Der Key steht nur
 * im `Authorization`-Header (nie im Body) und wird aus allen Logs/`onExchange`-
 * Payloads herausgehalten bzw. defensiv maskiert.
 *
 * Teilt sich Messages-, Tools- und Tool-Result-Serialisierung mit dem
 * `OllamaModelClient` über `openAiCompatible.ts` — gleiche Abbildung, gleiche
 * Runtime-Guards, gleicher Eval-Harness.
 */

export type OpenAiCompatibleModelClientOptions = {
  /** Basis-URL inkl. Versionspfad, z. B. "https://api.groq.com/openai/v1". */
  baseUrl: string;
  /** Modellname des Providers, z. B. "qwen/qwen3-32b". */
  model: string;
  /**
   * Optionales Ausweich-Modell. Meldet der Provider das primäre Modell als
   * nicht verfügbar (HTTP 404 bzw. 400 "model not found"), sendet der Client den
   * Request EINMAL erneut mit diesem Modell (z. B. Gemini: primär
   * "gemini-3-flash-preview", Fallback "gemini-2.5-flash"). Bleibt der Fehler,
   * wird er regulär hochgereicht.
   */
  fallbackModel?: string;
  /** API-Key — NUR serverseitig/Node aus `process.env`, nie aus `VITE_*`. */
  apiKey: string;
  /** Sampling-Temperatur (undefined → Provider-Default). */
  temperature?: number;
  /**
   * Optionaler `reasoning_effort` (z. B. "none"/"low"/"medium"/"high"). Wird
   * mitgesendet, wenn gesetzt. Lehnt der Provider den Parameter ab, retryt der
   * Client EINMAL ohne ihn (sauber geloggt).
   */
  reasoningEffort?: string;
  /** Provider-Label nur fürs Logging, z. B. "groq". */
  providerLabel?: string;
  /**
   * Max. Wiederholungen bei HTTP 429 (Rate-Limit). Der Client respektiert den
   * vorgeschlagenen Wartewert (Header `retry-after` bzw. "try again in Xs" aus
   * dem Body) und sendet danach erneut. Default: 5. 0 schaltet den Backoff ab.
   */
  maxRateLimitRetries?: number;
  /**
   * Obergrenze pro 429-Wartepause in ms. Dient zugleich als Abbruchschwelle:
   * übersteigt der vorgeschlagene Wartewert diese Grenze, ist es kein kurzes
   * Minutenfenster (RPM/TPM) zum Aussitzen, sondern ein Tages-/Großlimit — der
   * Client bricht dann sofort ab. Default: 90000 (90s) — deckt Geminis RPM-
   * retryDelays (~30–60s) ab, schneidet aber TPD-Waits (Minuten) sauber ab.
   */
  maxRateLimitWaitMs?: number;
  /** Für Tests: alternative `fetch`-Implementierung. */
  fetchImpl?: typeof fetch;
  /** Roh-Mitschrieb (Request-Body ohne Key, Response/Fehler). */
  onExchange?: (exchange: AuroraModelExchange) => void;
  /** Per-Request-Telemetrie-Zeile (Default: console.log). Niemals der Key. */
  log?: (line: string) => void;
};

export class OpenAiCompatibleModelClient implements AuroraModelClient {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fallbackModel?: string;
  private readonly apiKey: string;
  private readonly temperature?: number;
  private readonly reasoningEffort?: string;
  private readonly providerLabel: string;
  private readonly maxRateLimitRetries: number;
  private readonly maxRateLimitWaitMs: number;
  private readonly host: string;
  private readonly fetchImpl: typeof fetch;
  private readonly onExchange?: (exchange: AuroraModelExchange) => void;
  private readonly log: (line: string) => void;
  private fallbackCallIdCounter = 0;

  constructor(options: OpenAiCompatibleModelClientOptions) {
    // Trailing-Slash normalisieren, damit `${baseUrl}/chat/completions` stimmt.
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.model = options.model ?? "";
    this.fallbackModel = options.fallbackModel;
    this.apiKey = options.apiKey ?? "";
    this.temperature = options.temperature;
    this.reasoningEffort = options.reasoningEffort;
    this.providerLabel = options.providerLabel ?? "openai-compatible";
    this.maxRateLimitRetries = options.maxRateLimitRetries ?? 5;
    this.maxRateLimitWaitMs = options.maxRateLimitWaitMs ?? 90000;
    this.host = safeHost(this.baseUrl);
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    this.onExchange = options.onExchange;
    // eslint-disable-next-line no-console
    this.log = options.log ?? ((line) => console.log(line));
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (!this.model) {
      throw new Error("AURORA_MODEL ist nicht gesetzt (OpenAI-kompatibler Provider).");
    }
    if (!this.apiKey) {
      throw new Error(
        "AURORA_API_KEY fehlt. Cloud-Keys NUR serverseitig/Node über process.env setzen — " +
          "niemals als VITE_*-Variable (die wäre clientseitig sichtbar). Siehe .env.example."
      );
    }

    const messages = toOpenAiMessages(request.systemPrompt, request.messages);

    // Über die Adaptionen hinweg veränderlich: reasoning_effort kann fallen,
    // das Modell kann auf den Fallback wechseln. Jede Adaption greift nur EINMAL.
    let includeEffort = this.reasoningEffort !== undefined;
    let model = this.model;
    let triedFallbackModel = false;
    let requestBody = this.buildBody(model, messages, request.tools, includeEffort);
    const start = Date.now();

    try {
      for (;;) {
        const response = await this.post(requestBody);

        if (!response.ok) {
          const errText = this.redact(await safeText(response));

          // Adaption 1: Provider lehnt reasoning_effort ab → ohne den Parameter.
          if (includeEffort && mentionsReasoningEffort(errText)) {
            this.log(
              `[aurora] ${this.providerLabel} hat reasoning_effort abgelehnt (HTTP ${response.status}) — ` +
                `Retry ohne reasoning_effort. Detail: ${truncate(errText)}`
            );
            includeEffort = false;
            requestBody = this.buildBody(model, messages, request.tools, includeEffort);
            continue;
          }

          // Adaption 2: primäres Modell nicht verfügbar → einmal mit dem Fallback.
          if (
            !triedFallbackModel &&
            this.fallbackModel &&
            this.fallbackModel !== model &&
            modelUnavailable(response.status, errText)
          ) {
            this.log(
              `[aurora] ${this.providerLabel} Modell "${model}" nicht verfügbar (HTTP ${response.status}) — ` +
                `Fallback auf "${this.fallbackModel}". Detail: ${truncate(errText)}`
            );
            triedFallbackModel = true;
            model = this.fallbackModel;
            requestBody = this.buildBody(model, messages, request.tools, includeEffort);
            continue;
          }

          throw new Error(
            `${this.providerLabel} request failed: ${response.status} ${response.statusText} ${truncate(errText)}`
          );
        }

        const data = (await response.json()) as OpenAiChatCompletionResponse;
        const latencyMs = Date.now() - start;
        this.onExchange?.({ requestBody, responseBody: data });
        const parsed = parseChatCompletionResponse(data, () => this.nextFallbackCallId());
        this.logResult({ model, includeEffort, latencyMs, data, parsed });
        return parsed;
      }
    } catch (error) {
      const latencyMs = Date.now() - start;
      const message = this.redact(error instanceof Error ? error.message : String(error));
      this.onExchange?.({ requestBody, error: message });
      this.logResult({ model, includeEffort, latencyMs, error: message });
      throw error;
    }
  }

  /** Baut den Chat-Completions-Body. reasoning_effort nur, wenn gesetzt UND nicht abgeworfen. */
  private buildBody(
    model: string,
    messages: Record<string, unknown>[],
    tools: ModelToolSchema[],
    includeEffort: boolean
  ): Record<string, unknown> {
    return {
      model,
      stream: false,
      messages,
      tools,
      ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
      ...(includeEffort && this.reasoningEffort !== undefined
        ? { reasoning_effort: this.reasoningEffort }
        : {}),
    };
  }

  /**
   * Sendet den Request mit Backoff für vorübergehende Fehler:
   * - HTTP 429 (Rate-Limit): respektiert den vorgeschlagenen Wartewert (Header
   *   `retry-after` bzw. "try again in Xs"); übersteigt er die Obergrenze
   *   (Tages-/Großlimit), wird sofort abgebrochen.
   * - Transiente 5xx (502/503/504, z. B. Geminis "high demand"): kurzer,
   *   linear steigender Backoff.
   * In beiden Fällen bis zu `maxRateLimitRetries`-mal. Die Fehler-Antwort wird
   * nur konsumiert, wenn tatsächlich ein Retry folgt — die finale (auch
   * nicht-ok) Antwort geht mit intaktem Body an den Aufrufer zurück.
   */
  private async post(body: unknown): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Der Key steht NUR hier — nie im Body, nie in Logs.
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      const retryable = response.status === 429 || TRANSIENT_STATUSES.has(response.status);
      if (!retryable || attempt >= this.maxRateLimitRetries) {
        return response;
      }

      const bodyText = await safeText(response);

      if (response.status === 429) {
        // Endgültig erschöpft (Guthaben/Prepay aufgebraucht): kein Minutenfenster
        // zum Aussitzen — sofort abbrechen statt sinnlos zu retryen.
        if (isUnrecoverableQuota(bodyText)) {
          this.log(
            `[aurora] ${this.providerLabel} 429 RESOURCE_EXHAUSTED — Guthaben/Quota endgültig erschöpft, ` +
              `kein Retry. Detail: ${truncate(this.redact(bodyText))}`
          );
          return new Response(bodyText, { status: response.status, statusText: response.statusText });
        }
        const suggestedMs = rateLimitSuggestedWaitMs(response, bodyText);
        // Übersteigt die vorgeschlagene Wartezeit unsere Obergrenze, ist es kein
        // kurzes Minuten-Limit (TPM) zum Aussitzen, sondern ein Tages-/Großlimit
        // (TPD) — Retryen wäre sinnlos. Sofort abbrechen, Body intakt für die
        // Fehlerdetail-Ausgabe des Aufrufers rekonstruieren.
        if (suggestedMs > this.maxRateLimitWaitMs) {
          this.log(
            `[aurora] ${this.providerLabel} rate-limited (HTTP 429) — vorgeschlagene Wartezeit ` +
              `${(suggestedMs / 1000).toFixed(0)}s übersteigt Cap ${(this.maxRateLimitWaitMs / 1000).toFixed(0)}s ` +
              `(vermutlich Tageslimit/TPD) — kein Retry. Detail: ${truncate(this.redact(bodyText))}`
          );
          return new Response(bodyText, { status: response.status, statusText: response.statusText });
        }
        this.log(
          `[aurora] ${this.providerLabel} rate-limited (HTTP 429) — warte ${(suggestedMs / 1000).toFixed(1)}s, ` +
            `Retry ${attempt + 1}/${this.maxRateLimitRetries}. Detail: ${truncate(this.redact(bodyText))}`
        );
        await sleep(suggestedMs);
        continue;
      }

      // Transiente 5xx: kurzer, linear steigender Backoff (2s, 4s, …), gedeckelt.
      const waitMs = Math.min(2000 * (attempt + 1), this.maxRateLimitWaitMs);
      this.log(
        `[aurora] ${this.providerLabel} transienter Fehler (HTTP ${response.status}) — warte ` +
          `${(waitMs / 1000).toFixed(1)}s, Retry ${attempt + 1}/${this.maxRateLimitRetries}. ` +
          `Detail: ${truncate(this.redact(bodyText))}`
      );
      await sleep(waitMs);
    }
  }

  /**
   * Eine Telemetrie-Zeile pro Request. Loggt das Response-Format robust —
   * finish_reason, Länge der Freitext-Nachricht, die Tool-Call-Namen und den
   * Token-Verbrauch (usage) — plus Latenz. Enthält bewusst NIE den API-Key.
   */
  private logResult(args: {
    model: string;
    includeEffort: boolean;
    latencyMs: number;
    data?: OpenAiChatCompletionResponse;
    parsed?: ModelResponse;
    error?: string;
  }): void {
    const fields = [
      `provider=${this.providerLabel}`,
      `host=${this.host}`,
      `model=${args.model}`,
      `temp=${this.temperature ?? "default"}`,
      `reasoning_effort=${this.reasoningEffortLabel(args.includeEffort)}`,
    ];

    if (args.data) {
      const finishReason = args.data.choices?.[0]?.finish_reason ?? "?";
      const usage = args.data.usage;
      fields.push(`finish_reason=${finishReason}`);
      fields.push(`content_len=${args.parsed?.message.length ?? 0}`);
      fields.push(`tool_calls=${formatToolCalls(args.parsed?.toolCalls ?? [])}`);
      if (usage) {
        fields.push(
          `usage=${usage.prompt_tokens ?? "?"}/${usage.completion_tokens ?? "?"}/${usage.total_tokens ?? "?"}`
        );
      }
    }

    fields.push(`latency=${args.latencyMs}ms`);
    if (args.error) fields.push(`error=${truncate(args.error)}`);
    this.log(`[aurora] ${fields.join(" ")}`);
  }

  /** "unset" (nie gesetzt), der Wert (gesendet) oder "none(after-retry)" (abgeworfen). */
  private reasoningEffortLabel(includeEffort: boolean): string {
    if (this.reasoningEffort === undefined) return "unset";
    return includeEffort ? this.reasoningEffort : "none(after-retry)";
  }

  /** Maskiert den API-Key in beliebigem Log-/Fehlertext (defensiv). */
  private redact(text: string): string {
    if (!this.apiKey) return text;
    return text.split(this.apiKey).join("***");
  }

  private nextFallbackCallId(): string {
    this.fallbackCallIdCounter += 1;
    return `call-${this.fallbackCallIdCounter}`;
  }
}

function safeHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return "unknown-host";
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

/** Vorübergehende Server-/Gateway-Fehler, die ein erneuter Versuch oft löst. */
const TRANSIENT_STATUSES = new Set([502, 503, 504]);

/**
 * Erkennt ein endgültig erschöpftes Kontingent (Guthaben/Prepay aufgebraucht)
 * in einer 429-Antwort — im Gegensatz zu einem aussitzbaren RPM/TPM-Fenster.
 * Gemini: "Your prepayment credits are depleted." Solche Fehler werden NICHT
 * retryt; der Wortlaut der gewöhnlichen RPM-429 ("exceeded your current quota")
 * trifft die Muster bewusst nicht.
 */
function isUnrecoverableQuota(bodyText: string): boolean {
  return /\bprepayment\b|\bcredits?\b[^.\n]{0,20}\bdepleted\b/i.test(bodyText);
}

function mentionsReasoningEffort(text: string): boolean {
  return /reasoning_effort/i.test(text);
}

/**
 * Heuristik: meldet der Provider das angefragte Modell als nicht verfügbar?
 *
 * HTTP 404 ist eindeutig. Bei 400 NUR auslösen, wenn nahe am Wort "model" eine
 * klare "nicht gefunden"-Formulierung steht — bewusst eng gefasst, damit
 * generische 400er NICHT fälschlich einen Modell-Fallback auslösen. Insbesondere
 * darf Geminis multi-turn 400 ("missing a thought_signature ... degraded model
 * performance", status INVALID_ARGUMENT) KEINEN Fallback triggern.
 */
function modelUnavailable(status: number, errText: string): boolean {
  if (status === 404) return true;
  return (
    status === 400 &&
    /\bmodels?\b[^.\n]{0,40}\b(not found|does not exist|is not supported|no longer available|unknown)\b/i.test(
      errText
    )
  );
}

function formatToolCalls(calls: ModelToolCall[]): string {
  return calls.length === 0 ? "none" : `[${calls.map((c) => c.name).join(", ")}]`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Ermittelt die vom Provider vorgeschlagene Wartezeit nach einem 429 (in ms,
 * UNGEDECKELT — der Aufrufer entscheidet über Cap/Abbruch). Reihenfolge:
 * 1. `retry-after`-Header (Sekunden),
 * 2. Groq-Wortlaut "try again in [Xm]Ys" im Body,
 * 3. Geminis strukturiertes `"retryDelay": "17s"` (google.rpc.RetryInfo),
 * sonst 2s Fallback. Plus 250ms Puffer.
 *
 * Exportiert für direkte Unit-Tests des Parsings (ohne echtes Warten).
 */
export function rateLimitSuggestedWaitMs(response: Response, bodyText: string): number {
  const header = response.headers.get("retry-after");
  const headerSeconds = header ? Number(header) : NaN;
  let seconds = Number.isFinite(headerSeconds) ? headerSeconds : NaN;

  if (!Number.isFinite(seconds)) {
    // Groq nennt z. B. "try again in 19.76s" ODER "try again in 57m35.136s".
    const match = /try again in\s+(?:(\d+)m)?\s*([\d.]+)\s*s/i.exec(bodyText);
    if (match) seconds = (match[1] ? Number(match[1]) * 60 : 0) + Number(match[2]);
  }

  if (!Number.isFinite(seconds)) {
    // Gemini liefert den Wert strukturiert: "retryDelay": "17s".
    const match = /"?retryDelay"?\s*:\s*"?([\d.]+)s/i.exec(bodyText);
    if (match) seconds = Number(match[1]);
  }

  const baseMs = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 2000;
  return baseMs + 250;
}

function truncate(text: string, max = 300): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}
