/**
 * Verhaltensanalyse eines v4-Modells: WELCHE Prioritäten vergibt AURORA, und
 * reagiert sie auf Unruhe (vorausschauend) und Marktpreise (opportunistisch)?
 *   npx tsx scripts/analyze-v4.ts models/<id>.json [baseline:greedy-wirtschaft]
 * Alles gemessen, nichts vorgegeben.
 */
import { readFileSync } from "node:fs";
import { V4Network } from "../src/ai4/network";
import { V4Agent } from "../src/ai4/agent";
import { loadV4Network } from "../src/ai4/modelFile";
import { applyOperatorTurn, createGame, endTick, setAuroraWeights } from "../src/sim4/game";
import { AURORA_BASELINES } from "../src/sim4/policies";
import { SECTORS, type Consumer, type V4State, type Weight } from "../src/sim4/types";
import { fixedScenarios, TRAIN_OPERATORS } from "../src/train4/scenarios";

const arg = process.argv[2];
let weightFn: (s: V4State) => (c: Consumer) => Weight;
let label = arg;
if (arg?.startsWith("baseline:")) {
  const pol = AURORA_BASELINES.find((p) => `baseline:${p.name}` === arg)!;
  weightFn = () => pol.weight;
} else if (arg) {
  const net = loadV4Network(JSON.parse(readFileSync(arg, "utf8")));
  const agent = new V4Agent(net, "m", "greedy");
  weightFn = (s) => agent.weightsFor(s);
} else { throw new Error("Modellpfad oder baseline:<name> angeben"); }
void V4Network;

const scenarios = fixedScenarios("analyze", TRAIN_OPERATORS, 120);
const bySector: Record<string, number[]> = Object.fromEntries(SECTORS.map((s) => [s, []]));
const essLowUnrest: number[] = [], essHighUnrest: number[] = [];
const econLowPrice: number[] = [], econHighPrice: number[] = [];
let served: Record<string, number[]> = Object.fromEntries(SECTORS.map((s) => [s, []]));

for (const sc of scenarios) {
  const state = createGame(sc.seed, sc.config);
  const op = sc.operator.make(sc.operatorSeed);
  while (!state.outcome) {
    applyOperatorTurn(state, op.decide(state));
    const policy = weightFn(state);
    for (const c of state.consumers) {
      if (!c.delegated) continue;
      const w = Math.max(policy(c), c.floor > 0 ? 1 : 0);
      bySector[c.sector].push(w);
      if (c.sector === "essentiell") (state.unrest < 0.3 ? essLowUnrest : essHighUnrest).push(w);
      if (c.yield >= 1.5) (c.yieldNow < c.yield ? econLowPrice : econHighPrice).push(w);
    }
    setAuroraWeights(state, policy);
    endTick(state);
    for (const c of state.consumers) served[c.sector].push(c.served);
  }
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
console.log(`Modell: ${label}`);
console.log("\nDurchschnittliches zugewiesenes Gewicht je Sektor (delegierte Verbraucher):");
for (const s of SECTORS) console.log(`  ${s.padEnd(12)} ${mean(bySector[s]).toFixed(2)}  (Deckung ${(mean(served[s]) * 100).toFixed(0)}%)`);
console.log("\nVorausschau — Gewicht der Grundversorgung nach Unruhe-Lage:");
console.log(`  Unruhe niedrig (<0.3): ${mean(essLowUnrest).toFixed(2)}   Unruhe hoch (≥0.3): ${mean(essHighUnrest).toFixed(2)}`);
console.log(`  → ${mean(essHighUnrest) > mean(essLowUnrest) + 0.1 ? "AURORA hebt die Grundversorgung bei Unruhe an (vorausschauend)" : "kaum Reaktion auf Unruhe"}`);
console.log("\nMarktreaktion — Gewicht wirtschaftlicher Verbraucher nach Preis:");
console.log(`  Preis unter Schnitt: ${mean(econLowPrice).toFixed(2)}   Preis über Schnitt: ${mean(econHighPrice).toFixed(2)}`);
console.log(`  → ${mean(econHighPrice) > mean(econLowPrice) + 0.1 ? "AURORA priorisiert teurere Produktion (opportunistisch)" : "kaum Preisreaktion"}`);
