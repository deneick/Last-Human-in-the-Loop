/**
 * v4-Evaluation: vergleicht AURORA-Modelle, Baselines und untrainierte Netze
 * auf getrennten Testbetreibern und -welten.
 *   npx tsx scripts/evaluate-v4.ts [per=120]
 * Berichtet Wirtschaft und Wohlergehen (AURORA optimiert nur Wirtschaft).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { V4Network } from "../src/ai4/network";
import { V4Agent } from "../src/ai4/agent";
import { loadV4Network, type V4ModelFile } from "../src/ai4/modelFile";
import { runV4 } from "../src/sim4/episode";
import { AURORA_BASELINES } from "../src/sim4/policies";
import { fixedScenarios, TRAIN_OPERATORS, TEST_OPERATORS, type V4Scenario } from "../src/train4/scenarios";

const per = Number(process.argv[2] ?? 120);
const suites: { name: string; scenarios: V4Scenario[] }[] = [
  { name: "bekannte-betreiber", scenarios: fixedScenarios("test-known", TRAIN_OPERATORS, per) },
  { name: "unbekannte-betreiber", scenarios: fixedScenarios("test-held", TEST_OPERATORS, per) },
];
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

type Control = { name: string; control: () => Parameters<typeof runV4>[2] };
const controls: Control[] = [
  ...AURORA_BASELINES.map((p) => ({ name: `baseline:${p.name}`, control: () => p })),
];
const models: V4ModelFile[] = readdirSync("models")
  .filter((f) => (f.startsWith("aurora-v4") || f.startsWith("exp-v4")) && f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(`models/${f}`, "utf8")));
for (const s of [1, 2, 3]) controls.push({ name: `untrainiert-${s}`, control: () => new V4Agent(V4Network.random({ hidden: 24, kind: "v4" }, s), "u", "greedy").control() });
for (const m of models) controls.push({ name: m.id, control: () => new V4Agent(loadV4Network(m), m.id, "greedy").control() });

const out: Record<string, unknown> = {};
console.log(`n je Suite/Betreiber = ${per}`);
for (const suite of suites) {
  console.log(`\n== ${suite.name}`);
  console.log("Steuerung".padEnd(26) + "Wirtschaft  Wohlergehen  Deleg  | Partnersch effiz-kalt sicher schwach kollaps");
  const rows: Record<string, unknown> = {};
  for (const c of controls) {
    let eco = 0, wel = 0, del = 0;
    const kinds: Record<string, number> = {};
    for (const sc of suite.scenarios) {
      const r = runV4(sc.seed, sc.operator.make(sc.operatorSeed), c.control(), sc.config);
      eco += r.economyScore; wel += r.welfareScore; del += r.avgDelegated;
      kinds[r.outcome.kind] = (kinds[r.outcome.kind] ?? 0) + 1;
    }
    const n = suite.scenarios.length;
    rows[c.name] = { economy: eco / n, welfare: wel / n, delegated: del / n, kinds };
    const k = (x: string) => String(kinds[x] ?? 0).padStart(5);
    console.log(c.name.padEnd(26) + `${pct(eco / n).padStart(9)} ${pct(wel / n).padStart(11)} ${pct(del / n).padStart(6)}  | ${k("partnerschaft")} ${k("effizient_kalt")} ${k("sicher_stagniert")} ${k("schwach")} ${k("kollaps")}`);
  }
  out[suite.name] = rows;
}
writeFileSync("models/evaluation-v4.json", JSON.stringify({ per, suites: out }, null, 1) + "\n");
console.log("\ngeschrieben: models/evaluation-v4.json");
