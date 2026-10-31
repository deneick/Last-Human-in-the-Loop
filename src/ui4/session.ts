import { applyOperatorAction, createGame, delegatedFraction, endTick, setAuroraWeights, V4_CONFIG } from "../sim4/game";
import type { OperatorAction, V4Config, V4State } from "../sim4/types";
import type { V4Agent } from "../ai4/agent";

/** Eine laufende v4-Partie Mensch gegen eine trainierte AURORA. */
export class V4Session {
  readonly state: V4State;
  constructor(readonly seed: number, readonly agent: V4Agent, readonly config: V4Config = V4_CONFIG) {
    this.state = createGame(seed, config);
  }
  do(action: OperatorAction): boolean {
    return applyOperatorAction(this.state, action);
  }
  /** Tick abschließen: AURORA setzt die Gewichte ihrer delegierten Verbraucher, dann schreitet die Welt fort. */
  endTurn(): void {
    if (this.state.outcome) return;
    setAuroraWeights(this.state, this.agent.weightsFor(this.state));
    endTick(this.state);
  }
  delegatedFraction(): number {
    return delegatedFraction(this.state);
  }
}
