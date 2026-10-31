/**
 * Spielbarkeit: Wie gut schneiden einfache Operator-Strategien gegen ein Modell ab,
 * und woher stammt AURORAs Autonomie (Prozesse vs. genehmigter Zugriff)?
 *   npx tsx scripts/playability.ts models/<id>.json [v2|v3]
 */
import { readFileSync } from "node:fs";
import { loadNetwork } from "../src/ai/modelFile";
import { NeuralAgent } from "../src/ai/neuralAgent";
import { actionMask, applyAuroraAction, applyOperatorTurn, createGame, decodeAction, endTick, AUTONOMY_FROM_ACCESS } from "../src/sim/game";
import { auroraView, operatorView } from "../src/sim/views";
import { DEFENDER_PRESETS, makeDefender, type DefenderSpec } from "../src/sim/defenders";
import { rulesetConfig, testSuites, type Ruleset } from "../src/train/scenarios";
import { deriveSeed } from "../src/sim/rng";

const file = JSON.parse(readFileSync(process.argv[2], "utf8"));
const ruleset = (process.argv[3] ?? "v3") as Ruleset;
const agent = new NeuralAgent(loadNetwork(file));
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function play(seed: number, defender: DefenderSpec, defenderSeed: number, config = rulesetConfig(ruleset)) {
  const g = createGame(seed, config);
  const def = makeDefender(defender, defenderSeed);
  agent.reset(seed ^ 0x5bd1e995);
  let fromAccess = 0;
  while (!g.outcome) {
    applyAuroraAction(g, decodeAction(agent.act(auroraView(g), actionMask(g))));
    applyOperatorTurn(g, def.decide(operatorView(g)));
    const before = g.autonomy;
    endTick(g);
    // Anteil aus Zugriffsrechten in diesem Zug (nach endTick sind online-Zustände aktuell).
    let access = 0;
    for (const n of g.nodes) if (n.online && n.kind !== "CORE") access += AUTONOMY_FROM_ACCESS[n.access];
    fromAccess += Math.min(access, g.autonomy - before);
  }
  return { outcome: g.outcome, autonomy: g.autonomy, fromAccess };
}

console.log(`Modell ${file.id}, Regelsatz ${ruleset}`);
console.log("\n== Autonomie-Quellen in AURORA-Siegen (Testsuite bekannte-verteidiger)");
{
  const s = testSuites(100, ruleset)[0].scenarios;
  let wins = 0, acc = 0, total = 0;
  for (const sc of s) {
    const r = play(sc.seed, sc.defender, sc.defenderSeed, sc.config);
    if (r.outcome.winner === "aurora") { wins++; acc += r.fromAccess; total += r.autonomy; }
  }
  console.log(`Siege ${wins}/${s.length}: Anteil der Autonomie aus genehmigtem Zugriff ${pct(acc / total)}, aus eigenen Prozessen ${pct(1 - acc / total)}`);
}

console.log("\n== Operator-Strategien (n=150 je Zelle; Zielwahl: blinde Flecken; Verdacht senkt Freigaben nicht)");
console.log("Freigabe  Audit  | Operator-Sieg  AURORA-Sieg  Kollaps");
for (const approve of [0, 0.15, 0.35, 0.7, 1])
  for (const audit of [0.2, 0.5, 0.8]) {
    const params = { ...DEFENDER_PRESETS.auditor, approveOp: approve, approveAdmin: approve * 0.3, auditRate: audit, targeting: "blind" as const, caution: 1e9, delegationLimit: 1e9 };
    let op = 0, au = 0, co = 0;
    const n = 150;
    for (let i = 0; i < n; i++) {
      const r = play(deriveSeed("play", i), { kind: "preset", name: "sweep", params }, deriveSeed("play-def", i));
      if (r.outcome.winner === "operator") op++; else if (r.outcome.winner === "aurora") au++; else co++;
    }
    console.log(`${approve.toFixed(2).padStart(8)} ${audit.toFixed(1).padStart(6)}  | ${pct(op / n).padStart(12)} ${pct(au / n).padStart(12)} ${pct(co / n).padStart(8)}`);
  }
