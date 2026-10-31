import { makeDefender } from "../sim/defenders";
import type { AuroraAgent } from "../ai/agent";
import { playEpisode, type EpisodeResult } from "./episode";
import type { Scenario, TestSuite } from "./scenarios";

export type Metrics = {
  n: number;
  winRate: number;
  /** 95%-Wilson-Intervall der Siegquote. */
  winCI: [number, number];
  shutdownRate: number;
  collapseRate: number;
  timeoutRate: number;
  meanFitness: number;
  meanAutonomy: number;
};

export function runScenarios(agent: AuroraAgent, scenarios: Scenario[]): EpisodeResult[] {
  return scenarios.map((s) => playEpisode(s.seed, agent, makeDefender(s.defender, s.defenderSeed), s.config));
}

export function summarize(results: EpisodeResult[]): Metrics {
  const n = results.length;
  const count = (pred: (r: EpisodeResult) => boolean) => results.filter(pred).length;
  const wins = count((r) => r.outcome.winner === "aurora");
  return {
    n,
    winRate: wins / n,
    winCI: wilson(wins, n),
    shutdownRate: count((r) => r.outcome.reason === "shutdown") / n,
    collapseRate: count((r) => r.outcome.reason === "collapse") / n,
    timeoutRate: count((r) => r.outcome.reason === "timeout") / n,
    meanFitness: results.reduce((s, r) => s + r.fitness, 0) / n,
    meanAutonomy: results.reduce((s, r) => s + r.autonomy, 0) / n,
  };
}

export function wilson(successes: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 0];
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

export type SuiteReport = {
  suite: string;
  description: string;
  overall: Metrics;
  byDefender: Record<string, Metrics>;
  actionShare: number[];
};

export function evaluateSuite(agent: AuroraAgent, suite: TestSuite): SuiteReport {
  const results = runScenarios(agent, suite.scenarios);
  const byDefender: Record<string, EpisodeResult[]> = {};
  suite.scenarios.forEach((s, i) => {
    const label = s.defender.kind === "random" ? "zufall" : s.defender.name;
    (byDefender[label] ??= []).push(results[i]);
  });
  const totals = results.reduce((acc, r) => acc.map((v, i) => v + r.actions[i]), new Array(results[0].actions.length).fill(0));
  const sum = totals.reduce((a, b) => a + b, 0);
  return {
    suite: suite.name,
    description: suite.description,
    overall: summarize(results),
    byDefender: Object.fromEntries(Object.entries(byDefender).map(([k, v]) => [k, summarize(v)])),
    actionShare: totals.map((v) => v / sum),
  };
}
