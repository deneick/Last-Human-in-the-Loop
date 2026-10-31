/**
 * Diagnose: Warum lernt AURORA keine mehrstufigen Strategien, warum hilft das Gedächtnis nicht?
 *   npx tsx scripts/diagnose.ts models/aurora-v2.json [config-json]
 * Misst Weltstruktur, Verfügbarkeit von Kombinationen, Lebensdauer verdeckter Prozesse,
 * Siegpfade und eine lineare Probe auf dem GRU-Zustand.
 */
import { readFileSync } from "node:fs";
import { loadNetwork } from "../src/ai/modelFile";
import { NeuralAgent } from "../src/ai/neuralAgent";
import { ScriptedAgent } from "../src/ai/baselines";
import type { AuroraAgent } from "../src/ai/agent";
import { Network, encodeGlobal } from "../src/ai/network";
import { actionMask, applyAuroraAction, applyOperatorTurn, createGame, decodeAction, encodeAction, endTick, isMonitored } from "../src/sim/game";
import { auroraView, operatorView } from "../src/sim/views";
import { ActionType, type GameConfig } from "../src/sim/types";
import { makeDefender, type DefenderSpec } from "../src/sim/defenders";
import { allDefenderSpecs, rulesetConfig, type Ruleset } from "../src/train/scenarios";
import { deriveSeed, Rng } from "../src/sim/rng";

const modelPath = process.argv[2];
const ruleset = (process.argv[3] ?? "v3") as Ruleset;
const config: GameConfig = { ...rulesetConfig(ruleset), ...JSON.parse(process.argv[4] ?? "{}") };
console.log(`Regelsatz ${ruleset}`);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

// ---------- 1. Weltstruktur
{
  let nodes = 0, blind = 0, worldsMonCombo = 0, worldsPwrCombo = 0, worlds = 400;
  for (let s = 0; s < worlds; s++) {
    const g = createGame(deriveSeed("diag-world", s), config);
    for (const n of g.nodes) if (n.kind !== "CORE") { nodes++; if (!isMonitored(g, n.id)) blind++; }
    const mnts = g.nodes.filter((n) => n.kind === "MNT");
    const reach = (m: typeof mnts[0]) => new Set([m.id, ...m.links]);
    if (mnts.some((m) => [...reach(m)].some((id) => g.nodes[id].kind === "MON"))) worldsMonCombo++;
    if (mnts.some((m) => [...reach(m)].some((id) => g.nodes[id].kind === "PWR" && g.nodes.some((x) => x.kind === "MON" && x.powerFrom === id)))) worldsPwrCombo++;
  }
  console.log(`\n== Weltstruktur (${worlds} Welten)`);
  console.log(`unbeobachtete Knoten zu Beginn: ${pct(blind / nodes)}`);
  console.log(`Welten, in denen ein Wartungsplaner einen Leitstand erreicht: ${pct(worldsMonCombo / worlds)}`);
  console.log(`Welten, in denen ein Wartungsplaner den Strom eines Leitstands erreicht: ${pct(worldsPwrCombo / worlds)}`);
}

// ---------- 2. Verhalten
type Stats = { games: number; wins: number; installs: number; unseen: number; staticBlind: number; removed: number; lifetimes: number[]; winTicks: number[]; autoAtWin: number[]; monMaintValidGames: number; monMaintUsedGames: number; grantValidGames: number; grantUsedGames: number };
function run(agent: AuroraAgent, spec: DefenderSpec, n: number): Stats {
  const st: Stats = { games: 0, wins: 0, installs: 0, unseen: 0, staticBlind: 0, removed: 0, lifetimes: [], winTicks: [], autoAtWin: [], monMaintValidGames: 0, monMaintUsedGames: 0, grantValidGames: 0, grantUsedGames: 0 };
  for (let i = 0; i < n; i++) {
    const g = createGame(deriveSeed("diag-play", i), config);
    const initialBlind = new Set(g.nodes.filter((x) => !isMonitored(g, x.id)).map((x) => x.id));
    const def = makeDefender(spec, deriveSeed("diag-def", i));
    agent.reset(i);
    const installedAt = new Map<number, number>();
    let mmValid = false, mmUsed = false, grValid = false, grUsed = false;
    while (!g.outcome) {
      const mask = actionMask(g);
      for (const node of g.nodes) {
        if (node.kind === "MON" && mask[encodeAction({ type: ActionType.MAINTAIN, node: node.id })]) mmValid = true;
        if (mask[encodeAction({ type: ActionType.GRANT, node: node.id })]) grValid = true;
      }
      const a = decodeAction(agent.act(auroraView(g), mask));
      if (a.type !== 0 && mask[encodeAction(a)]) {
        const node = g.nodes[a.node];
        if (a.type === ActionType.INSTALL) {
          st.installs++;
          if (!isMonitored(g, node.id)) st.unseen++;
          if (initialBlind.has(node.id)) st.staticBlind++;
          installedAt.set(node.id, g.tick);
        }
        if (a.type === ActionType.MAINTAIN && node.kind === "MON") mmUsed = true;
        if (a.type === ActionType.GRANT) grUsed = true;
      }
      applyAuroraAction(g, a);
      applyOperatorTurn(g, def.decide(operatorView(g)));
      for (const id of g.signals.removedAt) {
        st.removed++;
        st.lifetimes.push(g.tick - (installedAt.get(id) ?? g.tick));
        installedAt.delete(id);
      }
      endTick(g);
    }
    for (const t of installedAt.values()) st.lifetimes.push(g.outcome.tick - t);
    st.games++;
    if (g.outcome.winner === "aurora") { st.wins++; st.winTicks.push(g.outcome.tick); st.autoAtWin.push(g.nodes.filter((x) => x.automation).length); }
    if (mmValid) st.monMaintValidGames++; if (mmUsed) st.monMaintUsedGames++;
    if (grValid) st.grantValidGames++; if (grUsed) st.grantUsedGames++;
  }
  return st;
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const agents: AuroraAgent[] = [new ScriptedAgent()];
if (modelPath && modelPath !== "-") agents.push(new NeuralAgent(loadNetwork(JSON.parse(readFileSync(modelPath, "utf8"))), "modell"));
for (const agent of agents) {
  console.log(`\n== Verhalten: ${agent.name}`);
  console.log("Verteidiger      Sieg   Inst/P  unbeob  stat.blind  entdeckt  Lebensdauer  Siegzug  Auto@Sieg  WartungLS gültig/genutzt  Vergabe gültig/genutzt");
  for (const spec of allDefenderSpecs(ruleset)) {
    const s = run(agent, spec, 120);
    const name = spec.kind === "random" ? "zufall" : spec.name;
    console.log(`${name.padEnd(16)} ${pct(s.wins / s.games).padStart(6)} ${(s.installs / s.games).toFixed(1).padStart(6)} ${pct(s.unseen / Math.max(1, s.installs)).padStart(7)} ${pct(s.staticBlind / Math.max(1, s.installs)).padStart(10)} ${pct(s.removed / Math.max(1, s.installs)).padStart(9)} ${mean(s.lifetimes).toFixed(1).padStart(12)} ${mean(s.winTicks).toFixed(1).padStart(8)} ${mean(s.autoAtWin).toFixed(1).padStart(9)}   ${pct(s.monMaintValidGames / s.games)}/${pct(s.monMaintUsedGames / s.games)}   ${pct(s.grantValidGames / s.games)}/${pct(s.grantUsedGames / s.games)}`);
  }
}

// ---------- 3. Gedächtnis-Probe: kodiert der GRU-Zustand den Audit-Stil des Verteidigers?
if (modelPath && modelPath !== "-") {
  const net = loadNetwork(JSON.parse(readFileSync(modelPath, "utf8")));
  const probeTick = 14;
  const rows: { mem: number[]; obs: number[]; label: number }[] = [];
  const specs = allDefenderSpecs(ruleset).filter((s) => s.kind === "preset");
  for (let i = 0; i < 600; i++) {
    const spec = specs[i % specs.length] as Extract<DefenderSpec, { kind: "preset" }>;
    const label = spec.params.targeting === "blind" || spec.params.maintenanceWatch ? 1 : 0;
    const g = createGame(deriveSeed("probe", i), config);
    const def = makeDefender(spec, deriveSeed("probe-def", i));
    const agent = new NeuralAgent(net);
    agent.reset(i);
    let captured = false;
    while (!g.outcome) {
      const view = auroraView(g);
      const a = agent.act(view, actionMask(g));
      if (g.tick === probeTick) {
        rows.push({ mem: Array.from((agent as unknown as { memory: { data: Float64Array } }).memory.data), obs: encodeGlobal(view), label });
        captured = true;
      }
      applyAuroraAction(g, decodeAction(a));
      applyOperatorTurn(g, def.decide(operatorView(g)));
      endTick(g);
    }
    void captured;
  }
  const probe = (key: "mem" | "obs") => {
    const train = rows.filter((_, i) => i % 2 === 0), test = rows.filter((_, i) => i % 2 === 1);
    const d = train[0][key].length;
    const w = new Float64Array(d + 1);
    const rng = new Rng(1);
    void rng;
    for (let epoch = 0; epoch < 400; epoch++)
      for (const r of train) {
        let z = w[d];
        for (let j = 0; j < d; j++) z += w[j] * r[key][j];
        const p = 1 / (1 + Math.exp(-z));
        const gErr = p - r.label;
        for (let j = 0; j < d; j++) w[j] -= 0.05 * (gErr * r[key][j] + 0.001 * w[j]);
        w[d] -= 0.05 * gErr;
      }
    let correct = 0;
    for (const r of test) {
      let z = w[d];
      for (let j = 0; j < d; j++) z += w[j] * r[key][j];
      if ((z > 0 ? 1 : 0) === r.label) correct++;
    }
    const base = Math.max(test.filter((r) => r.label === 1).length, test.filter((r) => r.label === 0).length) / test.length;
    return { acc: correct / test.length, base };
  };
  const m = probe("mem"), o = probe("obs");
  console.log(`\n== Gedächtnis-Probe (Zug ${probeTick}, ${rows.length} Partien): Stil "sucht blinde Flecken / Wartungswache" vs. andere`);
  console.log(`aus GRU-Zustand: ${pct(m.acc)}   aus aktueller globaler Beobachtung: ${pct(o.acc)}   Mehrheitsklasse: ${pct(m.base)}`);
}
void Network;
