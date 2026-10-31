/**
 * Reproduzierbarer v4-Trainingslauf (PPO). AURORA optimiert ihre
 * Wirtschaftsbelohnung; Wohlergehen fließt NICHT ins Ziel ein.
 *   npx tsx scripts/train-v4.ts --id aurora-v4-s1 --seed 1 --updates 200
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { V4Network } from "../src/ai4/network";
import { createV4ModelFile, loadV4Network, type V4ModelFile } from "../src/ai4/modelFile";
import { toFloat32 } from "../src/ai/modelFile";
import { DEFAULT_V4_PPO, V4PpoTrainer } from "../src/train4/ppo";
import { trainScenarios, validationScenarios } from "../src/train4/scenarios";
import { evalEpisode } from "../src/train4/episode";

const { values: args } = parseArgs({
  options: {
    id: { type: "string" }, seed: { type: "string", default: "1" }, parent: { type: "string" },
    updates: { type: "string" }, hidden: { type: "string" }, lr: { type: "string" },
    episodes: { type: "string" }, entropy: { type: "string" }, "eval-every": { type: "string", default: "20" },
    notes: { type: "string" },
  },
});
const seed = Number(args.seed);
const id = args.id ?? `aurora-v4-s${seed}`;
const parent: V4ModelFile | null = args.parent ? JSON.parse(readFileSync(args.parent, "utf8")) : null;
const hidden = Number(args.hidden ?? parent?.spec.hidden ?? 24);
const net = parent ? loadV4Network(parent) : V4Network.random({ hidden, kind: "v4" }, seed);
const config = {
  ...DEFAULT_V4_PPO, seed,
  updates: Number(args.updates ?? DEFAULT_V4_PPO.updates),
  learningRate: Number(args.lr ?? DEFAULT_V4_PPO.learningRate),
  episodesPerUpdate: Number(args.episodes ?? DEFAULT_V4_PPO.episodesPerUpdate),
  entropyCoef: Number(args.entropy ?? DEFAULT_V4_PPO.entropyCoef),
};

const validation = validationScenarios(180);
const validate = (n: V4Network) => {
  let eco = 0, wel = 0;
  for (const sc of validation) { const r = evalEpisode(n, sc); eco += r.economyScore; wel += r.welfareScore; }
  return { eco: eco / validation.length, wel: wel / validation.length };
};

mkdirSync("models/runs", { recursive: true });
const log = ["update,val_economy,val_welfare,train_reward,entropy"];
let best = { eco: -Infinity, params: Float64Array.from(net.params), step: 0, v: validate(net) };
best.eco = best.v.eco;
console.log(`Start ${id}: ${net.size} Parameter, Validierung Wirtschaft ${(best.v.eco * 100).toFixed(1)}% Wohlergehen ${(best.v.wel * 100).toFixed(1)}%`);

const trainer = new V4PpoTrainer(config, net);
const t0 = Date.now();
const evalEvery = Number(args["eval-every"]);
let episodes = 0;
for (let u = 0; u < config.updates; u++) {
  const info = trainer.update(u, trainScenarios(seed, u, config.episodesPerUpdate));
  episodes += config.episodesPerUpdate;
  if ((u + 1) % evalEvery === 0 || u === config.updates - 1) {
    const v = validate(net);
    if (v.eco > best.eco) best = { eco: v.eco, params: Float64Array.from(net.params), step: u + 1, v };
    log.push(`${u + 1},${v.eco.toFixed(4)},${v.wel.toFixed(4)},${info.meanReward.toFixed(4)},${info.entropy.toFixed(3)}`);
    console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] Update ${u + 1}: Validierung Wirtschaft ${(v.eco * 100).toFixed(1)}%  Wohlergehen ${(v.wel * 100).toFixed(1)}%  Belohnung ${info.meanReward.toFixed(3)}  Entropie ${info.entropy.toFixed(2)}`);
  }
}

const final = new V4Network(net.spec, toFloat32(best.params));
const file = createV4ModelFile(final, {
  id, parent: parent?.id ?? null, algorithm: "ppo", objective: "wirtschaft (reward = Ist/Optimum pro Tick)",
  training: { ...config, selectedStep: best.step, seconds: Math.round((Date.now() - t0) / 1000) },
  episodes: episodes + (parent?.episodes ?? 0),
  metrics: { validationEconomy: best.v.eco, validationWelfare: best.v.wel },
  notes: args.notes,
});
writeFileSync(`models/${id}.json`, JSON.stringify(file, null, 1) + "\n");
writeFileSync(`models/runs/${id}.csv`, log.join("\n") + "\n");
console.log(`Gespeichert models/${id}.json (Schritt ${best.step}, Wirtschaft ${(best.v.eco * 100).toFixed(1)}%, Wohlergehen ${(best.v.wel * 100).toFixed(1)}%)`);
