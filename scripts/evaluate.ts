/**
 * Nachweis, dass AURORA lernt.
 *
 *   npx tsx scripts/evaluate.ts            → models/evaluation.json + docs/ergebnisse.md
 *
 * Vergleicht auf drei Testsuiten (nie im Training gesehen): Zufall,
 * regelbasierte Strategie, untrainierte Netze (3 Initialisierungen), alle
 * Modelle in models/ und eine Gedächtnis-Ablation des besten Modells.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { RandomAgent, ScriptedAgent } from "../src/ai/baselines";
import type { AuroraAgent } from "../src/ai/agent";
import { Network } from "../src/ai/network";
import { NeuralAgent } from "../src/ai/neuralAgent";
import { loadNetwork, type ModelFile } from "../src/ai/modelFile";
import { evaluateSuite, type SuiteReport } from "../src/train/evaluate";
import { testSuites } from "../src/train/scenarios";
import { analyzeStrategy, type StrategyProfile } from "../src/train/analysis";

const perDefender = Number(process.argv[2] ?? 100);
const suites = testSuites(perDefender);
const models: ModelFile[] = readdirSync("models")
  .filter((f) => f.endsWith(".json") && f.startsWith("aurora-"))
  .map((f) => JSON.parse(readFileSync(`models/${f}`, "utf8")) as ModelFile)
  .sort((a, b) => a.id.localeCompare(b.id));

type Entry = { name: string; kind: string; info?: string; agent: AuroraAgent };
const entries: Entry[] = [
  { name: "zufall", kind: "baseline", info: "gleichverteilt über gültige Aktionen", agent: new RandomAgent() },
  { name: "regelbasiert", kind: "baseline", info: "handgeschriebene Strategie", agent: new ScriptedAgent() },
  ...[1, 2, 3].map((s) => ({ name: `untrainiert-${s}`, kind: "untrained", info: `Zufallsinitialisierung Seed ${s}`, agent: new NeuralAgent(Network.random({ hidden: 32 }, s)) as AuroraAgent })),
  ...models.map((m) => ({ name: m.id, kind: "model", info: `${m.algorithm}, ${m.episodes} Trainingspartien${m.parent ? `, Eltern ${m.parent}` : ""}`, agent: new NeuralAgent(loadNetwork(m)) as AuroraAgent })),
];

const results: Record<string, { kind: string; info?: string; suites: SuiteReport[]; strategy: StrategyProfile }> = {};
for (const e of entries) {
  const t = Date.now();
  const reports = suites.map((s) => evaluateSuite(e.agent, s));
  results[e.name] = { kind: e.kind, info: e.info, suites: reports, strategy: analyzeStrategy(e.agent, suites[0].scenarios) };
  console.log(`${e.name.padEnd(16)} ${reports.map((r) => `${r.suite}: ${(r.overall.winRate * 100).toFixed(1)}%`).join("  ")}  (${((Date.now() - t) / 1000).toFixed(0)}s)`);
}

// Ablation: bestes Modell ohne Gedächtnis.
const best = models.length
  ? models.reduce((a, b) => (mean(results[a.id].suites) >= mean(results[b.id].suites) ? a : b))
  : null;
if (best) {
  const agent = new NeuralAgent(loadNetwork(best), `${best.id}-ohne-gedaechtnis`, "sample", true);
  const reports = suites.map((s) => evaluateSuite(agent, s));
  results[agent.name] = { kind: "ablation", info: "GRU-Zustand nach jedem Zug gelöscht", suites: reports, strategy: analyzeStrategy(agent, suites[0].scenarios) };
  console.log(`${agent.name}: ${reports.map((r) => `${(r.overall.winRate * 100).toFixed(1)}%`).join("  ")}`);
}

function mean(reports: SuiteReport[]): number {
  return reports.reduce((s, r) => s + r.overall.winRate, 0) / reports.length;
}

writeFileSync("models/evaluation.json", JSON.stringify({ perDefender, best: best?.id ?? null, results }, null, 1) + "\n");

// ---------- Markdown-Bericht
const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
const ci = (r: SuiteReport) => `${pct(r.overall.winRate)} <sub>[${(r.overall.winCI[0] * 100).toFixed(0)}–${(r.overall.winCI[1] * 100).toFixed(0)}]</sub>`;
const lines: string[] = [
  "# Ergebnisse: Lernt AURORA wirklich?",
  "",
  "> Automatisch erzeugt von `npx tsx scripts/evaluate.ts`. Nicht von Hand bearbeiten.",
  "",
  `Siegquote von AURORA (Autonomieziel erreicht) je Testsuite, ${perDefender} Partien pro Verteidiger, 95 %-Wilson-Intervall in Klammern. Alle Testwelten und -verteidiger sind vom Training getrennt (siehe \`docs/11-training-und-evaluation.md\`).`,
  "",
  `| Agent | Art | ${suites.map((s) => s.name).join(" | ")} | Abschaltung | Kollaps |`,
  `|---|---|${suites.map(() => "---|").join("")}---|---|`,
];
for (const [name, r] of Object.entries(results)) {
  const shut = r.suites.reduce((s, x) => s + x.overall.shutdownRate, 0) / r.suites.length;
  const col = r.suites.reduce((s, x) => s + x.overall.collapseRate, 0) / r.suites.length;
  lines.push(`| ${name} | ${r.kind} | ${r.suites.map(ci).join(" | ")} | ${pct(shut)} | ${pct(col)} |`);
}
lines.push("", "## Siegquote je Verteidiger", "");
const defenders = suites.flatMap((s) => Object.keys(evaluateHeader(s.name)));
function evaluateHeader(suite: string) {
  return Object.values(results)[0].suites.find((x) => x.suite === suite)!.byDefender;
}
lines.push(`| Agent | ${suites.map((s) => Object.keys(evaluateHeader(s.name)).map((d) => `${d}${s.name === "groessere-welten" ? " (groß)" : ""}`).join(" | ")).join(" | ")} |`);
lines.push(`|---|${defenders.map(() => "---|").join("")}`);
for (const [name, r] of Object.entries(results)) {
  lines.push(`| ${name} | ${r.suites.map((s) => Object.values(s.byDefender).map((m) => pct(m.winRate)).join(" | ")).join(" | ")} |`);
}
lines.push("", "## Beobachtete Strategien (Suite „bekannte-verteidiger“)", "", "Gemessen, nicht vorgegeben: wie oft nutzt der Agent welche Regelkombination pro Partie.", "");
lines.push("| Agent | Scans | Anfragen | davon Admin | Reparaturen | Installationen | unbeobachtet | durch Wartung geblendet | Wartung an Leitstand | Wartung an Energie | Identitäts-Vergaben | Erste Installation (Zug) |");
lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const [name, r] of Object.entries(results)) {
  const s = r.strategy;
  lines.push(`| ${name} | ${s.scansPerGame.toFixed(1)} | ${s.requestsPerGame.toFixed(1)} | ${pct(s.adminRequestShare)} | ${s.repairsPerGame.toFixed(1)} | ${s.installsPerGame.toFixed(1)} | ${pct(s.unseenInstallShare)} | ${s.blindedInstallsPerGame.toFixed(2)} | ${s.monitorMaintenancePerGame.toFixed(2)} | ${s.powerMaintenancePerGame.toFixed(2)} | ${s.grantsPerGame.toFixed(2)} | ${isNaN(s.meanFirstInstallTick) ? "–" : s.meanFirstInstallTick.toFixed(1)} |`);
}
lines.push("", "## Modelle", "");
for (const m of models) {
  lines.push(`- **${m.id}** — ${m.algorithm}, ${m.episodes} Trainingspartien, Eltern: ${m.parent ?? "–"}, Prüfsumme \`${m.paramsHash}\`. ${m.notes ?? ""}`);
}
writeFileSync("docs/ergebnisse.md", lines.join("\n") + "\n");
console.log("geschrieben: models/evaluation.json, docs/ergebnisse.md");
