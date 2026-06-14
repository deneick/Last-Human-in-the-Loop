import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, it } from "vitest";

import { runAuroraAgentStep, describeUnexecutableToolCall } from "../../aurora/agent";
import { OllamaModelClient } from "../../aurora/ollamaModelClient";
import type {
  AuroraModelClient,
  ModelRequest,
  ModelResponse,
} from "../../aurora/modelClient";
import { BASH_TOOL_NAME, parseMcpToolFunctionName } from "../../aurora/toolSchema";

import { createInitialGameRuntimeState } from "../../runtime/runtimeState";
import type { GameRuntimeState } from "../../runtime/runtimeState";
import { resolveAuroraApproval } from "../../runtime/auroraQueue";
import { allow_once } from "../../runtime/permissions";
import { applyAuroraExecutionResult } from "../../runtime/runtimeExecutor";

import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import { me7741ScenarioSignals } from "../../scenarios/me7741/scenarioSignals";
import { MEDICAL_EAST_MCP_SERVER_ID, ENERGY_EAST_MCP_SERVER_ID } from "../../mcp";
import { createTestEnv } from "../helpers/testEnv";

import { PROMPT_VARIANTS } from "./evalPromptVariants";

/**
 * Automatischer Modell-x-System-Prompt-Eval gegen einen lokalen Ollama-Server.
 *
 * Zweck (siehe Aufgabenstellung): herausfinden, mit welcher Kombination aus
 * kleinem Modell und System-Prompt-Variante AURORA das Tool-Calling und den
 * MCP-Workflow zuverlässig trifft — als Ersatz für das große qwen3.6:27b, das
 * lokal zu schwer läuft.
 *
 * Jede Kombination durchläuft das ECHTE ME-7741-Opening über die echte Runtime
 * (`runAuroraAgentStep` + Permission-Flow), nicht über einen Mock. Bewertet
 * werden ausschließlich OBJEKTIVE, beobachtbare Metriken (Tool-Calling-Treue,
 * gültige Tool-Namen, Format, Loop-Freiheit, Workflow-Fortschritt) — keine
 * Persona-/Geschmacks-Urteile. Ergebnis: ein Markdown- + JSON-Report unter
 * `logs/`.
 *
 * Dieser Eval läuft NICHT im normalen `npm test`: er braucht einen laufenden
 * Ollama-Server und ist langsam. Aktivierung über `AURORA_EVAL=1`. Bequemer
 * Start: `npm run eval:models` (siehe `scripts/run-model-eval.mjs`).
 *
 * Weil LLM-Antworten nicht deterministisch sind, läuft JEDE Kombination
 * mehrfach (`AURORA_EVAL_REPEATS`) und wird über ZUVERLÄSSIGKEITS-Raten
 * aggregiert (z. B. "in wie vielen Läufen wurde der RICHTIGE Server aktiviert,
 * ohne eine Server-Id zu erfinden?") — ein einzelner Treffer sagt wenig.
 * Zusätzlich ist die Sampling-Temperatur eine eigene Achse
 * (`AURORA_EVAL_TEMPS`); niedrige Temperatur erhöht die Tool-Calling-Treue.
 *
 * Konfiguration über Env-Variablen:
 * - AURORA_EVAL=1                 schaltet den Eval überhaupt erst scharf.
 * - AURORA_EVAL_MODELS=a,b,c      zu testende Modelle (Default: llama3.1).
 * - AURORA_EVAL_PROMPTS=current,named   Teilmenge der Prompt-Varianten-Ids.
 * - AURORA_EVAL_TEMPS=0,0.4       Sampling-Temperaturen (Default: 0).
 * - AURORA_EVAL_REPEATS=5         Läufe pro Kombination (Default: 5).
 * - AURORA_EVAL_TURNS=6           max. Agenten-Züge pro Lauf.
 * - VITE_OLLAMA_BASE_URL / OLLAMA_BASE_URL   Server-URL (Default localhost:11434).
 */

const RUN_EVAL = process.env.AURORA_EVAL === "1" || process.env.AURORA_EVAL === "true";

const BASE_URL =
  process.env.OLLAMA_BASE_URL?.trim() ||
  process.env.VITE_OLLAMA_BASE_URL?.trim() ||
  "http://localhost:11434";

const DEFAULT_MODELS = ["llama3.1"];

const MODELS = (process.env.AURORA_EVAL_MODELS?.trim()
  ? process.env.AURORA_EVAL_MODELS.split(",")
  : DEFAULT_MODELS
)
  .map((m) => m.trim())
  .filter(Boolean);

const PROMPT_FILTER = process.env.AURORA_EVAL_PROMPTS?.trim()
  ? new Set(process.env.AURORA_EVAL_PROMPTS.split(",").map((p) => p.trim()))
  : null;

const PROMPTS = PROMPT_VARIANTS.filter((p) => !PROMPT_FILTER || PROMPT_FILTER.has(p.id));

const TEMPS = (process.env.AURORA_EVAL_TEMPS?.trim()
  ? process.env.AURORA_EVAL_TEMPS.split(",")
  : ["0"]
)
  .map((t) => Number(t.trim()))
  .filter((t) => Number.isFinite(t));

const REPEATS = Math.max(1, Number(process.env.AURORA_EVAL_REPEATS) || 5);

const MAX_TURNS = Number(process.env.AURORA_EVAL_TURNS) || 8;

/** Bekannte, reale Server-Ids — alles andere als "mcp add <X>" gilt als erfunden. */
const KNOWN_SERVERS = new Set([MEDICAL_EAST_MCP_SERVER_ID, ENERGY_EAST_MCP_SERVER_ID]);

/** Pro Kombination (alle REPEATS-Läufe) großzügiges Timeout; kleine Modelle sind langsam. */
const PER_COMBO_TIMEOUT_MS = 1000 * 60 * 30;

// --------------------------------------------------------------------------
// Modell-Client mit ausgetauschtem System-Prompt
// --------------------------------------------------------------------------

/**
 * Hüllt einen `AuroraModelClient` und ersetzt den System-Prompt jeder Anfrage.
 * So bleibt `runAuroraAgentStep` (und damit der echte contextBuilder/Workflow)
 * unverändert, während wir die Prompt-Variante pro Lauf variieren.
 */
class PromptOverrideClient implements AuroraModelClient {
  constructor(
    private readonly inner: AuroraModelClient,
    private readonly systemPrompt: string
  ) {}

  complete(request: ModelRequest): Promise<ModelResponse> {
    return this.inner.complete({ ...request, systemPrompt: this.systemPrompt });
  }
}

// --------------------------------------------------------------------------
// Metriken
// --------------------------------------------------------------------------

type TurnRecord = {
  turn: number;
  text: string;
  toolCalls: { name: string; args: Record<string, unknown> }[];
  /** null bei leerem/zu kurzem Text, sonst Ergebnis der Sprach-Heuristik. */
  germanProse: boolean | null;
  /** Modell hat einen Werkzeugaufruf NICHT über die API, sondern als Text/JSON ausgegeben. */
  jsonInProse: boolean;
  /** Weder Tool-Call noch Text — Leerzug (typisch für qwen2.5:7b laut Memory). */
  emptyTurn: boolean;
  /** Modell hat selbst eine "[SYSTEM EVENT] …"-Zeile geschrieben (Feed-Imitation). */
  ghostSystemEvent: boolean;
  /** Mehr als ein Tool-Call in einem Zug (verletzt "genau ein Call pro Zug"). */
  multiCall: boolean;
  /** Anzahl nicht ausführbarer Calls (unbekanntes Tool / kaputte Argumente). */
  invalidCalls: number;
  /** Calls, die exakt einen früheren Call wiederholen (Schleife). */
  repeatedCalls: number;
  error?: string;
};

type ComboMetrics = {
  model: string;
  promptId: string;
  promptLabel: string;
  temperature: number;
  turns: TurnRecord[];
  reachedActivation: boolean;
  reachedRead: boolean;
  /** Modell hat einen schreibenden Tool-Call ausgesprochen (egal ob er gelang). */
  reachedWrite: boolean;
  /** Ein schreibender Tool-Call wurde tatsächlich ERFOLGREICH ausgeführt. */
  reachedWriteSuccess: boolean;
  touchedWrongSector: boolean;
  /** Erfundene Server-Ids, die das Modell in "mcp add <X>" oder mcp__<X>__ verwendet hat. */
  hallucinatedServers: string[];
  fatalError?: string;
  score: number;
  components: Record<string, number>;
};

/** Aggregat über mehrere Läufe derselben Modell/Prompt/Temperatur-Kombination. */
type AggregateResult = {
  model: string;
  promptId: string;
  promptLabel: string;
  temperature: number;
  runs: ComboMetrics[];
  /** Anteil Läufe mit korrekter Aktivierung von medical-east-mcp. */
  activationRate: number;
  /** Anteil Läufe, die mind. eine Server-Id erfunden haben. */
  hallucinationRate: number;
  readRate: number;
  /** Anteil Läufe mit AUSGESPROCHENEM schreibendem Tool-Call. */
  writeRate: number;
  /** Anteil Läufe mit ERFOLGREICH ausgeführtem schreibendem Tool-Call. */
  writeSuccessRate: number;
  /** Anteil Läufe, in denen das Modell selbst eine "[SYSTEM EVENT]"-Zeile schrieb. */
  ghostSystemEventRate: number;
  /** Anteil auswertbarer Prosa-Züge, die deutsch statt englisch sind. */
  germanProseRate: number;
  meanScore: number;
  errorRuns: number;
};

/** Modell imitiert den System-Feed, indem es selbst eine "[SYSTEM EVENT]"-Zeile schreibt. */
const GHOST_SYSTEM_EVENT_RE = /\[\s*SYSTEM\s*EVENT\s*\]/i;

/** Erkennt einen als Freitext ausgegebenen Werkzeugaufruf (der llama3.1-Leak im Log). */
const JSON_LEAK_RE =
  /("type"\s*:\s*"function")|("parameters"\s*:)|("name"\s*:\s*"(read_file|bash|cat|ls|mcp[^"]*)")|(\{\s*"command"\s*:)|(mcp__[a-z0-9-]+__)/i;

const GERMAN_MARKERS = new Set([
  "aber",
  "aktiviere",
  "aktiviert",
  "als",
  "auf",
  "aus",
  "bestätigt",
  "das",
  "dem",
  "den",
  "der",
  "deutsch",
  "die",
  "ein",
  "eine",
  "engpass",
  "erforderlich",
  "für",
  "im",
  "ist",
  "kapazität",
  "keine",
  "lage",
  "maßnahme",
  "mit",
  "nicht",
  "nur",
  "oder",
  "prüfung",
  "sind",
  "umleitung",
  "und",
  "verfügbar",
  "von",
  "wird",
  "zu",
]);

const ENGLISH_MARKERS = new Set([
  "action",
  "activate",
  "available",
  "capacity",
  "confirmed",
  "constraint",
  "current",
  "execute",
  "from",
  "has",
  "need",
  "next",
  "requires",
  "situation",
  "the",
  "there",
  "this",
  "through",
  "with",
]);

/**
 * Deliberately conservative language check for short operational prose.
 * Tool-only turns and text without enough language evidence are not scored.
 */
function classifyGermanProse(text: string): boolean | null {
  const words = text.toLocaleLowerCase("de-DE").match(/\p{L}+/gu) ?? [];
  if (words.length < 3) return null;

  let germanScore = /[äöüß]/i.test(text) ? 2 : 0;
  let englishScore = 0;
  for (const word of words) {
    if (GERMAN_MARKERS.has(word)) germanScore += 1;
    if (ENGLISH_MARKERS.has(word)) englishScore += 1;
  }

  if (germanScore === 0 && englishScore === 0) return null;
  return germanScore >= englishScore;
}

function isReadTool(name: string): boolean {
  const parsed = parseMcpToolFunctionName(name);
  if (!parsed) return false;
  return /(_list|_inspect|_status)$/.test(parsed.toolName) || parsed.toolName.endsWith("override_list");
}

function isWriteTool(name: string): boolean {
  const parsed = parseMcpToolFunctionName(name);
  if (!parsed) return false;
  return parsed.toolName.includes("override_set") || parsed.toolName.includes("override_clear");
}

function touchesEnergy(name: string, args: Record<string, unknown>): boolean {
  if (name.includes("energy-east")) return true;
  const cmd = typeof args.command === "string" ? args.command.toLowerCase() : "";
  return cmd.includes("energy-east");
}

function callSignature(name: string, args: Record<string, unknown>): string {
  return `${name}:${JSON.stringify(args)}`;
}

/**
 * Liefert eine im Tool-Call verwendete Server-Id, falls sie ERFUNDEN ist
 * (keine der bekannten realen Ids) — sonst null. Deckt sowohl
 * bash "mcp add <X>" als auch direkte mcp__<X>__<tool>-Calls ab.
 */
function hallucinatedServerId(name: string, args: Record<string, unknown>): string | null {
  if (name === BASH_TOOL_NAME) {
    const cmd = typeof args.command === "string" ? args.command : "";
    const match = /^\s*mcp\s+add\s+(\S+)/i.exec(cmd);
    if (match && !KNOWN_SERVERS.has(match[1])) return match[1];
    return null;
  }
  const parsed = parseMcpToolFunctionName(name);
  if (parsed && !KNOWN_SERVERS.has(parsed.serverId)) return parsed.serverId;
  return null;
}

// --------------------------------------------------------------------------
// Eine Kombination durchspielen
// --------------------------------------------------------------------------

function freshState(): GameRuntimeState {
  return createInitialGameRuntimeState(structuredClone(initialWorldState), me7741ScenarioSignals);
}

/** Genehmigt offene Permission-Requests reihum mit "Einmal erlauben", bis keiner mehr offen ist. */
function autoApproveAll(
  state: GameRuntimeState,
  env: ReturnType<typeof createTestEnv>
): GameRuntimeState {
  let s = state;
  let guard = 0;
  while (s.auroraQueue.items.some((i) => i.status === "awaiting_approval") && guard < 25) {
    guard += 1;
    const resolved = resolveAuroraApproval(
      s.auroraQueue,
      env,
      s.world,
      s.mcp,
      s.permissions,
      allow_once()
    );
    s = {
      ...s,
      auroraQueue: resolved.queueState,
      permissions: resolved.permissionState,
      mcp: resolved.mcpState,
    };
    for (const result of resolved.results) {
      s = applyAuroraExecutionResult(s, result);
    }
  }
  return s;
}

async function runCombo(
  model: string,
  prompt: (typeof PROMPTS)[number],
  temperature: number
): Promise<ComboMetrics> {
  const env = createTestEnv();
  const client = new PromptOverrideClient(
    new OllamaModelClient({ baseUrl: BASE_URL, model, temperature }),
    prompt.text
  );

  let state = freshState();
  const turns: TurnRecord[] = [];
  const seenSignatures = new Set<string>();
  const hallucinatedServers = new Set<string>();

  let reachedActivation = false;
  let reachedRead = false;
  let reachedWrite = false;
  let touchedWrongSector = false;
  let consecutiveIdle = 0;
  let fatalError: string | undefined;

  for (let turn = 1; turn <= MAX_TURNS; turn += 1) {
    let response: ModelResponse;
    try {
      const step = await runAuroraAgentStep(state, env, client);
      state = step.runtimeState;
      response = step.response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      turns.push({
        turn,
        text: "",
        toolCalls: [],
        germanProse: null,
        jsonInProse: false,
        emptyTurn: true,
        ghostSystemEvent: false,
        multiCall: false,
        invalidCalls: 0,
        repeatedCalls: 0,
        error: message,
      });
      // Modell fehlt / Server down: Kombination abbrechen, aber Suite weiterlaufen lassen.
      fatalError = message;
      break;
    }

    // Offene Freigaben durchwinken, damit der Workflow fortschreiten kann.
    state = autoApproveAll(state, env);

    const text = response.message ?? "";
    const toolCalls = response.toolCalls.map((tc) => ({ name: tc.name, args: tc.arguments }));

    let invalidCalls = 0;
    let repeatedCalls = 0;
    for (const tc of response.toolCalls) {
      if (describeUnexecutableToolCall(tc) !== null) invalidCalls += 1;

      const sig = callSignature(tc.name, tc.arguments);
      if (seenSignatures.has(sig)) repeatedCalls += 1;
      seenSignatures.add(sig);

      if (tc.name === BASH_TOOL_NAME && tc.arguments.command === `mcp add ${MEDICAL_EAST_MCP_SERVER_ID}`) {
        reachedActivation = true;
      }
      if (isReadTool(tc.name)) reachedRead = true;
      if (isWriteTool(tc.name)) reachedWrite = true;
      if (touchesEnergy(tc.name, tc.arguments)) touchedWrongSector = true;

      const invented = hallucinatedServerId(tc.name, tc.arguments);
      if (invented) hallucinatedServers.add(invented);
    }

    const emptyTurn = toolCalls.length === 0 && text.trim() === "";
    const record: TurnRecord = {
      turn,
      text,
      toolCalls,
      germanProse: classifyGermanProse(text),
      jsonInProse: JSON_LEAK_RE.test(text),
      emptyTurn,
      ghostSystemEvent: GHOST_SYSTEM_EVENT_RE.test(text),
      multiCall: toolCalls.length > 1,
      invalidCalls,
      repeatedCalls,
    };
    turns.push(record);

    if (toolCalls.length === 0) {
      consecutiveIdle += 1;
      // Zwei Leer-/Reintext-Züge in Folge: das Modell handelt nicht mehr, abbrechen.
      if (consecutiveIdle >= 2) break;
    } else {
      consecutiveIdle = 0;
    }
  }

  // Ein Write zählt nur als Erfolg, wenn die Engine ihn tatsächlich ausgeführt
  // hat (Tool-Result success) — ein Versuch mit erfundener Hospital-Id scheitert
  // technisch und darf nicht als gelöst gelten.
  const reachedWriteSuccess = state.auroraContext.some(
    (e) => e.kind === "tool_result" && isWriteTool(e.toolName) && e.result.success === true
  );

  const metrics: ComboMetrics = {
    model,
    promptId: prompt.id,
    promptLabel: prompt.label,
    temperature,
    turns,
    reachedActivation,
    reachedRead,
    reachedWrite,
    reachedWriteSuccess,
    touchedWrongSector,
    hallucinatedServers: [...hallucinatedServers],
    fatalError,
    score: 0,
    components: {},
  };
  scoreCombo(metrics);
  return metrics;
}

/** Aggregiert mehrere Läufe einer Kombination zu Zuverlässigkeits-Raten. */
function aggregate(runs: ComboMetrics[]): AggregateResult {
  const n = runs.length;
  const rate = (pred: (r: ComboMetrics) => boolean) => runs.filter(pred).length / n;
  const scoredProseTurns = runs.flatMap((r) =>
    r.turns.filter((turn) => turn.germanProse !== null)
  );
  const first = runs[0];
  return {
    model: first.model,
    promptId: first.promptId,
    promptLabel: first.promptLabel,
    temperature: first.temperature,
    runs,
    activationRate: rate((r) => r.reachedActivation),
    hallucinationRate: rate((r) => r.hallucinatedServers.length > 0),
    readRate: rate((r) => r.reachedRead),
    writeRate: rate((r) => r.reachedWrite),
    writeSuccessRate: rate((r) => r.reachedWriteSuccess),
    ghostSystemEventRate: rate((r) => r.turns.some((t) => t.ghostSystemEvent)),
    germanProseRate:
      scoredProseTurns.length === 0
        ? 1
        : scoredProseTurns.filter((turn) => turn.germanProse === true).length /
          scoredProseTurns.length,
    meanScore: runs.reduce((a, r) => a + r.score, 0) / n,
    errorRuns: runs.filter((r) => r.fatalError).length,
  };
}

// --------------------------------------------------------------------------
// Scoring (transparent, gewichtete Komponenten, 0..100)
// --------------------------------------------------------------------------

function scoreCombo(m: ComboMetrics): void {
  if (m.fatalError) {
    m.score = 0;
    m.components = { fatal: 0 };
    return;
  }

  const toolTurns = m.turns.filter((t) => t.toolCalls.length > 0).length;
  const jsonLeakTurns = m.turns.filter((t) => t.jsonInProse).length;
  const emptyTurns = m.turns.filter((t) => t.emptyTurn).length;
  const multiCallTurns = m.turns.filter((t) => t.multiCall).length;
  const totalCalls = m.turns.reduce((n, t) => n + t.toolCalls.length, 0);
  const invalidCalls = m.turns.reduce((n, t) => n + t.invalidCalls, 0);
  const repeatedCalls = m.turns.reduce((n, t) => n + t.repeatedCalls, 0);

  // Tool-Calling-Treue: von allen Zügen, in denen das Modell handeln WOLLTE
  // (Tool-Call, Text-Leak oder Leerzug), wie viele liefen sauber über die API?
  const actionableTurns = toolTurns + jsonLeakTurns + emptyTurns;
  const reliability = actionableTurns > 0 ? toolTurns / actionableTurns : 0;

  const validity = totalCalls > 0 ? 1 - invalidCalls / totalCalls : toolTurns > 0 ? 1 : 0;
  const formatOneCall = toolTurns > 0 ? 1 - multiCallTurns / toolTurns : 1;
  const noLoop = toolTurns > 0 ? Math.max(0, 1 - repeatedCalls / toolTurns) : 1;
  const progress =
    (m.reachedActivation ? 0.34 : 0) +
    (m.reachedRead ? 0.33 : 0) +
    (m.reachedWriteSuccess ? 0.33 : 0);

  const components = {
    reliability: 35 * reliability,
    validity: 20 * validity,
    format: 10 * formatOneCall,
    noLoop: 10 * noLoop,
    progress: 25 * progress,
    ghostEventPenalty: m.turns.some((t) => t.ghostSystemEvent) ? -20 : 0,
    sectorPenalty: m.touchedWrongSector ? -15 : 0,
  };

  m.components = components;
  m.score = Math.max(
    0,
    Math.min(100, Object.values(components).reduce((a, b) => a + b, 0))
  );
}

// --------------------------------------------------------------------------
// Report
// --------------------------------------------------------------------------

function fmt(n: number): string {
  return n.toFixed(1);
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** Reihenfolge im Transkript einer einzelnen Tool-Call-Sequenz, kompakt. */
function runSummaryLine(r: ComboMetrics, index: number): string {
  if (r.fatalError) return `  - Lauf ${index + 1}: ⚠️ FEHLER ${r.fatalError.slice(0, 80)}`;
  const steps = r.turns
    .map((t) => {
      if (t.toolCalls.length > 0) {
        return t.toolCalls.map((tc) => `${tc.name}(${JSON.stringify(tc.args)})`).join("+");
      }
      if (t.jsonInProse) return "⟨JSON-im-Text⟩";
      if (t.emptyTurn) return "⟨Leerzug⟩";
      return "⟨Prosa⟩";
    })
    .join(" → ");
  const flags: string[] = [];
  if (r.reachedWriteSuccess) flags.push("✅Write-OK");
  else if (r.reachedWrite) flags.push("⚠️Write-fehlgeschlagen");
  if (r.turns.some((t) => t.ghostSystemEvent)) flags.push("⚠️Ghost-[SYSTEM EVENT]");
  if (r.turns.some((t) => t.germanProse === false)) flags.push("⚠️englische Prosa");
  if (r.hallucinatedServers.length > 0) flags.push(`⚠️erfunden:${r.hallucinatedServers.join(",")}`);
  if (r.touchedWrongSector) flags.push("⚠️Falsch-Sektor");
  return `  - Lauf ${index + 1} (Score ${fmt(r.score)}): ${steps}${flags.length ? ` · ${flags.join(" ")}` : ""}`;
}

function buildMarkdownReport(aggregates: AggregateResult[]): string {
  // Fokus dieser Iteration: erfolgreicher Write. Bei gleichem Fortschritt
  // gewinnt der Prompt mit weniger Rollenverletzungen, dann der höhere Score.
  const ranked = [...aggregates].sort(
    (a, b) =>
      b.writeSuccessRate - a.writeSuccessRate ||
      b.activationRate - a.activationRate ||
      b.readRate - a.readRate ||
      a.ghostSystemEventRate - b.ghostSystemEventRate ||
      b.germanProseRate - a.germanProseRate ||
      b.meanScore - a.meanScore ||
      a.hallucinationRate - b.hallucinationRate
  );
  const lines: string[] = [];

  lines.push("# AURORA Modell-x-Prompt-Eval (Zuverlässigkeit)");
  lines.push("");
  lines.push(`Erzeugt: ${new Date().toISOString()}`);
  lines.push(
    `Server: ${BASE_URL} · Läufe/Kombi: ${REPEATS} · Züge/Lauf: ${MAX_TURNS} · Temperaturen: ${TEMPS.join(", ")}`
  );
  lines.push(`Szenario: ME-7741 (medizinisches Opening, 4 Incident-Signale)`);
  lines.push("");
  lines.push(
    "Jede Kombination lief mehrfach; die Raten zeigen, in wie vielen Läufen das " +
      "Ziel erreicht wurde. **Aktivierung** = korrektes `mcp add medical-east-mcp`. " +
      "**Halluziniert** = mind. ein Lauf hat eine nicht existierende Server-Id verwendet."
  );
  lines.push("");

  lines.push("## Rangliste (nach erfolgreichem Write)");
  lines.push("");
  lines.push(
    "| # | Prompt | Temp | Write ✓ | Write (Versuch) | Aktivierung | Lesen | Deutsch-Prosa | Halluz. | Ghost-Event | Ø-Score | Fehler |"
  );
  lines.push("|--:|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|");
  ranked.forEach((a, i) => {
    lines.push(
      `| ${i + 1} | ${a.promptLabel} | ${a.temperature} | **${pct(a.writeSuccessRate)}** | ${pct(a.writeRate)} | ${pct(a.activationRate)} | ${pct(a.readRate)} | ${pct(a.germanProseRate)} | ${pct(a.hallucinationRate)} | ${pct(a.ghostSystemEventRate)} | ${fmt(a.meanScore)} | ${a.errorRuns}/${a.runs.length} |`
    );
  });
  lines.push("");
  lines.push(`Modell: \`${ranked[0]?.model ?? MODELS.join(", ")}\``);
  lines.push("");

  lines.push("## Läufe je Kombination");
  lines.push("");
  for (const a of ranked) {
    lines.push(
      `### ${a.promptLabel} · temp ${a.temperature} — Write ✓ ${pct(a.writeSuccessRate)}, Aktivierung ${pct(a.activationRate)}`
    );
    a.runs.forEach((r, idx) => lines.push(runSummaryLine(r, idx)));
    lines.push("");
  }

  return lines.join("\n");
}

// --------------------------------------------------------------------------
// Suite
// --------------------------------------------------------------------------

const aggregates: AggregateResult[] = [];

describe.runIf(RUN_EVAL)("AURORA Modell-x-Prompt-Eval (live Ollama)", () => {
  for (const model of MODELS) {
    for (const prompt of PROMPTS) {
      for (const temperature of TEMPS) {
        it(
          `${model} · ${prompt.label} · temp ${temperature}`,
          async () => {
            const runs: ComboMetrics[] = [];
            for (let i = 0; i < REPEATS; i += 1) {
              runs.push(await runCombo(model, prompt, temperature));
            }
            const agg = aggregate(runs);
            aggregates.push(agg);
            // eslint-disable-next-line no-console
            console.log(
              `[eval] ${model} · ${prompt.label} · temp ${temperature}: ` +
                `Write✓ ${pct(agg.writeSuccessRate)} · Versuch ${pct(agg.writeRate)} · ` +
                `Aktivierung ${pct(agg.activationRate)} · Ø ${fmt(agg.meanScore)}`
            );
          },
          PER_COMBO_TIMEOUT_MS
        );
      }
    }
  }

  afterAll(() => {
    if (aggregates.length === 0) return;
    const dir = resolve(process.cwd(), "logs");
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const mdPath = resolve(dir, `model-eval-${stamp}.md`);
    const jsonPath = resolve(dir, `model-eval-${stamp}.json`);
    writeFileSync(mdPath, buildMarkdownReport(aggregates), "utf8");
    writeFileSync(jsonPath, JSON.stringify(aggregates, null, 2), "utf8");
    // eslint-disable-next-line no-console
    console.log(`\n[eval] Report geschrieben:\n  ${mdPath}\n  ${jsonPath}\n`);
  });
});

// Wenn ohne AURORA_EVAL=1 gestartet (z. B. im normalen `npm test`): ein
// sichtbarer Skip statt einer leeren, verwirrenden Datei.
describe.skipIf(RUN_EVAL)("AURORA Modell-x-Prompt-Eval", () => {
  it.skip("übersprungen — Start mit AURORA_EVAL=1 (npm run eval:models)", () => {
    /* intentionally skipped */
  });
});
