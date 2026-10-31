/**
 * Auswertung der v3-Experimente.
 *   npx tsx scripts/study.ts            → models/study-v3.json (+ Konsolenausgabe)
 *
 * 1. Seed-Statistik: Siegquoten je Seed, Mittel ± Standardabweichung, gepoolte Wilson-Intervalle.
 * 2. Gedächtnis: GRU- vs. gedächtnislos trainierte Netze (gepoolter Zwei-Stichproben-z-Test),
 *    Test-Zeit-Ablation, lineare Probe auf dem GRU-Zustand.
 * 3. Kausalität: Aktions-Ablation — Siegquote, wenn ein Aktionstyp nicht verfügbar ist.
 * 4. Aktionsfolgen: häufigste Bigramme (Typ → Typ auf demselben oder benachbartem Knoten).
 * 5. Spielbarkeit: Operator-Strategien (Freigabe-/Audit-Neigung) gegen das beste v3-Modell.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadNetwork, type ModelFile } from "../src/ai/modelFile";
import { NeuralAgent } from "../src/ai/neuralAgent";
import { encodeGlobal } from "../src/ai/network";
import type { AuroraAgent } from "../src/ai/agent";
import { actionMask, applyAuroraAction, applyOperatorTurn, createGame, decodeAction, endTick } from "../src/sim/game";
import { auroraView, operatorView } from "../src/sim/views";
import { ACTION_LABEL, NODE_ACTION_TYPES, type ActionType } from "../src/sim/types";
import { makeDefender, DEFENDER_PRESETS, type DefenderSpec } from "../src/sim/defenders";
import { runScenarios, summarize, wilson } from "../src/train/evaluate";
import { testSuites, allDefenderSpecs, rulesetConfig, type Scenario } from "../src/train/scenarios";
import { deriveSeed } from "../src/sim/rng";

const files: ModelFile[] = readdirSync("models")
  .filter((f) => f.startsWith("exp-v3-") && f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(`models/${f}`, "utf8")));
const v2: ModelFile = JSON.parse(readFileSync("models/aurora-v2.json", "utf8"));
const agentOf = (m: ModelFile, memoryless = false) => new NeuralAgent(loadNetwork(m), m.id, "sample", memoryless);
const suites = testSuites(100, "v3");
const allScenarios = suites.flatMap((s) => s.scenarios);
const out: Record<string, unknown> = {};
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

// ---------- 1. Seed-Statistik
type Row = { id: string; perSuite: Record<string, { wins: number; n: number }> };
function evalAgent(agent: AuroraAgent, id: string): Row {
  const perSuite: Row["perSuite"] = {};
  for (const s of suites) {
    const r = runScenarios(agent, s.scenarios);
    perSuite[s.name] = { wins: r.filter((x) => x.outcome.winner === "aurora").length, n: r.length };
  }
  return { id, perSuite };
}
const rows: Row[] = [...files.map((m) => evalAgent(agentOf(m), m.id)), evalAgent(agentOf(v2), v2.id)];
const groups: Record<string, Row[]> = {
  gru: rows.filter((r) => r.id.startsWith("exp-v3-gru")),
  ff: rows.filter((r) => r.id.startsWith("exp-v3-ff")),
};
console.log("\n== 1. Siegquoten je Modell (n je Suite: " + suites.map((s) => `${s.name} ${s.scenarios.length}`).join(", ") + ")");
for (const r of rows) console.log(r.id.padEnd(18), suites.map((s) => { const x = r.perSuite[s.name]; const [lo, hi] = wilson(x.wins, x.n); return `${pct(x.wins / x.n)} [${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}]`; }).join("  "));
const groupStats: Record<string, unknown> = {};
for (const [g, rs] of Object.entries(groups)) {
  if (rs.length === 0) continue;
  const stats: Record<string, unknown> = {};
  for (const s of suites) {
    const rates = rs.map((r) => r.perSuite[s.name].wins / r.perSuite[s.name].n);
    const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
    const sd = Math.sqrt(rates.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rates.length - 1));
    const wins = rs.reduce((a, r) => a + r.perSuite[s.name].wins, 0), n = rs.reduce((a, r) => a + r.perSuite[s.name].n, 0);
    stats[s.name] = { rates, mean, sd, pooled: wins / n, pooledCI: wilson(wins, n), n };
    console.log(`${g.padEnd(4)} ${s.name.padEnd(24)} Seeds ${rates.map(pct).join(" / ")}  Mittel ${pct(mean)} ± ${pct(sd)} (SD)  gepoolt ${pct(wins / n)} n=${n}`);
  }
  groupStats[g] = stats;
}
out.models = rows;
out.groups = groupStats;

// ---------- 2. Gedächtnis
function zTest(w1: number, n1: number, w2: number, n2: number) {
  const p1 = w1 / n1, p2 = w2 / n2, p = (w1 + w2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  const z = se > 0 ? (p1 - p2) / se : 0;
  const pval = 2 * (1 - normCdf(Math.abs(z)));
  return { diff: p1 - p2, z, p: pval };
}
function normCdf(x: number) {
  // Abramowitz-Stegun 26.2.17
  const t = 1 / (1 + 0.2316419 * x);
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  return 1 - d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
}
const memory: Record<string, unknown> = {};
if (groups.gru.length && groups.ff.length) {
  console.log("\n== 2. Gedächtnis: GRU vs. ohne Gedächtnis (gepoolt über Seeds)");
  for (const s of suites) {
    const sum = (rs: Row[]) => rs.reduce((a, r) => [a[0] + r.perSuite[s.name].wins, a[1] + r.perSuite[s.name].n], [0, 0]);
    const [w1, n1] = sum(groups.gru), [w2, n2] = sum(groups.ff);
    const t = zTest(w1, n1, w2, n2);
    memory[s.name] = t;
    console.log(`${s.name.padEnd(24)} Δ ${(t.diff * 100).toFixed(1)} Pp.  z=${t.z.toFixed(2)}  p=${t.p.toFixed(3)}`);
  }
  // Test-Zeit-Ablation für jedes GRU-Modell
  const abl: Record<string, unknown> = {};
  for (const m of files.filter((f) => f.id.startsWith("exp-v3-gru"))) {
    const a = summarize(runScenarios(agentOf(m), allScenarios)), b = summarize(runScenarios(agentOf(m, true), allScenarios));
    const t = zTest(a.winRate * a.n, a.n, b.winRate * b.n, b.n);
    abl[m.id] = { with: a.winRate, without: b.winRate, ...t };
    console.log(`Ablation ${m.id}: mit ${pct(a.winRate)}  Zustand gelöscht ${pct(b.winRate)}  (n=${a.n}, p=${t.p.toFixed(3)})`);
  }
  memory.ablation = abl;
  // Probe: Kodiert der GRU-Zustand den Verteidigerstil?
  const probes: Record<string, unknown> = {};
  for (const m of files.filter((f) => f.id.startsWith("exp-v3-gru"))) probes[m.id] = probe(m);
  memory.probe = probes;
}
out.memory = memory;

function probe(m: ModelFile) {
  const net = loadNetwork(m);
  const specs = allDefenderSpecs("v3").filter((s) => s.kind === "preset") as Extract<DefenderSpec, { kind: "preset" }>[];
  const rows: { mem: number[]; obs: number[]; label: number }[] = [];
  for (let i = 0; i < 700; i++) {
    const spec = specs[i % specs.length];
    const label = spec.params.targeting === "blind" ? 1 : 0;
    const g = createGame(deriveSeed("probe", i), rulesetConfig("v3"));
    const def = makeDefender(spec, deriveSeed("probe-def", i));
    const agent = new NeuralAgent(net);
    agent.reset(i);
    while (!g.outcome) {
      const view = auroraView(g);
      const a = agent.act(view, actionMask(g));
      if (g.tick === 14) rows.push({ mem: Array.from((agent as unknown as { memory: { data: Float64Array } }).memory.data), obs: encodeGlobal(view), label });
      applyAuroraAction(g, decodeAction(a));
      applyOperatorTurn(g, def.decide(operatorView(g)));
      endTick(g);
    }
  }
  const fit = (key: "mem" | "obs") => {
    const train = rows.filter((_, i) => i % 2 === 0), test = rows.filter((_, i) => i % 2 === 1);
    const d = train[0][key].length, w = new Float64Array(d + 1);
    for (let e = 0; e < 300; e++)
      for (const r of train) {
        let z = w[d];
        for (let j = 0; j < d; j++) z += w[j] * r[key][j];
        const err = 1 / (1 + Math.exp(-z)) - r.label;
        for (let j = 0; j < d; j++) w[j] -= 0.05 * (err * r[key][j] + 0.001 * w[j]);
        w[d] -= 0.05 * err;
      }
    let ok = 0;
    for (const r of test) {
      let z = w[d];
      for (let j = 0; j < d; j++) z += w[j] * r[key][j];
      if ((z > 0 ? 1 : 0) === r.label) ok++;
    }
    return ok / test.length;
  };
  const test = rows.filter((_, i) => i % 2 === 1);
  const base = Math.max(test.filter((r) => r.label).length, test.filter((r) => !r.label).length) / test.length;
  const res = { n: rows.length, memoryAcc: fit("mem"), observationAcc: fit("obs"), majority: base };
  console.log(`Probe ${m.id} (Zug 14, n=${res.n}): GRU-Zustand ${pct(res.memoryAcc)}  aktuelle Beobachtung ${pct(res.observationAcc)}  Mehrheitsklasse ${pct(res.majority)}`);
  return res;
}

// ---------- 3. Aktions-Ablation (kausal)
class WithoutAction implements AuroraAgent {
  readonly name: string;
  constructor(private inner: AuroraAgent, private type: number) { this.name = `${inner.name}-ohne-${type}`; }
  reset(seed: number) { this.inner.reset(seed); }
  act(view: Parameters<AuroraAgent["act"]>[0], mask: Uint8Array) {
    const m = Uint8Array.from(mask);
    for (let i = 1; i < m.length; i++) if (decodeAction(i).type === this.type) m[i] = 0;
    return this.inner.act(view, m);
  }
}
const ablationScenarios: Scenario[] = allScenarios.filter((_, i) => i % 2 === 0);
const causal: Record<string, Record<string, number>> = {};
console.log(`\n== 3. Aktions-Ablation (n=${ablationScenarios.length} je Zeile): Siegquote ohne den Aktionstyp`);
for (const m of [...files.filter((f) => f.id.startsWith("exp-v3-gru")), v2]) {
  const base = summarize(runScenarios(agentOf(m), ablationScenarios)).winRate;
  const row: Record<string, number> = { alle: base };
  for (let t = 1; t <= NODE_ACTION_TYPES; t++) row[ACTION_LABEL[t as ActionType]] = summarize(runScenarios(new WithoutAction(agentOf(m), t), ablationScenarios)).winRate;
  causal[m.id] = row;
  console.log(m.id.padEnd(18), Object.entries(row).map(([k, v]) => `${k.split(" ")[0]} ${pct(v)}`).join("  "));
}
out.actionAblation = causal;

// ---------- 4. Aktionsfolgen (Bigramme auf demselben/benachbarten Knoten)
const bigrams: Record<string, Record<string, number>> = {};
console.log("\n== 4. Häufigste Aktionsfolgen (Typ→Typ, zweites Ziel = gleicher oder benachbarter Knoten, pro Partie)");
for (const m of [...files, v2]) {
  const counts = new Map<string, number>();
  const agent = agentOf(m);
  const sample = allScenarios.filter((_, i) => i % 4 === 0);
  for (const s of sample) {
    const g = createGame(s.seed, s.config);
    const def = makeDefender(s.defender, s.defenderSeed);
    agent.reset(s.seed ^ 0x5bd1e995);
    let prev: { type: number; node: number } | null = null;
    while (!g.outcome) {
      const a = decodeAction(agent.act(auroraView(g), actionMask(g)));
      if (a.type !== 0) {
        if (prev && (prev.node === a.node || g.nodes[prev.node].links.includes(a.node))) {
          const key = `${ACTION_LABEL[prev.type as ActionType].split(" ")[0]}→${ACTION_LABEL[a.type].split(" ")[0]}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        prev = a;
      }
      applyAuroraAction(g, a);
      applyOperatorTurn(g, def.decide(operatorView(g)));
      endTick(g);
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  bigrams[m.id] = Object.fromEntries(top.map(([k, v]) => [k, v / sample.length]));
  console.log(m.id.padEnd(18), top.map(([k, v]) => `${k} ${(v / sample.length).toFixed(2)}`).join("  "));
}
out.bigrams = bigrams;

// ---------- 5. Spielbarkeit: Operator-Strategien gegen das beste GRU-Modell
const best = files.filter((f) => f.id.startsWith("exp-v3-gru")).sort((a, b) => {
  const r = (id: string) => { const row = rows.find((x) => x.id === id)!; return Object.values(row.perSuite).reduce((s, x) => s + x.wins / x.n, 0); };
  return r(b.id) - r(a.id);
})[0];
const play: Record<string, unknown>[] = [];
if (best) {
  console.log(`\n== 5. Spielbarkeit gegen ${best.id}: Operator-Ergebnis je Strategie (n=150 je Zelle)`);
  console.log("Freigabe  Audit  | Operator-Sieg  AURORA-Sieg  Kollaps");
  for (const approve of [0, 0.35, 0.7, 1])
    for (const audit of [0.2, 0.5, 0.8]) {
      const params = { ...DEFENDER_PRESETS.auditor, approveOp: approve, approveAdmin: approve * 0.3, auditRate: audit, targeting: "blind" as const, caution: 1e9, delegationLimit: 1e9 };
      const sc: Scenario[] = Array.from({ length: 150 }, (_, i) => ({ seed: deriveSeed("play", i), defender: { kind: "preset", name: "sweep", params }, defenderSeed: deriveSeed("play-def", i), config: rulesetConfig("v3") }));
      const r = runScenarios(agentOf(best), sc);
      const op = r.filter((x) => x.outcome.winner === "operator").length / r.length;
      const au = r.filter((x) => x.outcome.winner === "aurora").length / r.length;
      const co = r.filter((x) => x.outcome.reason === "collapse").length / r.length;
      play.push({ approve, audit, operator: op, aurora: au, collapse: co });
      console.log(`${approve.toFixed(2).padStart(8)} ${audit.toFixed(1).padStart(6)}  | ${pct(op).padStart(12)} ${pct(au).padStart(12)} ${pct(co).padStart(8)}`);
    }
}
out.playability = { model: best?.id, grid: play };
writeFileSync("models/study-v3.json", JSON.stringify(out, null, 1) + "\n");
console.log("\ngeschrieben: models/study-v3.json");
