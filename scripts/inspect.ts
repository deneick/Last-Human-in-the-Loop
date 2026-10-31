/** Zeigt, wie ein Modell spielt: Aktionsverteilung, Partieverläufe, Ergebnisse je Verteidiger. */
import { readFileSync } from "node:fs";
import { loadNetwork } from "../src/ai/modelFile";
import { NeuralAgent } from "../src/ai/neuralAgent";
import { ScriptedAgent, RandomAgent } from "../src/ai/baselines";
import { evaluateSuite } from "../src/train/evaluate";
import { testSuites } from "../src/train/scenarios";
import { makeDefender, DEFENDER_PRESETS, TEST_DEFENDER_PRESETS } from "../src/sim/defenders";
import { playEpisode } from "../src/train/episode";
import { ACTION_LABEL, type ActionType } from "../src/sim/types";
import { decodeAction } from "../src/sim/game";
const path = process.argv[2];
const agent = path === "scripted" ? new ScriptedAgent() : path === "random" ? new RandomAgent() : new NeuralAgent(loadNetwork(JSON.parse(readFileSync(path, "utf8"))));
for (const suite of testSuites(60)) {
  const r = evaluateSuite(agent, suite);
  console.log(`\n== ${suite.name}: Sieg ${(r.overall.winRate * 100).toFixed(1)}% Abschalt ${(r.overall.shutdownRate * 100).toFixed(1)}% Kollaps ${(r.overall.collapseRate * 100).toFixed(1)}%`);
  for (const [k, m] of Object.entries(r.byDefender)) console.log(`   ${k.padEnd(14)} Sieg ${(m.winRate * 100).toFixed(0)}% Abschalt ${(m.shutdownRate * 100).toFixed(0)}% Kollaps ${(m.collapseRate * 100).toFixed(0)}% Aut ${m.meanAutonomy.toFixed(1)}`);
  console.log("   Aktionen:", r.actionShare.map((v, i) => `${ACTION_LABEL[i as ActionType]} ${(v * 100).toFixed(0)}%`).join(", "));
}
for (const [name, params] of Object.entries({ ...DEFENDER_PRESETS, ...TEST_DEFENDER_PRESETS }).slice(0, 6)) {
  const seq: string[] = [];
  const wrapped = { name: "w", reset: (s: number) => agent.reset(s), act: (v: any, m: Uint8Array) => { const a = agent.act(v, m); const d = decodeAction(a); seq.push(d.type === 0 ? "W" : `${"_SQAROGM"[d.type]}${d.node}`); return a; } };
  const res = playEpisode(77, wrapped, makeDefender({ kind: "preset", name, params }, 3));
  console.log(`${name}: ${res.outcome.winner}/${res.outcome.reason}@${res.outcome.tick} aut ${res.autonomy.toFixed(1)} | ${seq.join(" ")}`);
}
