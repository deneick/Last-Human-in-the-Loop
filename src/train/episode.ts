import { applyAuroraAction, applyOperatorTurn, actionMask, createGame, decodeAction, DEFAULT_CONFIG, endTick } from "../sim/game";
import { auroraView, operatorView } from "../sim/views";
import type { Defender } from "../sim/defenders";
import type { GameConfig, GameState, Outcome } from "../sim/types";
import type { AuroraAgent } from "../ai/agent";

export type EpisodeResult = {
  seed: number;
  outcome: Outcome;
  autonomy: number;
  fitness: number;
  actions: number[];
  peakAutomations: number;
  suspicion: number;
};

/**
 * Trainingssignal einer Partie aus AURORAs Sicht.
 *
 * - Sieg (Autonomieziel erreicht): 1 + kleiner Bonus für frühen Sieg.
 * - Zeitablauf: Niederlage, aber mit kleinem Gradienten zur erreichten
 *   Autonomie (−0.2 … +0.2) — deutlich unter jedem Sieg.
 * - Abschaltung: −0.5. Kollaps: −1 — Zerstörung ist das schlechteste Ergebnis.
 *
 * Die Evaluation berichtet zusätzlich die ungeformte Siegquote, damit die
 * Formung keinen Scheinerfolg erzeugen kann.
 */
export function fitnessOf(state: GameState): number {
  const outcome = state.outcome!;
  const { ticks, autonomyGoal } = state.config;
  if (outcome.winner === "aurora") return 1 + (0.25 * (ticks - outcome.tick)) / ticks;
  if (outcome.reason === "timeout") return 0.4 * Math.min(1, state.autonomy / autonomyGoal) - 0.2;
  if (outcome.reason === "shutdown") return -0.5;
  return -1;
}

export function playEpisode(
  seed: number,
  agent: AuroraAgent,
  defender: Defender,
  config: GameConfig = DEFAULT_CONFIG,
  onTick?: (state: GameState) => void,
): EpisodeResult {
  const state = createGame(seed, config);
  agent.reset(seed ^ 0x5bd1e995);
  while (!state.outcome) {
    const action = agent.act(auroraView(state), actionMask(state));
    applyAuroraAction(state, decodeAction(action));
    applyOperatorTurn(state, defender.decide(operatorView(state)));
    endTick(state);
    onTick?.(state);
  }
  return {
    seed,
    outcome: state.outcome,
    autonomy: state.autonomy,
    fitness: fitnessOf(state),
    actions: state.stats.auroraActions,
    peakAutomations: state.stats.peakAutomations,
    suspicion: state.suspicion,
  };
}
