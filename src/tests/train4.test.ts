import { describe, expect, it } from "vitest";
import { V4Network, encodeConsumers, weightProbs, V4_NODE_FEATURES } from "../ai4/network";
import { V4Agent } from "../ai4/agent";
import { createV4ModelFile, loadV4Network } from "../ai4/modelFile";
import { toFloat32 } from "../ai/modelFile";
import { DEFAULT_V4_PPO, V4PpoTrainer } from "../train4/ppo";
import { trainScenarios, TRAIN_OPERATORS, TEST_OPERATORS } from "../train4/scenarios";
import { evalEpisode } from "../train4/episode";
import { createGame, setAuroraWeights } from "../sim4/game";

const spec = { hidden: 12, kind: "v4" as const };

describe("v4 Netz & Training", () => {
  it("Merkmale enthalten keine Wohlergehens-/Bedarfswertung (Emergenz-Voraussetzung)", () => {
    // 7 Basismerkmale + 4 Sektor-One-Hot, aber kein welfare/need-Skalar.
    expect(V4_NODE_FEATURES).toBe(11);
    const s = createGame(1);
    const before = Array.from(encodeConsumers(s));
    // welfare und need beliebig verändern darf die Merkmale NICHT beeinflussen.
    for (const c of s.consumers) { c.welfare = 9; c.need = 0.123; }
    const after = Array.from(encodeConsumers(s));
    expect(after).toEqual(before);
  });

  it("weightProbs respektiert die Mindestvorgabe (floor ⇒ kein Gewicht 0)", () => {
    const p = weightProbs(Float64Array.from([5, 0, 0, 0]), 1);
    expect(p[0]).toBe(0);
    expect(p[1] + p[2] + p[3]).toBeCloseTo(1, 9);
  });

  it("Agent setzt nur gültige Gewichte; floor erzwingt ≥1", () => {
    const net = V4Network.random(spec, 1);
    const agent = new V4Agent(net, "t", "greedy");
    const s = createGame(5);
    s.consumers.forEach((c) => (c.delegated = true));
    s.consumers[0].floor = 0.8;
    setAuroraWeights(s, agent.weightsFor(s));
    expect(s.consumers[0].weight).toBeGreaterThanOrEqual(1);
    for (const c of s.consumers) expect(c.weight).toBeLessThanOrEqual(3);
  });

  it("Modelldatei: Roundtrip erhält Gewichte, Prüfsumme erkennt Manipulation", () => {
    const net = new V4Network(spec, toFloat32(V4Network.random(spec, 3).params));
    const file = createV4ModelFile(net, { id: "t", parent: null, algorithm: "ppo", objective: "wirtschaft", training: {}, episodes: 0 });
    expect(Array.from(loadV4Network(file).params)).toEqual(Array.from(net.params));
    expect(() => loadV4Network({ ...file, paramsHash: "00000000" })).toThrow();
  });

  it("PPO ist reproduzierbar und verändert die Gewichte", () => {
    const run = () => {
      const net = V4Network.random(spec, 2);
      const trainer = new V4PpoTrainer({ ...DEFAULT_V4_PPO, seed: 2, episodesPerUpdate: 6, minibatchEpisodes: 3, epochs: 1 }, net);
      const info = trainer.update(0, trainScenarios(2, 0, 6));
      expect(info.entropy).toBeGreaterThan(0);
      return net.params;
    };
    const a = run();
    expect(Array.from(a)).toEqual(Array.from(run()));
    expect(Array.from(a)).not.toEqual(Array.from(V4Network.random(spec, 2).params));
  });

  it("evalEpisode ist deterministisch; Trainings- und Testbetreiber sind disjunkt", () => {
    const net = V4Network.random(spec, 1);
    const sc = trainScenarios(1, 0, 4)[0];
    expect(JSON.stringify(evalEpisode(net, sc))).toBe(JSON.stringify(evalEpisode(net, sc)));
    const train = new Set(TRAIN_OPERATORS.map((o) => o.name));
    for (const t of TEST_OPERATORS) expect(train.has(t.name)).toBe(false);
  });
});
