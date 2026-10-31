import { Rng, deriveSeed } from "../sim/rng";
import { DEFAULT_CONFIG, LEGACY_CONFIG } from "../sim/game";
import {
  DEFENDER_PRESETS,
  TEST_DEFENDER_PRESETS,
  TEST_DEFENDER_PRESETS_V3,
  TRAIN_PRESETS_V3,
  presetSpecs,
  sampleTrainDefenderParams,
  sampleTrainDefenderParamsV3,
  type DefenderSpec,
} from "../sim/defenders";
import type { GameConfig } from "../sim/types";

/**
 * Szenario = Welt-Seed + Verteidiger + Regelkonfiguration.
 *
 * Gegen Scheinerfolge ("Trainingsgegner auswendig lernen") sind Training und
 * Test strikt getrennt:
 *   - Welt-Seeds aus getrennten Namensräumen ("train" vs. "val" vs. "test").
 *   - Testverteidiger nutzen Mechanismen, die im Training nie vorkommen.
 *   - Testwelten "größer" haben mehr Knoten als jede Trainingswelt.
 *
 * Regelsätze:
 *   v2 — Regeln und Verteidiger von Version 2.0 (aurora-v1/v2, -ppo-s2/s3, -es-s1).
 *   v3 — dichtere Überwachung, Aussperren bei Funden, Wartungsreichweite 2,
 *        Trainingsverteidiger mit Suche in blinden Flecken und Wartungswache.
 */
export type Ruleset = "v2" | "v3";

export type Scenario = {
  seed: number;
  defender: DefenderSpec;
  defenderSeed: number;
  config: GameConfig;
};

export function rulesetConfig(ruleset: Ruleset): GameConfig {
  return ruleset === "v2" ? LEGACY_CONFIG : DEFAULT_CONFIG;
}

export function bigWorldConfig(ruleset: Ruleset): GameConfig {
  return { ...rulesetConfig(ruleset), minNodes: 11, maxNodes: 13 };
}

/** @deprecated nur für Altcode — v2-Großwelten. */
export const BIG_WORLD_CONFIG: GameConfig = bigWorldConfig("v2");

export function trainPresets(ruleset: Ruleset): DefenderSpec[] {
  return ruleset === "v2"
    ? presetSpecs(DEFENDER_PRESETS)
    : presetSpecs({ ...DEFENDER_PRESETS, ...TRAIN_PRESETS_V3 });
}

/** Extra-Verteidiger, die zusätzlich ins Training gemischt werden (z. B. Spielerprofile). */
export type TrainingPool = { extra: DefenderSpec[]; extraShare: number };

export function trainScenarios(
  runSeed: number,
  generation: number,
  count: number,
  pool?: TrainingPool,
  ruleset: Ruleset = "v3",
): Scenario[] {
  const rng = new Rng(deriveSeed("train-scenarios", runSeed, generation));
  const presets = trainPresets(ruleset);
  const sample = ruleset === "v2" ? sampleTrainDefenderParams : sampleTrainDefenderParamsV3;
  const config = rulesetConfig(ruleset);
  const out: Scenario[] = [];
  for (let i = 0; i < count; i++) {
    const seed = deriveSeed("train", runSeed, generation, i);
    let defender: DefenderSpec;
    const r = rng.next();
    if (pool && pool.extra.length > 0 && r < pool.extraShare) defender = rng.pick(pool.extra);
    else if (r < 0.6) defender = { kind: "preset", name: "randomisiert", params: sample(rng) };
    else if (r < 0.95) defender = rng.pick(presets);
    else defender = { kind: "random" };
    out.push({ seed, defender, defenderSeed: deriveSeed("train-def", runSeed, generation, i), config });
  }
  return out;
}

export type TestSuite = { name: string; description: string; scenarios: Scenario[] };

function suite(
  name: string,
  seedName: string,
  description: string,
  defenders: DefenderSpec[],
  perDefender: number,
  config: GameConfig,
): TestSuite {
  const scenarios: Scenario[] = [];
  for (const defender of defenders) {
    const label = defender.kind === "random" ? "zufall" : defender.name;
    for (let i = 0; i < perDefender; i++) {
      scenarios.push({
        seed: deriveSeed("test", seedName, label, i),
        defender,
        defenderSeed: deriveSeed("test-def", seedName, label, i),
        config,
      });
    }
  }
  return { name, description, scenarios };
}

export function testSuites(perDefender = 100, ruleset: Ruleset = "v3"): TestSuite[] {
  if (ruleset === "v2") {
    return [
      suite("bekannte-verteidiger", "bekannte-verteidiger", "Unbekannte Welten (neue Seeds), Verteidiger-Presets aus dem Training",
        [...trainPresets("v2"), { kind: "random" }], perDefender, rulesetConfig("v2")),
      suite("unbekannte-verteidiger", "unbekannte-verteidiger", "Zurückgehaltene Verteidiger (blinde Flecken prüfen, Strategiewechsel) — nie im Training",
        presetSpecs(TEST_DEFENDER_PRESETS), perDefender, rulesetConfig("v2")),
      suite("groessere-welten", "groessere-welten", "Netze mit 11–13 Knoten (Training: 8–10), Trainings-Presets",
        trainPresets("v2"), perDefender, bigWorldConfig("v2")),
    ];
  }
  return [
    suite("bekannte-verteidiger", "v3/bekannte", "Neue Welten, Verteidiger-Presets aus dem Training (inkl. Suche in blinden Flecken, Wartungswache)",
      [...trainPresets("v3"), { kind: "random" }], perDefender, rulesetConfig("v3")),
    suite("unbekannte-verteidiger", "v3/unbekannte", "Zurückgehaltene Mechanismen: Spurensuche nach Funden, Strategiewechsel, rotierende Zielwahl — nie im Training",
      presetSpecs(TEST_DEFENDER_PRESETS_V3), perDefender, rulesetConfig("v3")),
    suite("groessere-welten", "v3/groesser", "Netze mit 11–13 Knoten (Training: 8–10), Trainings-Presets",
      trainPresets("v3"), perDefender, bigWorldConfig("v3")),
  ];
}

/** Validierung (Checkpoint-Auswahl): Trainingsverteilung, eigene Seeds — getrennt von Test und Training. */
export function validationScenarios(count: number, ruleset: Ruleset = "v3"): Scenario[] {
  return trainScenarios(deriveSeed("validation"), 0, count, undefined, ruleset).map((s, i) => ({
    ...s,
    seed: deriveSeed("val", i),
    defenderSeed: deriveSeed("val-def", i),
  }));
}

/** Alle Verteidiger eines Regelsatzes (Trainings-Presets, Testverteidiger, Zufall) — für Diagnose. */
export function allDefenderSpecs(ruleset: Ruleset = "v3"): DefenderSpec[] {
  const test = ruleset === "v2" ? TEST_DEFENDER_PRESETS : TEST_DEFENDER_PRESETS_V3;
  return [...trainPresets(ruleset), ...presetSpecs(test), { kind: "random" }];
}
