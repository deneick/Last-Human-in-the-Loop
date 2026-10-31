/// <reference lib="webworker" />
import { loadNetwork, createModelFile, toFloat32, type ModelFile } from "../ai/modelFile";
import { Network } from "../ai/network";
import { NeuralAgent } from "../ai/neuralAgent";
import { DEFAULT_PPO, PolicyGradientTrainer } from "./ppo";
import { trainScenarios, validationScenarios, type TrainingPool } from "./scenarios";
import { runScenarios, summarize } from "./evaluate";
import { profileDefenderSpec, type PlayerRecord } from "./playerProfile";

/**
 * Training im Browser (Web Worker): setzt PPO auf einem vorhandenen Modell
 * fort. Eigene Partien gehen als Spielerprofil-Verteidiger in den Pool ein.
 */
export type BrowserTrainRequest = { parent: ModelFile; records: PlayerRecord[]; updates: number; seed: number; id: string };
export type BrowserTrainMessage =
  | { type: "progress"; update: number; updates: number; trainFitness: number; valWin?: number }
  | { type: "done"; model: ModelFile; valWinBefore: number; valWinAfter: number }
  | { type: "error"; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<BrowserTrainRequest>) => {
  try {
    const { parent, records, updates, seed, id } = event.data;
    const net = loadNetwork(parent);
    const pool: TrainingPool | undefined = records.length > 0 ? { extra: [profileDefenderSpec(records)], extraShare: 0.4 } : undefined;
    const validation = validationScenarios(60);
    const validate = (params: Float64Array) => summarize(runScenarios(new NeuralAgent(new Network(net.spec, params)), validation)).winRate;
    const before = validate(net.params);
    const config = { ...DEFAULT_PPO, seed, updates, episodesPerUpdate: 32, minibatchEpisodes: 16, epochs: 2 };
    const trainer = new PolicyGradientTrainer(config, net);
    for (let u = 0; u < updates; u++) {
      const info = trainer.update(u, trainScenarios(seed, u, config.episodesPerUpdate, pool));
      const valWin = (u + 1) % 10 === 0 ? validate(net.params) : undefined;
      ctx.postMessage({ type: "progress", update: u + 1, updates, trainFitness: info.meanFitness, valWin } satisfies BrowserTrainMessage);
    }
    const final = new Network(net.spec, toFloat32(net.params));
    const after = validate(final.params);
    const model = createModelFile(final, {
      id,
      parent: parent.id,
      algorithm: "ppo",
      training: { ...config, browser: true, playerRecords: records.length },
      episodes: parent.episodes + updates * config.episodesPerUpdate,
      metrics: { validationWinRate: after, validationWinRateParent: before },
      notes: "Im Browser nachtrainiert",
    });
    ctx.postMessage({ type: "done", model, valWinBefore: before, valWinAfter: after } satisfies BrowserTrainMessage);
  } catch (error) {
    ctx.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) } satisfies BrowserTrainMessage);
  }
};
