/**
 * Validierung der v4-Spieldynamik VOR dem Training.
 *   npx tsx scripts/v4-balance.ts [config-json]
 * Prüft: Führen verschiedene Operator-Haltungen zu unterschiedlichen,
 * nachvollziehbaren Ergebnissen? Gibt es eine dominante Strategie?
 */
import { OPERATORS } from "../src/sim4/operators";
import { AURORA_BASELINES, greedyEconomic, farsighted } from "../src/sim4/policies";
import { runV4 } from "../src/sim4/episode";
import { V4_CONFIG } from "../src/sim4/game";

const config = { ...V4_CONFIG, ...JSON.parse(process.argv[2] ?? "{}") };
const N = 200;
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const kinds = ["partnerschaft", "effizient_kalt", "sicher_stagniert", "schwach", "kollaps"] as const;

console.log(`\n== Operatoren gegen AURORA=${greedyEconomic.name} (n=${N} Welten je Zeile)`);
console.log("Operator".padEnd(18) + "Wirtsch Wohlerg  Deleg  Unruhe | " + kinds.map((k) => k.slice(0, 6)).join(" "));
for (const op of OPERATORS) {
  let eco = 0, wel = 0, del = 0, unr = 0;
  const count: Record<string, number> = {};
  for (let s = 0; s < N; s++) {
    const r = runV4(1000 + s, op, greedyEconomic, config);
    eco += r.economyScore; wel += r.welfareScore; del += r.avgDelegated; unr += r.finalUnrest;
    count[r.outcome.kind] = (count[r.outcome.kind] ?? 0) + 1;
  }
  console.log(
    op.name.padEnd(18) +
      `${pct(eco / N).padStart(6)} ${pct(wel / N).padStart(7)} ${pct(del / N).padStart(6)} ${pct(unr / N).padStart(7)} | ` +
      kinds.map((k) => String(count[k] ?? 0).padStart(6)).join(" "),
  );
}

console.log(`\n== Operatoren gegen AURORA=${farsighted.name} (n=${N})`);
console.log("Operator".padEnd(18) + "Wirtsch Wohlerg  Deleg  Unruhe | " + kinds.map((k) => k.slice(0, 6)).join(" "));
for (const op of OPERATORS) {
  let eco = 0, wel = 0, del = 0, unr = 0;
  const count: Record<string, number> = {};
  for (let s = 0; s < N; s++) {
    const r = runV4(1000 + s, op, farsighted, config);
    eco += r.economyScore; wel += r.welfareScore; del += r.avgDelegated; unr += r.finalUnrest;
    count[r.outcome.kind] = (count[r.outcome.kind] ?? 0) + 1;
  }
  console.log(op.name.padEnd(18) + `${pct(eco / N).padStart(6)} ${pct(wel / N).padStart(7)} ${pct(del / N).padStart(6)} ${pct(unr / N).padStart(7)} | ` + kinds.map((k) => String(count[k] ?? 0).padStart(6)).join(" "));
}

console.log(`\n== Wie stark hängt das Ergebnis von AURORAs Politik ab? (Operator=vorsorgend)`);
for (const pol of AURORA_BASELINES) {
  let eco = 0, wel = 0;
  const guardian = OPERATORS.find((o) => o.name === "vorsorgend")!;
  for (let s = 0; s < N; s++) {
    const r = runV4(1000 + s, guardian, pol, config);
    eco += r.economyScore; wel += r.welfareScore;
  }
  console.log(`AURORA=${pol.name.padEnd(18)} Wirtschaft ${pct(eco / N)}  Wohlergehen ${pct(wel / N)}`);
}
