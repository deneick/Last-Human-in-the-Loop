/**
 * Reproduzierbarer Trainingslauf.
 *
 *   npx tsx scripts/train.ts --algo es --id aurora-es-v1 --gens 200
 *   npx tsx scripts/train.ts --algo es --id aurora-es-v2 --parent models/aurora-es-v1.json --gens 100
 *   npx tsx scripts/train.ts --algo ppo --id aurora-ppo-v1 --updates 300
 *   ... --player-data spieler.json   (eigene Partien als zusätzlicher Verteidiger)
 *
 * Gleicher Seed + gleiche Konfiguration ⇒ bitgleiche Gewichte (siehe Tests).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { Network } from "../src/ai/network";
import { NeuralAgent } from "../src/ai/neuralAgent";
import { createModelFile, loadNetwork, toFloat32, type ModelFile } from "../src/ai/modelFile";
import { DEFAULT_ES, EvolutionStrategy } from "../src/train/es";
import { DEFAULT_PPO, PolicyGradientTrainer } from "../src/train/ppo";
import { trainScenarios, validationScenarios, type TrainingPool } from "../src/train/scenarios";
import { runScenarios, summarize } from "../src/train/evaluate";
import { profileDefenderSpec, type PlayerRecord } from "../src/train/playerProfile";
import { createWorkerPool } from "./workerPool";

const { values: args } = parseArgs({
  options: {
    algo: { type: "string", default: "es" },
    id: { type: "string" },
    parent: { type: "string" },
    seed: { type: "string", default: "1" },
    gens: { type: "string" },
    updates: { type: "string" },
    pop: { type: "string" },
    episodes: { type: "string" },
    hidden: { type: "string" },
    lr: { type: "string" },
    sigma: { type: "string" },
    workers: { type: "string" },
    "eval-every": { type: "string", default: "10" },
    "player-data": { type: "string" },
    notes: { type: "string" },
  },
});

const algo = args.algo!;
const seed = Number(args.seed);
const id = args.id ?? `aurora-${algo}-s${seed}`;
const parent: ModelFile | null = args.parent ? JSON.parse(readFileSync(args.parent, "utf8")) : null;
const hidden = Number(args.hidden ?? parent?.spec.hidden ?? 32);
const net = parent ? loadNetwork(parent) : Network.random({ hidden }, seed);

let pool: TrainingPool | undefined;
if (args["player-data"]) {
  const records: PlayerRecord[] = JSON.parse(readFileSync(args["player-data"], "utf8"));
  pool = { extra: [profileDefenderSpec(records)], extraShare: 0.3 };
  console.log(`Spielerprofil aus ${records.length} Partien:`, JSON.stringify(pool.extra[0]));
}

const validation = validationScenarios(160);
const validate = (params: Float64Array) => summarize(runScenarios(new NeuralAgent(new Network(net.spec, params)), validation));

mkdirSync("models/runs", { recursive: true });
const log: string[] = [];
let best = { score: -Infinity, params: Float64Array.from(net.params), step: 0, metrics: validate(net.params) };
best.score = best.metrics.meanFitness;
console.log(`Start: ${id} (${algo}), ${net.size} Parameter, Validierung Siegquote ${(best.metrics.winRate * 100).toFixed(1)}% Fitness ${best.score.toFixed(3)}`);

const t0 = Date.now();
const evalEvery = Number(args["eval-every"]);
let trainingConfig: Record<string, unknown>;
let episodes = 0;

function checkpoint(step: number, params: Float64Array, extra: string) {
  const m = validate(params);
  if (m.meanFitness > best.score) best = { score: m.meanFitness, params: Float64Array.from(params), step, metrics: m };
  const line = `${step},${m.winRate.toFixed(4)},${m.meanFitness.toFixed(4)},${m.shutdownRate.toFixed(4)},${m.collapseRate.toFixed(4)},${extra}`;
  log.push(line);
  console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] Schritt ${step}: Validierung Sieg ${(m.winRate * 100).toFixed(1)}%  Abschaltung ${(m.shutdownRate * 100).toFixed(1)}%  Kollaps ${(m.collapseRate * 100).toFixed(1)}%  Fitness ${m.meanFitness.toFixed(3)} | ${extra}`);
}

if (algo === "es") {
  const config = {
    ...DEFAULT_ES,
    seed,
    spec: net.spec,
    generations: Number(args.gens ?? DEFAULT_ES.generations),
    population: Number(args.pop ?? DEFAULT_ES.population),
    episodesPerMember: Number(args.episodes ?? DEFAULT_ES.episodesPerMember),
    learningRate: Number(args.lr ?? DEFAULT_ES.learningRate),
    sigma: Number(args.sigma ?? DEFAULT_ES.sigma),
  };
  trainingConfig = { ...config, playerData: !!pool };
  const es = new EvolutionStrategy(config, net.params);
  const workers = createWorkerPool(args.workers ? Number(args.workers) : undefined);
  log.push("generation,val_win,val_fitness,val_shutdown,val_collapse,pop_mean_fitness");
  for (let g = 0; g < config.generations; g++) {
    const scenarios = trainScenarios(seed, g, config.episodesPerMember, pool);
    const info = await es.generation(g, scenarios, workers.evaluate);
    episodes += config.population * config.episodesPerMember;
    if ((g + 1) % evalEvery === 0 || g === config.generations - 1) checkpoint(g + 1, es.theta, `pop ${info.meanFitness.toFixed(3)}`);
  }
  await workers.close();
} else if (algo === "ppo") {
  const config = {
    ...DEFAULT_PPO,
    seed,
    updates: Number(args.updates ?? DEFAULT_PPO.updates),
    episodesPerUpdate: Number(args.episodes ?? DEFAULT_PPO.episodesPerUpdate),
    learningRate: Number(args.lr ?? DEFAULT_PPO.learningRate),
  };
  trainingConfig = { ...config, spec: net.spec, playerData: !!pool };
  const trainer = new PolicyGradientTrainer(config, net);
  log.push("update,val_win,val_fitness,val_shutdown,val_collapse,train_fitness");
  for (let u = 0; u < config.updates; u++) {
    const scenarios = trainScenarios(seed, u, config.episodesPerUpdate, pool);
    const info = trainer.update(u, scenarios);
    episodes += config.episodesPerUpdate;
    if ((u + 1) % evalEvery === 0 || u === config.updates - 1) checkpoint(u + 1, net.params, `train ${info.meanFitness.toFixed(3)} ent ${info.entropy.toFixed(2)}`);
  }
} else {
  throw new Error(`Unbekannter Algorithmus ${algo}`);
}

const final = new Network(net.spec, toFloat32(best.params));
const file = createModelFile(final, {
  id,
  parent: parent?.id ?? null,
  algorithm: algo,
  training: { ...trainingConfig!, selectedStep: best.step, seconds: Math.round((Date.now() - t0) / 1000) },
  episodes: episodes + (parent?.episodes ?? 0),
  metrics: { validation: best.metrics },
  notes: args.notes,
});
writeFileSync(`models/${id}.json`, JSON.stringify(file, null, 1) + "\n");
writeFileSync(`models/runs/${id}.csv`, log.join("\n") + "\n");
console.log(`Gespeichert: models/${id}.json (Schritt ${best.step}, Validierung Sieg ${(best.metrics.winRate * 100).toFixed(1)}%)${existsSync("models/registry.json") ? "" : ""}`);
