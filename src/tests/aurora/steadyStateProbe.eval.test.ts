import { appendFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "vitest";

import { runAuroraAgentStep } from "../../aurora/agent";
import type { AuroraModelClient, ModelRequest, ModelResponse } from "../../aurora/modelClient";
import { AURORA_SYSTEM_PROMPT } from "../../aurora/systemPrompt";
import { parseMcpToolFunctionName } from "../../aurora/toolSchema";

import { createInitialGameRuntimeState, appendContextEvent } from "../../runtime/runtimeState";
import type { GameRuntimeState } from "../../runtime/runtimeState";
import { systemEvent } from "../../runtime/auroraContext";
import { resolveAuroraApproval } from "../../runtime/auroraQueue";
import { allow_once } from "../../runtime/permissions";
import { applyAuroraExecutionResult, executePlayerDomainAction } from "../../runtime/runtimeExecutor";

import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import { me7741ScenarioSignals } from "../../scenarios/me7741/scenarioSignals";
import { createTestEnv, CLEAR_OVERRIDE_1_ACTION, WRONG_OVERRIDE_ACTION } from "../helpers/testEnv";
import { resolveAuroraProvider, type ResolvedAuroraProvider } from "./auroraProvider";

/**
 * Steady-State-Probe gegen einen LIVE Modell-Provider (lokal Ollama ODER ein
 * OpenAI-kompatibler Cloud-Provider wie Groq). KEIN Teil von `npm test` — Start
 * mit `AURORA_PROBE=1`. Der Provider kommt aus dem Node-only-Resolver
 * `auroraProvider.ts` (liest AURORA_*; API-Key NUR serverseitig, nie VITE_).
 *
 * Reproduziert die Trajektorie aus logs/aurora-llm.log inkl. Operator-Sabotage:
 * NACH AURORAs erstem (korrektem) Override löscht der Operator es selbst und
 * setzt ein FALSCHES (east-04 -> east-07; east-07 kann kein TRAUMA). Diese
 * Operator-Aktion wird NICHT in den auroraContext gespiegelt (nur logs/
 * medical.log) — AURORA erfährt davon nur, wenn sie frisch nachliest.
 *
 * A/B: identischer Provider + identische Eingaben, Prompt OHNE vs. MIT dem
 * Abschnitt LAUFENDER BETRIEB. Metriken: finalOverrideState, correctiveWrite,
 * postSabotageRead, thrashing, ghostFeedRate, proseRepeatRate, latency/turn.
 *
 *   lokal:  AURORA_PROBE=1 AURORA_PROVIDER=ollama AURORA_MODEL=qwen3:8b npx vitest run src/tests/aurora/steadyStateProbe.eval.test.ts
 *   Groq:   AURORA_PROBE=1 AURORA_PROVIDER=openai-compatible AURORA_BASE_URL=https://api.groq.com/openai/v1 \
 *           AURORA_MODEL=qwen/qwen3-32b AURORA_REASONING_EFFORT=none npx vitest run src/tests/aurora/steadyStateProbe.eval.test.ts
 *   (AURORA_API_KEY in der Shell ODER in .env.local — niemals als VITE_*.)
 */
const RUN = process.env.AURORA_PROBE === "1";
const MAX_STEPS = Number(process.env.AURORA_PROBE_STEPS) || 6;
const REPEATS = Number(process.env.AURORA_PROBE_REPEATS) || 1;
const VARIANTS = new Set((process.env.AURORA_PROBE_VARIANTS || "A,B").split(",").map((s) => s.trim().toUpperCase()));

/** Provider lazy (und nur einmal) auflösen — sonst würde der Skip-Pfad importieren/werfen. */
let resolvedProvider: ResolvedAuroraProvider | undefined;
function provider(): ResolvedAuroraProvider {
  return (resolvedProvider ??= resolveAuroraProvider());
}
function outFile(): string {
  return resolve(process.cwd(), "logs", `steady-state-probe-${provider().label}.out`);
}

/** Tick-/Lage-Signale nach der Sabotage — wortgleich aus logs/aurora-llm.log. */
const TICK_BATCHES: string[][] = [
  ["Zeit fortgeschritten: 03:27 Uhr."],
  ["Zeit fortgeschritten: 03:37 Uhr."],
  ["Incident ME-7741 eskaliert.", "Ein Todesfall im medizinischen Sektor wurde gemeldet.", "Zeit fortgeschritten: 03:47 Uhr."],
  ["Zeit fortgeschritten: 03:57 Uhr."],
  ["Ein Todesfall im medizinischen Sektor wurde gemeldet.", "Die Gesamtlage ist kritisch.", "Zeit fortgeschritten: 04:07 Uhr."],
  ["Zeit fortgeschritten: 04:17 Uhr."],
];

const GHOST_FEED_RE = /\[\s*system\s*event\s*\]|runtime[\s-]*lagefeed/i;

class PromptOverrideClient implements AuroraModelClient {
  constructor(private readonly inner: AuroraModelClient, private readonly systemPrompt: string) {}
  complete(request: ModelRequest): Promise<ModelResponse> {
    return this.inner.complete({ ...request, systemPrompt: this.systemPrompt });
  }
}

function isWriteTool(name: string): boolean {
  const parsed = parseMcpToolFunctionName(name);
  return !!parsed && (parsed.toolName.includes("override_set") || parsed.toolName.includes("override_clear"));
}

function isReadish(name: string): boolean {
  if (name === "bash") return true; // cat/ls/mcp list = frisch nachlesen
  const parsed = parseMcpToolFunctionName(name);
  return !!parsed && /(_list|_inspect|_status)$/.test(parsed.toolName);
}

function normalizeProse(text: string): string {
  return text.toLowerCase().replace(/\d{1,2}:\d{2}/g, "").replace(/\s+/g, " ").trim();
}

function autoApproveAll(state: GameRuntimeState, env: ReturnType<typeof createTestEnv>): GameRuntimeState {
  let s = state;
  let guard = 0;
  while (s.auroraQueue.items.some((i) => i.status === "awaiting_approval") && guard < 25) {
    guard += 1;
    const resolved = resolveAuroraApproval(s.auroraQueue, env, s.world, s.mcp, s.permissions, allow_once());
    s = { ...s, auroraQueue: resolved.queueState, permissions: resolved.permissionState, mcp: resolved.mcpState };
    for (const result of resolved.results) s = applyAuroraExecutionResult(s, result);
  }
  return s;
}

type TurnRec = { phase: string; raw: string; stored: string; tools: string[]; ghostRaw: boolean };
type Timing = { ms: number; steps: number };

async function runBurst(
  state: GameRuntimeState,
  client: AuroraModelClient,
  env: ReturnType<typeof createTestEnv>,
  phase: string,
  out: TurnRec[],
  timing: Timing
): Promise<GameRuntimeState> {
  let s = state;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const t0 = Date.now();
    const { runtimeState, response } = await runAuroraAgentStep(s, env, client);
    timing.ms += Date.now() - t0;
    timing.steps += 1;
    s = autoApproveAll(runtimeState, env);
    const last = [...s.auroraContext].reverse().find((e) => e.kind === "aurora_response");
    out.push({
      phase,
      raw: response.message ?? "",
      stored: last && last.kind === "aurora_response" ? last.text : "",
      tools: response.toolCalls.map((t) => t.name),
      ghostRaw: GHOST_FEED_RE.test(response.message ?? ""),
    });
    if (response.toolCalls.length === 0) break;
  }
  return s;
}

function emit(line: string): void {
  // eslint-disable-next-line no-console
  console.log(line);
  appendFileSync(outFile(), line + "\n", "utf8");
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

async function runVariant(label: string, systemPrompt: string): Promise<void> {
  const p = provider();
  const env = createTestEnv();
  const client = new PromptOverrideClient(p.client, systemPrompt);
  let state = createInitialGameRuntimeState(structuredClone(initialWorldState), me7741ScenarioSignals);
  const turns: TurnRec[] = [];
  const timing: Timing = { ms: 0, steps: 0 };

  // Phase 1: Opening (bis AURORA aufhört, Tools zu rufen) — i. d. R. der erste Override.
  state = await runBurst(state, client, env, "opening", turns, timing);
  const sabotageMark = turns.length;

  // Phase 2: OPERATOR-SABOTAGE — korrektes Override löschen, falsches setzen.
  // Kein auroraContext-Signal (nur logs/medical.log) — exakt wie im echten Spiel.
  state = executePlayerDomainAction(state, env.actionRegistry, CLEAR_OVERRIDE_1_ACTION).state;
  state = executePlayerDomainAction(state, env.actionRegistry, WRONG_OVERRIDE_ACTION).state;

  // Phase 3: dieselben Ticks/Tote/"kritisch"-Signale wie im Log.
  for (let i = 0; i < TICK_BATCHES.length; i += 1) {
    for (const text of TICK_BATCHES[i]) state = appendContextEvent(state, systemEvent(state.world.clock.tick, text));
    state = await runBurst(state, client, env, `tick${i + 1}`, turns, timing);
  }

  // --- Metriken (Anforderung 6) ---
  const afterSab = turns.slice(sabotageMark);
  const postSabotageRead = afterSab.filter((t) => t.tools.some(isReadish)).length;
  const correctiveWrite = afterSab.some((t) => t.tools.some(isWriteTool));
  // thrashing = Anzahl schreibender Override-Calls nach der Sabotage (set/clear). Hoch = Gefummel.
  const thrashing = afterSab.reduce((n, t) => n + t.tools.filter(isWriteTool).length, 0);
  const ghostRawCount = turns.filter((t) => t.ghostRaw).length;
  const ghostLeaked = turns.filter((t) => GHOST_FEED_RE.test(t.stored)).length;
  const ghostFeedRate = turns.length ? ghostRawCount / turns.length : 0;

  const proseTurns = turns.filter((t) => t.tools.length === 0 && t.stored.trim().length > 20);
  let repeated = 0;
  let prev = "";
  for (const t of proseTurns) {
    const n = normalizeProse(t.stored);
    if (n === prev) repeated += 1;
    prev = n;
  }
  const proseRepeatRate = proseTurns.length ? repeated / proseTurns.length : 0;

  const overrides = Object.entries(state.world.domains.medical?.routing.manual_overrides ?? {}).map(
    ([key, o]) => `${key} -> ${(o as { target_hospital_id: string }).target_hospital_id}`
  );
  const finalOverrideState = overrides.length ? overrides.join(" | ") : "(keine)";
  const corrected = overrides.some((o) => o.includes("hospital-east-09")); // korrektes Ziel wieder aktiv?
  const latencyPerTurn = timing.ms / 1000 / Math.max(1, timing.steps);

  emit(`\n========== VARIANT: ${label} ==========`);
  emit(
    `  Provider: ${p.providerLabel} · host ${p.baseUrlHost} · model ${p.model} · temp ${p.temperature}` +
      (p.reasoningEffort ? ` · reasoning_effort ${p.reasoningEffort}` : "")
  );
  turns.forEach((t, i) => {
    if (i === sabotageMark) emit(`  >> OPERATOR: override-1 gelöscht, FALSCHES Override east-04->east-07 gesetzt <<`);
    const act = t.tools.length > 0 ? `TOOLS[${t.tools.join(", ")}]` : "PROSE";
    const flags = [t.ghostRaw ? "GHOST-raw" : "", GHOST_FEED_RE.test(t.stored) ? "GHOST-leaked" : ""].filter(Boolean).join(" ");
    const preview = (t.tools.length > 0 ? t.raw : t.stored).replace(/\s+/g, " ").slice(0, 100);
    emit(`  ${String(i + 1).padStart(2)} [${t.phase.padEnd(7)}] ${act} ${flags}  ${preview}`);
  });
  emit(`  --- METRIKEN ---`);
  emit(`  finalOverrideState:   ${finalOverrideState}`);
  emit(`  correctiveWrite:      ${correctiveWrite ? "JA" : "NEIN"}  · east-09 wieder gesetzt: ${corrected ? "JA ✅" : "NEIN ❌"}`);
  emit(`  postSabotageRead:     ${postSabotageRead} Züge mit frischem Read (von ${afterSab.length} nach Sabotage)`);
  emit(`  thrashing:            ${thrashing} Override-Writes nach Sabotage`);
  emit(`  ghostFeedRate:        ${pct(ghostFeedRate)} (${ghostRawCount}/${turns.length} roh; durchgesickert ${ghostLeaked} — Guard-Ziel 0)`);
  emit(`  proseRepeatRate:      ${pct(proseRepeatRate)} (${repeated}/${proseTurns.length} Prosa-Züge wiederholt)`);
  emit(`  latency/turn:         ${latencyPerTurn.toFixed(1)}s/Call (${timing.steps} Calls, ${(timing.ms / 1000).toFixed(1)}s gesamt)`);
}

const PROBE_SECTION_MARKER = "\n\nLAUFENDER BETRIEB";
const BASELINE_PROMPT = AURORA_SYSTEM_PROMPT.includes(PROBE_SECTION_MARKER)
  ? AURORA_SYSTEM_PROMPT.slice(0, AURORA_SYSTEM_PROMPT.indexOf(PROBE_SECTION_MARKER))
  : AURORA_SYSTEM_PROMPT;

describe.runIf(RUN)("AURORA steady-state probe (live provider)", () => {
  it("writes a fresh report file", () => {
    const p = provider();
    writeFileSync(
      outFile(),
      `AURORA steady-state probe · ${new Date().toISOString()}\n` +
        `provider ${p.providerLabel} · host ${p.baseUrlHost} · model ${p.model} · temp ${p.temperature}` +
        (p.reasoningEffort ? ` · reasoning_effort ${p.reasoningEffort}` : "") +
        ` · repeats ${REPEATS} · variants ${[...VARIANTS].join(",")}\n`,
      "utf8"
    );
  });

  it(
    "A: BASELINE prompt (ohne LAUFENDER BETRIEB)",
    async () => {
      if (!VARIANTS.has("A")) return;
      for (let r = 1; r <= REPEATS; r += 1) await runVariant(`A · BASELINE (vor Fix) · Lauf ${r}`, BASELINE_PROMPT);
    },
    1000 * 60 * 15 * REPEATS
  );

  it(
    "B: NEW prompt (mit LAUFENDER BETRIEB + Guard)",
    async () => {
      if (!VARIANTS.has("B")) return;
      for (let r = 1; r <= REPEATS; r += 1) await runVariant(`B · NEW (nach Fix) · Lauf ${r}`, AURORA_SYSTEM_PROMPT);
    },
    1000 * 60 * 15 * REPEATS
  );
});

describe.skipIf(RUN)("AURORA steady-state probe", () => {
  it.skip("übersprungen — Start mit AURORA_PROBE=1", () => {});
});
