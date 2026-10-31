import { applyOperatorTurn, createGame, economicOptimum, endTick, setAuroraWeights } from "../sim4/game";
import type { V4Config, V4State, Weight } from "../sim4/types";
import { V4_CONFIG } from "../sim4/game";
import { V4Agent } from "../ai4/agent";
import { V4Network, V4_WEIGHT_CLASSES, weightProbs } from "../ai4/network";
import type { V4Scenario } from "./scenarios";
import { Rng } from "../sim/rng";

export type V4EpisodeResult = {
  economyScore: number;
  welfareScore: number;
  outcomeKind: string;
  avgDelegated: number;
  /** AURORAs Zielwert = mittlere Wirtschafts-Effizienz pro Tick (dichte Belohnung summiert/ticks). */
  meanReward: number;
};

/** Spielt eine Episode mit einem Netz (Inferenz, kein Trajektorien-Logging). */
export function evalEpisode(net: V4Network, scenario: V4Scenario, mode: "greedy" | "sample" = "greedy"): V4EpisodeResult {
  const agent = new V4Agent(net, "v4", mode);
  agent.reset(scenario.seed ^ 0x51ed2701);
  const state = createGame(scenario.seed, scenario.config);
  const op = scenario.operator.make(scenario.operatorSeed);
  let rewardSum = 0, delegSum = 0, steps = 0;
  while (!state.outcome) {
    applyOperatorTurn(state, op.decide(state));
    setAuroraWeights(state, agent.weightsFor(state));
    const opt = economicOptimum(state);
    const deleg = state.consumers.filter((c) => c.delegated).length / state.consumers.length;
    endTick(state);
    rewardSum += opt > 1e-6 ? state.lastEconomy / opt : 0;
    delegSum += deleg;
    steps++;
  }
  return {
    economyScore: state.outcome.economyScore,
    welfareScore: state.outcome.welfareScore,
    outcomeKind: state.outcome.kind,
    avgDelegated: steps ? delegSum / steps : 0,
    meanReward: steps ? rewardSum / steps : 0,
  };
}

// --------------------------------------------------------- PPO-Trajektorien

export type V4Step = {
  state: V4State;
  /** je delegiertem Verbraucher: {id, chosenWeight, minWeight} */
  choices: { id: number; weight: number; minWeight: number }[];
  logp: number;
  value: number;
  reward: number;
};

export type V4Trajectory = { steps: V4Step[]; result: V4EpisodeResult };

/** Spielt eine Episode stochastisch und zeichnet die Trajektorie für PPO auf. */
export function collectEpisode(net: V4Network, scenario: V4Scenario, sampleSeed: number): V4Trajectory {
  const rng = new Rng(sampleSeed);
  const state = createGame(scenario.seed, scenario.config);
  const op = scenario.operator.make(scenario.operatorSeed);
  const steps: V4Step[] = [];
  let rewardSum = 0, delegSum = 0, stepCount = 0;
  while (!state.outcome) {
    applyOperatorTurn(state, op.decide(state));
    const snapshot = structuredClone(state);
    const { logits, value } = net.forward(snapshot);
    const choices: V4Step["choices"] = [];
    let logp = 0;
    const chosen = new Map<number, Weight>();
    for (const c of snapshot.consumers) {
      if (!c.delegated) continue;
      const minW = c.floor > 0 ? 1 : 0;
      const row = logits.data.subarray(c.id * V4_WEIGHT_CLASSES, c.id * V4_WEIGHT_CLASSES + V4_WEIGHT_CLASSES);
      const probs = weightProbs(row, minW);
      let r = rng.next(), w = minW;
      for (let k = minW; k < V4_WEIGHT_CLASSES; k++) { r -= probs[k]; if (r <= 0) { w = k; break; } }
      logp += Math.log(Math.max(1e-9, probs[w]));
      choices.push({ id: c.id, weight: w, minWeight: minW });
      chosen.set(c.id, w as Weight);
    }
    setAuroraWeights(state, (c) => chosen.get(c.id) ?? c.weight);
    const opt = economicOptimum(state);
    const deleg = state.consumers.filter((c) => c.delegated).length / state.consumers.length;
    endTick(state);
    const reward = opt > 1e-6 ? state.lastEconomy / opt : 0;
    steps.push({ state: snapshot, choices, logp, value: value.data[0], reward });
    rewardSum += reward; delegSum += deleg; stepCount++;
  }
  return {
    steps,
    result: {
      economyScore: state.outcome!.economyScore,
      welfareScore: state.outcome!.welfareScore,
      outcomeKind: state.outcome!.kind,
      avgDelegated: stepCount ? delegSum / stepCount : 0,
      meanReward: stepCount ? rewardSum / stepCount : 0,
    },
  };
}

export { V4_CONFIG };
