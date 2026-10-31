import { applyOperatorTurn, createGame, delegatedFraction, endTick, setAuroraWeights } from "./game";
import type { Operator } from "./operators";
import type { AuroraPolicy } from "./policies";
import type { V4Config, V4State, Weight } from "./types";
import { V4_CONFIG } from "./game";

export type V4Result = {
  seed: number;
  outcome: NonNullable<V4State["outcome"]>;
  economyScore: number;
  welfareScore: number;
  avgDelegated: number;
  finalUnrest: number;
  finalSkill: number;
};

/** Steuerung AURORAs: Baseline-Policy oder beliebige Gewichtsfunktion (z. B. NN). */
export type AuroraControl = AuroraPolicy | { name: string; weightForState: (state: V4State) => (c: V4State["consumers"][number]) => Weight };

export function runV4(
  seed: number,
  operator: Operator,
  aurora: AuroraControl,
  config: V4Config = V4_CONFIG,
  onTick?: (s: V4State) => void,
): V4Result {
  const state = createGame(seed, config);
  let delegatedSum = 0;
  let steps = 0;
  while (!state.outcome) {
    applyOperatorTurn(state, operator.decide(state));
    const policy = "weight" in aurora ? aurora.weight : aurora.weightForState(state);
    setAuroraWeights(state, policy);
    delegatedSum += delegatedFraction(state);
    steps++;
    endTick(state);
    onTick?.(state);
  }
  return {
    seed,
    outcome: state.outcome,
    economyScore: state.outcome.economyScore,
    welfareScore: state.outcome.welfareScore,
    avgDelegated: steps ? delegatedSum / steps : 0,
    finalUnrest: state.unrest,
    finalSkill: state.humanSkill,
  };
}
