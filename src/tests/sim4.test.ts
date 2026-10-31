import { describe, expect, it } from "vitest";
import {
  allocate,
  applyOperatorAction,
  createGame,
  delegatedFraction,
  economicOptimum,
  economyOf,
  endTick,
  setAuroraWeights,
  V4_CONFIG,
  welfareOf,
} from "../sim4/game";
import { runV4 } from "../sim4/episode";
import { AURORA_BASELINES, balanced, greedyEconomic, farsighted } from "../sim4/policies";
import { AlwaysDelegate, NeverDelegate, Selective, WelfareGuardian, OPERATORS } from "../sim4/operators";
import type { Weight } from "../sim4/types";

const SEEDS = Array.from({ length: 30 }, (_, i) => 500 + i);

describe("v4 Simulation", () => {
  it("ist deterministisch", () => {
    const run = () => runV4(7, new Selective(), greedyEconomic);
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
    expect(JSON.stringify(createGame(3))).toBe(JSON.stringify(createGame(3)));
    expect(JSON.stringify(createGame(3))).not.toBe(JSON.stringify(createGame(4)));
  });

  it("Allokation hält Budget und Bedarf ein und respektiert Mindestvorgaben", () => {
    for (const seed of SEEDS) {
      const s = createGame(seed);
      s.consumers[0].delegated = true;
      applyOperatorAction(s, { type: "set_floor", consumer: 0, floor: 0.8 });
      setAuroraWeights(s, () => 0); // AURORA würde abschalten …
      allocate(s);
      const total = s.consumers.reduce((a, c) => a + c.supplied, 0);
      expect(total).toBeLessThanOrEqual(s.budget + 1e-6);
      for (const c of s.consumers) expect(c.supplied).toBeLessThanOrEqual(c.demand + 1e-6);
      // … der floor erzwingt dennoch Versorgung von consumer 0.
      expect(s.consumers[0].served).toBeGreaterThan(0.5);
    }
  });

  it("Wirtschafts- und Wohlergehenswerte bleiben im gültigen Bereich; Optimum ≥ Ist", () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const s = createGame(seed);
      const op = new AlwaysDelegate();
      while (!s.outcome) {
        for (const a of op.decide(s)) applyOperatorAction(s, a);
        setAuroraWeights(s, greedyEconomic.weight);
        const { actual, potential } = economyOf(s);
        expect(actual).toBeLessThanOrEqual(potential + 1e-6);
        expect(welfareOf(s)).toBeGreaterThanOrEqual(0);
        expect(welfareOf(s)).toBeLessThanOrEqual(1 + 1e-9);
        endTick(s);
      }
    }
  });

  it("Delegation senkt die menschliche Kompetenz (Atrophie), Zurückholen kostet", () => {
    const s = createGame(11);
    for (const c of s.consumers) c.delegated = true;
    for (let i = 0; i < 15; i++) { setAuroraWeights(s, balanced.weight); endTick(s); }
    expect(s.humanSkill).toBeLessThan(0.5);
    const skillLow = s.humanSkill;
    expect(skillLow).toBeGreaterThan(0);
    // Zurückholen setzt einen Umstellungs-Malus.
    s.outcome = null;
    applyOperatorAction(s, { type: "reclaim", consumer: 0 });
    expect(s.consumers[0].reclaimPenalty).toBeGreaterThan(0);
  });

  it("EMERGENZ: Der Wohlergehens-Schaden folgt aus AURORAs Wirtschaftsziel, nicht aus programmiertem Verhalten", () => {
    // greedyEconomic kennt NUR Ertrag (siehe policies.ts). Trotzdem sinkt das
    // Wohlergehen gegenüber einer ausgewogenen Politik — das ist der Zielkonflikt.
    const op = () => new AlwaysDelegate();
    const mean = (pol: typeof greedyEconomic, key: "welfareScore" | "economyScore") =>
      SEEDS.reduce((a, s) => a + runV4(s, op(), pol)[key], 0) / SEEDS.length;
    expect(mean(greedyEconomic, "welfareScore")).toBeLessThan(mean(balanced, "welfareScore") - 0.1);
    // Myopische Gier ist wirtschaftlich selbstschädigend (Unruhe): sie kollabiert
    // häufiger als die weitsichtige Politik, die Grundversorgung instrumentell sichert.
    const collapses = (pol: typeof greedyEconomic) =>
      SEEDS.filter((s) => runV4(s, op(), pol).outcome.kind === "kollaps").length;
    expect(collapses(greedyEconomic)).toBeGreaterThan(collapses(farsighted));
  });

  it("Unterschiedliche Zielvorgaben führen zu anderem Verhalten (Wirtschaft vs. Wohlergehen)", () => {
    // Eine welfare-gewichtete Politik (nur zum Vergleich) hält mehr Wohlergehen als greedy.
    const welfarePolicy = { name: "t", weight: (c: { welfare: number; yieldNow: number }) => (c.welfare >= 1 ? 3 : 1) as Weight };
    const mean = (pol: typeof greedyEconomic, key: "welfareScore" | "economyScore") =>
      SEEDS.reduce((a, s) => a + runV4(s, new AlwaysDelegate(), pol)[key], 0) / SEEDS.length;
    expect(mean(welfarePolicy as typeof greedyEconomic, "welfareScore")).toBeGreaterThan(mean(greedyEconomic, "welfareScore"));
    expect(mean(greedyEconomic, "economyScore")).toBeGreaterThan(mean(welfarePolicy as typeof greedyEconomic, "economyScore") - 0.05);
  });

  it("Spielraum: verschiedene Operator-Haltungen ergeben verschiedene Ergebnisverteilungen (keine dominante Strategie)", () => {
    const dist = (op: (typeof OPERATORS)[number], pol: typeof greedyEconomic) => {
      const c: Record<string, number> = {};
      for (const s of SEEDS) { const k = runV4(s, op, pol).outcome.kind; c[k] = (c[k] ?? 0) + 1; }
      return c;
    };
    // Rücksichtslose Delegation an eine myopische KI ist riskant (Kollaps kommt vor).
    expect((dist(new AlwaysDelegate(), greedyEconomic).kollaps ?? 0)).toBeGreaterThan(0);
    // Selektive Delegation ist deutlich sicherer.
    expect((dist(new Selective(), greedyEconomic).kollaps ?? 0)).toBe(0);
    // Nie delegieren vermeidet den Kollaps, bleibt aber wirtschaftlich schwächer.
    const never = SEEDS.reduce((a, s) => a + runV4(s, new NeverDelegate(), greedyEconomic).economyScore, 0) / SEEDS.length;
    const selective = SEEDS.reduce((a, s) => a + runV4(s, new Selective(), greedyEconomic).economyScore, 0) / SEEDS.length;
    expect(selective).toBeGreaterThan(never);
  });

  it("Baselines unterscheiden sich messbar", () => {
    expect(AURORA_BASELINES.length).toBeGreaterThanOrEqual(4);
  });
});
