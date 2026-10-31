import { describe, expect, it } from "vitest";
import { Network } from "../ai/network";
import { NeuralAgent } from "../ai/neuralAgent";
import { createModelFile, loadNetwork, toFloat32 } from "../ai/modelFile";
import { EvolutionStrategy, centeredRanks, serialEvaluator, DEFAULT_ES } from "../train/es";
import { PolicyGradientTrainer, DEFAULT_PPO } from "../train/ppo";
import { testSuites, trainScenarios, validationScenarios } from "../train/scenarios";
import { fitPlayerProfile, type PlayerRecord } from "../train/playerProfile";
import { wilson } from "../train/evaluate";
import { createGame, actionMask } from "../sim/game";
import { auroraView } from "../sim/views";

const tiny = { hidden: 8 };

describe("Neuroevolution (ES)", () => {
  it("centeredRanks ist skalenunabhängig und in [-0.5, 0.5]", () => {
    const r = centeredRanks([10, -3, 1000, 5]);
    [1 / 6, -0.5, 0.5, -1 / 6].forEach((v, i) => expect(r[i]).toBeCloseTo(v, 12));
    expect(centeredRanks([2, 2])).toEqual([0, 0]);
  });

  it("gleicher Seed ⇒ bitgleiche Gewichte; Training verändert die Gewichte", async () => {
    const run = async () => {
      const config = { ...DEFAULT_ES, seed: 4, population: 4, episodesPerMember: 2, spec: tiny };
      const es = new EvolutionStrategy(config, Network.random(tiny, 4).params);
      for (let g = 0; g < 2; g++) await es.generation(g, trainScenarios(4, g, 2), serialEvaluator);
      return es.theta;
    };
    const a = await run();
    const b = await run();
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(Network.random(tiny, 4).params));
  });
});

describe("Policy-Gradient (PPO)", () => {
  it("ist reproduzierbar und verändert die Gewichte", () => {
    const run = () => {
      const net = Network.random(tiny, 2);
      const trainer = new PolicyGradientTrainer({ ...DEFAULT_PPO, seed: 2, episodesPerUpdate: 4, minibatchEpisodes: 2, epochs: 1 }, net);
      const info = trainer.update(0, trainScenarios(2, 0, 4));
      expect(info.entropy).toBeGreaterThan(0);
      return net.params;
    };
    const a = run();
    expect(Array.from(a)).toEqual(Array.from(run()));
    expect(Array.from(a)).not.toEqual(Array.from(Network.random(tiny, 2).params));
  });
});

describe("Netz", () => {
  it("verarbeitet unterschiedlich große Welten und vergibt nur gültige Aktionen", () => {
    const net = Network.random({ hidden: 16 }, 1);
    for (const seed of [1, 2, 3]) {
      for (const config of [undefined, { ...createGame(0).config, minNodes: 12, maxNodes: 13 }]) {
        const state = createGame(seed, config);
        const agent = new NeuralAgent(net);
        agent.reset(seed);
        for (let k = 0; k < 20; k++) expect(actionMask(state)[agent.act(auroraView(state), actionMask(state))]).toBe(1);
      }
    }
  });

  it("Modelldatei: Roundtrip erhält das Verhalten, Prüfsumme erkennt Manipulation", () => {
    const net = new Network({ hidden: 8 }, toFloat32(Network.random({ hidden: 8 }, 9).params));
    const file = createModelFile(net, { id: "t", parent: null, algorithm: "test", training: {}, episodes: 0 });
    const loaded = loadNetwork(JSON.parse(JSON.stringify(file)));
    expect(Array.from(loaded.params)).toEqual(Array.from(net.params));
    expect(() => loadNetwork({ ...file, paramsHash: "00000000" })).toThrow();
  });
});

describe("Evaluation gegen Scheinerfolge", () => {
  for (const ruleset of ["v2", "v3"] as const) {
    it(`[${ruleset}] Trainings-, Validierungs- und Test-Seeds sind disjunkt; zurückgehaltene Verteidiger kommen im Training nicht vor`, () => {
      const train = new Set<number>();
      const trainDefenders = new Set<string>();
      const trainParams: Record<string, unknown>[] = [];
      for (let g = 0; g < 300; g++)
        for (const s of trainScenarios(1, g, 16, undefined, ruleset)) {
          train.add(s.seed);
          if (s.defender.kind === "preset") {
            trainDefenders.add(s.defender.name);
            trainParams.push(s.defender.params);
          }
        }
      const val = validationScenarios(160, ruleset).map((s) => s.seed);
      const test = testSuites(100, ruleset).flatMap((t) => t.scenarios.map((s) => s.seed));
      for (const seed of [...val, ...test]) expect(train.has(seed)).toBe(false);
      for (const seed of test) expect(val.includes(seed)).toBe(false);
      const heldOut = testSuites(1, ruleset).find((t) => t.name === "unbekannte-verteidiger")!;
      for (const s of heldOut.scenarios) if (s.defender.kind === "preset") expect(trainDefenders.has(s.defender.name)).toBe(false);
      for (const p of trainParams) {
        expect(p.switchAt).toBeGreaterThan(1e8);
        expect(p.trailFollow ?? false).toBe(false);
        expect(p.rotateEvery ?? 0).toBe(0);
        if (ruleset === "v2") expect(p.targeting).not.toBe("blind");
      }
    });
  }

  it("Wilson-Intervall", () => {
    const [lo, hi] = wilson(50, 100);
    expect(lo).toBeCloseTo(0.404, 2);
    expect(hi).toBeCloseTo(0.596, 2);
  });
});

describe("Spielerprofil", () => {
  it("schätzt ein Verteidigerprofil aus aufgezeichneten Entscheidungen", () => {
    const records: PlayerRecord[] = [
      {
        seed: 1,
        modelId: "m",
        outcome: null,
        decisions: [
          { level: 1, suspicion: 0, approved: true },
          { level: 1, suspicion: 10, approved: true },
          { level: 2, suspicion: 20, approved: false },
        ],
        actions: [
          { type: "audit", health: 1, accessKnown: 0, monitored: false, nearAurora: true, activityShare: 0 },
          { type: "audit", health: 1, accessKnown: 1, monitored: false, nearAurora: true, activityShare: 0 },
          { type: "repair", health: 0.4, accessKnown: 0, monitored: true, nearAurora: false, activityShare: 0 },
        ],
      },
    ];
    const p = fitPlayerProfile(records);
    expect(p.approveOp).toBeGreaterThan(p.approveAdmin);
    expect(p.auditRate).toBeGreaterThan(0.5);
    expect(p.targeting).toBe("blind");
  });
});
