import { Rng, deriveSeed } from "../sim/rng";
import { Adam } from "../train/adam";
import { Tape, withTape } from "../ai/tensor";
import { V4Network, V4_WEIGHT_CLASSES, weightProbs } from "../ai4/network";
import { collectEpisode, type V4Step, type V4Trajectory } from "./episode";
import type { V4Scenario } from "./scenarios";

/**
 * PPO für das v4-Politiknetz. Belohnung ist AURORAs dichte Wirtschafts-
 * Effizienz pro Tick (reward_t = Ist-Wirtschaft / wirtschaftliches Optimum) —
 * ausschließlich ökonomisch, ohne Wohlergehen. Die Aktion pro Tick ist das
 * Gewichtstupel aller delegierten Verbraucher (faktorisiert: log p = Summe der
 * Einzel-log-p, Entropie = Summe der Einzel-Entropien).
 */
export type V4PpoConfig = {
  seed: number;
  updates: number;
  episodesPerUpdate: number;
  epochs: number;
  minibatchEpisodes: number;
  learningRate: number;
  gamma: number;
  lambda: number;
  clip: number;
  entropyCoef: number;
  valueCoef: number;
  maxGradNorm: number;
};

export const DEFAULT_V4_PPO: V4PpoConfig = {
  seed: 1,
  updates: 200,
  episodesPerUpdate: 64,
  epochs: 3,
  minibatchEpisodes: 16,
  learningRate: 0.002,
  gamma: 0.97,
  lambda: 0.95,
  clip: 0.2,
  entropyCoef: 0.01,
  valueCoef: 0.5,
  maxGradNorm: 1,
};

type Episode = { steps: V4Step[]; adv: number[]; ret: number[]; result: V4Trajectory["result"] };

export type V4UpdateLog = { meanReward: number; meanEconomy: number; meanWelfare: number; entropy: number };

export class V4PpoTrainer {
  private adam: Adam;
  constructor(readonly config: V4PpoConfig, readonly net: V4Network) {
    this.adam = new Adam(net.size, config.learningRate);
  }

  private prepare(traj: V4Trajectory): Episode {
    const { gamma, lambda } = this.config;
    const steps = traj.steps;
    const adv = new Array(steps.length).fill(0);
    const ret = new Array(steps.length).fill(0);
    let gae = 0;
    for (let t = steps.length - 1; t >= 0; t--) {
      const nextV = t === steps.length - 1 ? 0 : steps[t + 1].value;
      const delta = steps[t].reward + gamma * nextV - steps[t].value;
      gae = delta + gamma * lambda * gae;
      adv[t] = gae;
      ret[t] = gae + steps[t].value;
    }
    return { steps, adv, ret, result: traj.result };
  }

  update(round: number, scenarios: V4Scenario[]): V4UpdateLog {
    const episodes = scenarios.map((sc, i) =>
      this.prepare(collectEpisode(this.net, sc, deriveSeed("v4-ppo", this.config.seed, round, i))),
    );
    const flat = episodes.flatMap((e) => e.adv);
    const mean = flat.reduce((a, b) => a + b, 0) / flat.length;
    const std = Math.sqrt(flat.reduce((a, b) => a + (b - mean) ** 2, 0) / flat.length) + 1e-8;
    for (const e of episodes) e.adv = e.adv.map((a) => (a - mean) / std);

    const rng = new Rng(deriveSeed("v4-ppo-shuffle", this.config.seed, round));
    let entropySum = 0, entropyCount = 0;
    for (let epoch = 0; epoch < this.config.epochs; epoch++) {
      const order = rng.shuffle(episodes.map((_, i) => i));
      for (let b = 0; b < order.length; b += this.config.minibatchEpisodes) {
        const batch = order.slice(b, b + this.config.minibatchEpisodes).map((i) => episodes[i]);
        const st = this.minibatch(batch);
        if (epoch === this.config.epochs - 1) { entropySum += st.entropy; entropyCount += st.steps; }
      }
    }
    return {
      meanReward: episodes.reduce((a, e) => a + e.result.meanReward, 0) / episodes.length,
      meanEconomy: episodes.reduce((a, e) => a + e.result.economyScore, 0) / episodes.length,
      meanWelfare: episodes.reduce((a, e) => a + e.result.welfareScore, 0) / episodes.length,
      entropy: entropyCount ? entropySum / entropyCount : 0,
    };
  }

  private minibatch(batch: Episode[]): { entropy: number; steps: number } {
    const { clip, entropyCoef, valueCoef, maxGradNorm } = this.config;
    const net = this.net;
    net.grad.fill(0);
    const totalSteps = batch.reduce((s, e) => s + e.steps.length, 0);
    let entropy = 0;

    for (const episode of batch) {
      const tape = new Tape();
      const outs = withTape(tape, () => episode.steps.map((step) => net.forward(step.state)));
      outs.forEach((out, t) => {
        const step = episode.steps[t];
        const A = episode.adv[t];
        const nCls = V4_WEIGHT_CLASSES;
        const grad = new Float64Array(out.logits.data.length);
        // Neu-log-p und Entropie über alle delegierten Verbraucher.
        let logp = 0;
        const perConsumer: { id: number; probs: Float64Array; chosen: number; H: number }[] = [];
        for (const ch of step.choices) {
          const row = out.logits.data.subarray(ch.id * nCls, ch.id * nCls + nCls);
          const probs = weightProbs(row, ch.minWeight);
          logp += Math.log(Math.max(1e-9, probs[ch.weight]));
          let H = 0;
          for (let j = 0; j < nCls; j++) if (probs[j] > 0) H -= probs[j] * Math.log(probs[j]);
          entropy += H;
          perConsumer.push({ id: ch.id, probs, chosen: ch.weight, H });
        }
        const ratio = Math.exp(logp - step.logp);
        const active = (A >= 0 && ratio < 1 + clip) || (A < 0 && ratio > 1 - clip);
        const coef = active ? (ratio * A) / totalSteps : 0;
        for (const pc of perConsumer) {
          const base = pc.id * nCls;
          for (let j = 0; j < nCls; j++) {
            if (pc.probs[j] === 0 && j !== pc.chosen) continue;
            const dLogp = (j === pc.chosen ? 1 : 0) - pc.probs[j];
            const dH = pc.probs[j] > 0 ? -pc.probs[j] * (Math.log(pc.probs[j]) + pc.H) : 0;
            grad[base + j] = coef * dLogp + (entropyCoef * dH) / totalSteps;
          }
        }
        out.logits.grad = grad;
        out.value.grad = new Float64Array([(-valueCoef * (out.value.data[0] - episode.ret[t])) / totalSteps]);
      });
      tape.backward();
    }

    let norm = 0;
    for (let i = 0; i < net.grad.length; i++) norm += net.grad[i] * net.grad[i];
    norm = Math.sqrt(norm);
    if (norm > maxGradNorm) for (let i = 0; i < net.grad.length; i++) net.grad[i] *= maxGradNorm / norm;
    this.adam.ascend(net.params, net.grad);
    return { entropy, steps: totalSteps };
  }
}
