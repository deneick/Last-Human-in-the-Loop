import { Rng, deriveSeed } from "../sim/rng";
import { Network, type NetworkSpec } from "../ai/network";
import { NeuralAgent } from "../ai/neuralAgent";
import { makeDefender } from "../sim/defenders";
import { playEpisode } from "./episode";
import { Adam } from "./adam";
import type { Scenario } from "./scenarios";

/**
 * Neuroevolution nach OpenAI-ES (Salimans et al. 2017).
 *
 *   θ  ← Parametervektor des Netzes
 *   pro Generation:
 *     ε_1..ε_P/2 ~ N(0, I)             (aus Seeds → reproduzierbar)
 *     F±_j = Fitness(θ ± σ ε_j)         auf DENSELBEN Szenarien (Varianzreduktion)
 *     Ränge → zentriert in [-0.5, 0.5]  (robust gegen Ausreißer/Skala der Belohnung)
 *     g = Σ_j (r+_j − r−_j) ε_j / (P σ)
 *     θ ← Adam(θ, g)  (+ Weight Decay)
 *
 * Fitness ist der Mittelwert über ganze Partien — kein Credit Assignment pro
 * Schritt nötig. Das passt zu langen Horizonten und dünner Belohnung (Sieg
 * erst nach ~20–40 Zügen).
 */
export type EsConfig = {
  seed: number;
  generations: number;
  /** Gerade Zahl (antithetische Paare). */
  population: number;
  sigma: number;
  learningRate: number;
  weightDecay: number;
  episodesPerMember: number;
  spec: NetworkSpec;
};

export const DEFAULT_ES: EsConfig = {
  seed: 1,
  generations: 150,
  population: 48,
  sigma: 0.04,
  learningRate: 0.03,
  weightDecay: 0.005,
  episodesPerMember: 16,
  spec: { hidden: 32 },
};

/** Bewertet viele Parametervektoren auf denselben Szenarien (ggf. parallel). */
export type PopulationEvaluator = (spec: NetworkSpec, members: Float64Array[], scenarios: Scenario[]) => Promise<number[]>;

export function evaluateMember(spec: NetworkSpec, params: Float64Array, scenarios: Scenario[]): number {
  const agent = new NeuralAgent(new Network(spec, params));
  let sum = 0;
  for (const s of scenarios) sum += playEpisode(s.seed, agent, makeDefender(s.defender, s.defenderSeed), s.config).fitness;
  return sum / scenarios.length;
}

export const serialEvaluator: PopulationEvaluator = async (spec, members, scenarios) =>
  members.map((m) => evaluateMember(spec, m, scenarios));

export type GenerationLog = {
  generation: number;
  meanFitness: number;
  bestFitness: number;
  gradNorm: number;
  paramNorm: number;
};

export class EvolutionStrategy {
  readonly theta: Float64Array;
  private readonly adam: Adam;

  constructor(
    readonly config: EsConfig,
    initial: Float64Array,
  ) {
    if (config.population % 2 !== 0) throw new Error("population muss gerade sein");
    this.theta = Float64Array.from(initial);
    this.adam = new Adam(this.theta.length, config.learningRate);
  }

  noise(generation: number, pair: number): Float64Array {
    const rng = new Rng(deriveSeed("es-noise", this.config.seed, generation, pair));
    const eps = new Float64Array(this.theta.length);
    for (let i = 0; i < eps.length; i++) eps[i] = rng.gaussian();
    return eps;
  }

  async generation(generation: number, scenarios: Scenario[], evaluate: PopulationEvaluator): Promise<GenerationLog> {
    const { population, sigma, weightDecay } = this.config;
    const pairs = population / 2;
    const noises: Float64Array[] = [];
    const members: Float64Array[] = [];
    for (let j = 0; j < pairs; j++) {
      const eps = this.noise(generation, j);
      noises.push(eps);
      const plus = new Float64Array(this.theta.length);
      const minus = new Float64Array(this.theta.length);
      for (let i = 0; i < eps.length; i++) {
        plus[i] = this.theta[i] + sigma * eps[i];
        minus[i] = this.theta[i] - sigma * eps[i];
      }
      members.push(plus, minus);
    }
    const fitness = await evaluate(this.config.spec, members, scenarios);
    const ranks = centeredRanks(fitness);

    const grad = new Float64Array(this.theta.length);
    for (let j = 0; j < pairs; j++) {
      const w = ranks[2 * j] - ranks[2 * j + 1];
      if (w === 0) continue;
      const eps = noises[j];
      for (let i = 0; i < grad.length; i++) grad[i] += w * eps[i];
    }
    let gradNorm = 0;
    for (let i = 0; i < grad.length; i++) {
      grad[i] = grad[i] / (population * sigma) - weightDecay * this.theta[i];
      gradNorm += grad[i] * grad[i];
    }
    this.adam.ascend(this.theta, grad);

    return {
      generation,
      meanFitness: fitness.reduce((a, b) => a + b, 0) / fitness.length,
      bestFitness: Math.max(...fitness),
      gradNorm: Math.sqrt(gradNorm),
      paramNorm: Math.sqrt(this.theta.reduce((s, v) => s + v * v, 0)),
    };
  }
}

/** Ränge → gleichmäßig in [-0.5, 0.5]; Gleichstände bekommen den mittleren Rang. */
export function centeredRanks(values: number[]): number[] {
  const n = values.length;
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && order[j + 1][0] === order[i][0]) j++;
    const r = (i + j) / 2;
    for (let k = i; k <= j; k++) ranks[order[k][1]] = r;
    i = j + 1;
  }
  return ranks.map((r) => (n === 1 ? 0 : r / (n - 1) - 0.5));
}
