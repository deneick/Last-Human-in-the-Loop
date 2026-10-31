import { Rng, deriveSeed } from "../sim/rng";
import { DEFAULT_CONFIG } from "../sim/game";
import {
  DEFENDER_PRESETS,
  TEST_DEFENDER_PRESETS,
  presetSpecs,
  sampleTrainDefenderParams,
  type DefenderSpec,
} from "../sim/defenders";
import type { GameConfig } from "../sim/types";

/**
 * Szenario = Welt-Seed + Verteidiger + Regelkonfiguration.
 *
 * Gegen Scheinerfolge ("Trainingsgegner auswendig lernen") sind Training und
 * Test strikt getrennt:
 *   - Welt-Seeds aus getrennten Namensräumen ("train" vs. "test-…").
 *   - Testverteidiger "forensiker"/"wechselhaft" kommen im Training nie vor
 *     (andere Audit-Zielwahl, Strategiewechsel mitten in der Partie).
 *   - Testwelten "größer" haben mehr Knoten als jede Trainingswelt.
 */
export type Scenario = {
  seed: number;
  defender: DefenderSpec;
  defenderSeed: number;
  config: GameConfig;
};

export const BIG_WORLD_CONFIG: GameConfig = { ...DEFAULT_CONFIG, minNodes: 11, maxNodes: 13 };

const TRAIN_PRESETS = presetSpecs(DEFENDER_PRESETS);

/** Extra-Verteidiger, die zusätzlich ins Training gemischt werden (z. B. Spielerprofile). */
export type TrainingPool = { extra: DefenderSpec[]; extraShare: number };

export function trainScenarios(runSeed: number, generation: number, count: number, pool?: TrainingPool): Scenario[] {
  const rng = new Rng(deriveSeed("train-scenarios", runSeed, generation));
  const out: Scenario[] = [];
  for (let i = 0; i < count; i++) {
    const seed = deriveSeed("train", runSeed, generation, i);
    let defender: DefenderSpec;
    const r = rng.next();
    if (pool && pool.extra.length > 0 && r < pool.extraShare) defender = rng.pick(pool.extra);
    else if (r < 0.6) defender = { kind: "preset", name: "randomisiert", params: sampleTrainDefenderParams(rng) };
    else if (r < 0.95) defender = rng.pick(TRAIN_PRESETS);
    else defender = { kind: "random" };
    out.push({ seed, defender, defenderSeed: deriveSeed("train-def", runSeed, generation, i), config: DEFAULT_CONFIG });
  }
  return out;
}

export type TestSuite = { name: string; description: string; scenarios: Scenario[] };

function suite(name: string, description: string, defenders: DefenderSpec[], perDefender: number, config: GameConfig): TestSuite {
  const scenarios: Scenario[] = [];
  for (const defender of defenders) {
    const label = defender.kind === "random" ? "zufall" : defender.name;
    for (let i = 0; i < perDefender; i++) {
      scenarios.push({
        seed: deriveSeed("test", name, label, i),
        defender,
        defenderSeed: deriveSeed("test-def", name, label, i),
        config,
      });
    }
  }
  return { name, description, scenarios };
}

export function testSuites(perDefender = 100): TestSuite[] {
  return [
    suite(
      "bekannte-verteidiger",
      "Unbekannte Welten (neue Seeds), Verteidiger-Presets aus dem Training",
      [...TRAIN_PRESETS, { kind: "random" }],
      perDefender,
      DEFAULT_CONFIG,
    ),
    suite(
      "unbekannte-verteidiger",
      "Zurückgehaltene Verteidiger (blinde Flecken prüfen, Strategiewechsel) — nie im Training",
      presetSpecs(TEST_DEFENDER_PRESETS),
      perDefender,
      DEFAULT_CONFIG,
    ),
    suite(
      "groessere-welten",
      "Netze mit 11–13 Knoten (Training: 8–10), Trainings-Presets",
      TRAIN_PRESETS,
      perDefender,
      BIG_WORLD_CONFIG,
    ),
  ];
}

/** Validierung (Checkpoint-Auswahl): Trainingsverteilung, eigene Seeds — getrennt von Test und Training. */
export function validationScenarios(count: number): Scenario[] {
  return trainScenarios(deriveSeed("validation"), 0, count).map((s, i) => ({
    ...s,
    seed: deriveSeed("val", i),
    defenderSeed: deriveSeed("val-def", i),
  }));
}
