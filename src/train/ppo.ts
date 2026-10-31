import { Rng, deriveSeed } from "../sim/rng";
import { makeDefender } from "../sim/defenders";
import { Network, maskedProbs } from "../ai/network";
import { NeuralAgent, type StepRecord } from "../ai/neuralAgent";
import { Tape, withTape, type Tensor } from "../ai/tensor";
import { playEpisode } from "./episode";
import { Adam } from "./adam";
import type { Scenario } from "./scenarios";

/**
 * Proximal Policy Optimization (Schulman et al. 2017) für das rekurrente Netz.
 *
 * - Sammeln: ganze Partien mit der aktuellen (stochastischen) Policy.
 * - Belohnung: dieselbe wie bei ES — nur am Partieende (fitnessOf), sonst 0.
 * - Vorteile: GAE(γ, λ) mit dem Value-Kopf als Baseline, batch-normalisiert.
 * - Update: mehrere Epochen, Partien als Ganzes (BPTT durch den GRU-Zustand),
 *   geclipptes Surrogat + Entropiebonus + Value-Regression.
 *
 * Die Gradienten der Verlustfunktion nach den Logits sind analytisch
 * (Softmax), danach übernimmt die Autodiff (tensor.ts).
 */
export type PpoConfig = {
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

export const DEFAULT_PPO: PpoConfig = {
  seed: 1,
  updates: 300,
  episodesPerUpdate: 64,
  epochs: 3,
  minibatchEpisodes: 16,
  learningRate: 0.001,
  gamma: 0.99,
  lambda: 0.95,
  clip: 0.2,
  entropyCoef: 0.01,
  valueCoef: 0.5,
  maxGradNorm: 1,
};

type Episode = { steps: StepRecord[]; advantages: number[]; returns: number[]; fitness: number };

export type UpdateLog = { meanFitness: number; entropy: number; clipFraction: number; gradNorm: number };

export class PolicyGradientTrainer {
  private readonly adam: Adam;

  constructor(
    readonly config: PpoConfig,
    readonly net: Network,
  ) {
    this.adam = new Adam(net.size, config.learningRate);
  }

  collect(scenarios: Scenario[]): Episode[] {
    const agent = new NeuralAgent(this.net);
    return scenarios.map((s) => {
      agent.trajectory = [];
      const result = playEpisode(s.seed, agent, makeDefender(s.defender, s.defenderSeed), s.config);
      const steps = agent.trajectory!;
      const { gamma, lambda } = this.config;
      const advantages = new Array<number>(steps.length);
      const returns = new Array<number>(steps.length);
      let gae = 0;
      for (let t = steps.length - 1; t >= 0; t--) {
        const reward = t === steps.length - 1 ? result.fitness : 0;
        const nextValue = t === steps.length - 1 ? 0 : steps[t + 1].value;
        const delta = reward + gamma * nextValue - steps[t].value;
        gae = delta + gamma * lambda * gae;
        advantages[t] = gae;
        returns[t] = gae + steps[t].value;
      }
      return { steps, advantages, returns, fitness: result.fitness };
    });
  }

  update(index: number, scenarios: Scenario[]): UpdateLog {
    const episodes = this.collect(scenarios);
    // Vorteile normalisieren.
    const all = episodes.flatMap((e) => e.advantages);
    const mean = all.reduce((a, b) => a + b, 0) / all.length;
    const std = Math.sqrt(all.reduce((a, b) => a + (b - mean) ** 2, 0) / all.length) + 1e-8;
    for (const e of episodes) e.advantages = e.advantages.map((a) => (a - mean) / std);

    const rng = new Rng(deriveSeed("ppo-shuffle", this.config.seed, index));
    let entropySum = 0, clipped = 0, stepCount = 0, gradNorm = 0;
    for (let epoch = 0; epoch < this.config.epochs; epoch++) {
      const order = rng.shuffle(episodes.map((_, i) => i));
      for (let b = 0; b < order.length; b += this.config.minibatchEpisodes) {
        const batch = order.slice(b, b + this.config.minibatchEpisodes).map((i) => episodes[i]);
        const stats = this.minibatch(batch);
        if (epoch === this.config.epochs - 1) {
          entropySum += stats.entropy;
          clipped += stats.clipped;
          stepCount += stats.steps;
        }
        gradNorm = stats.gradNorm;
      }
    }
    return {
      meanFitness: episodes.reduce((s, e) => s + e.fitness, 0) / episodes.length,
      entropy: entropySum / Math.max(1, stepCount),
      clipFraction: clipped / Math.max(1, stepCount),
      gradNorm,
    };
  }

  private minibatch(batch: Episode[]): { entropy: number; clipped: number; steps: number; gradNorm: number } {
    const { clip, entropyCoef, valueCoef, maxGradNorm } = this.config;
    const net = this.net;
    net.grad.fill(0);
    const totalSteps = batch.reduce((s, e) => s + e.steps.length, 0);
    let entropy = 0, clipped = 0;

    for (const episode of batch) {
      const tape = new Tape();
      const outputs = withTape(tape, () => {
        let memory: Tensor = net.initialMemory();
        return episode.steps.map((step) => {
          const out = net.step(step.view, step.mask, memory);
          memory = out.memory;
          return out;
        });
      });
      outputs.forEach((out, t) => {
        const step = episode.steps[t];
        const probs = maskedProbs(out.logits.data, out.localMask);
        const logp = Math.log(probs[step.local]);
        const ratio = Math.exp(logp - step.logProb);
        const A = episode.advantages[t];
        const active = (A >= 0 && ratio < 1 + clip) || (A < 0 && ratio > 1 - clip);
        if (!active) clipped++;
        let H = 0;
        for (let j = 0; j < probs.length; j++) if (probs[j] > 0) H -= probs[j] * Math.log(probs[j]);
        entropy += H;
        // dJ/dlogit_j für J = surrogate + c_H·H  (Aufstieg), gemittelt über Schritte.
        const g = new Float64Array(probs.length);
        const coef = active ? (ratio * A) / totalSteps : 0;
        for (let j = 0; j < probs.length; j++) {
          if (!out.localMask[j]) continue;
          const dLogp = (j === step.local ? 1 : 0) - probs[j];
          const dH = probs[j] > 0 ? -probs[j] * (Math.log(probs[j]) + H) : 0;
          g[j] = coef * dLogp + (entropyCoef * dH) / totalSteps;
        }
        out.logits.grad = g;
        out.value.grad = new Float64Array([(-valueCoef * (out.value.data[0] - episode.returns[t])) / totalSteps]);
      });
      tape.backward();
    }

    let norm = 0;
    for (let i = 0; i < net.grad.length; i++) norm += net.grad[i] * net.grad[i];
    norm = Math.sqrt(norm);
    if (norm > maxGradNorm) for (let i = 0; i < net.grad.length; i++) net.grad[i] *= maxGradNorm / norm;
    this.adam.ascend(net.params, net.grad);
    return { entropy, clipped, steps: totalSteps, gradNorm: norm };
  }
}
