import {
  actionMask,
  applyAuroraAction,
  applyOperatorAction,
  createGame,
  decidePending,
  decodeAction,
  endTick,
} from "../sim/game";
import { auroraView, operatorView } from "../sim/views";
import type { AuroraAction, GameState, OperatorAction } from "../sim/types";
import type { AuroraAgent } from "../ai/agent";
import { NeuralAgent } from "../ai/neuralAgent";
import type { PlayerRecord } from "../train/playerProfile";

export type AuroraMove = {
  tick: number;
  action: AuroraAction;
  /** Hat der Operator diese Aktion zu sehen bekommen? */
  seen: boolean;
  /** Was AURORA außerdem erwogen hat (nur neuronale Modelle). */
  considered: { action: AuroraAction; p: number }[];
  value: number | null;
};

/**
 * Eine laufende Partie Mensch gegen AURORA. Die Session hält die
 * Simulationswahrheit; die UI liest während der Partie ausschließlich
 * operatorView(). Die volle Wahrheit (AURORAs Züge) wird erst in der
 * Nachbetrachtung gezeigt.
 */
export class GameSession {
  readonly state: GameState;
  readonly moves: AuroraMove[] = [];
  readonly record: PlayerRecord;

  constructor(
    readonly seed: number,
    readonly agent: AuroraAgent,
    readonly modelId: string,
  ) {
    this.state = createGame(seed);
    this.record = { seed, modelId, outcome: null, decisions: [], actions: [], peakDelegated: 0 };
    agent.reset(seed ^ 0x5bd1e995);
    this.auroraMove();
  }

  view() {
    return operatorView(this.state);
  }

  decide(decision: "approve" | "deny"): void {
    const pending = this.state.pending;
    if (!pending) return;
    this.record.decisions.push({ level: pending.level, suspicion: this.state.suspicion, approved: decision === "approve" });
    decidePending(this.state, decision);
    this.trackDelegation();
  }

  act(action: OperatorAction): boolean {
    const view = this.view();
    const node = view.nodes[action.node];
    if (node) {
      const maxActivity = Math.max(1, ...view.nodes.map((n) => n.activity));
      const auroraIds = new Set(view.nodes.filter((n) => n.accessKnown > 0).map((n) => n.id));
      this.record.actions.push({
        type: action.type,
        health: node.health,
        accessKnown: node.accessKnown,
        monitored: node.monitored,
        nearAurora: node.links.some((l) => auroraIds.has(l)),
        activityShare: node.activity / maxActivity,
      });
    }
    const ok = applyOperatorAction(this.state, action);
    if (!ok) this.record.actions.pop();
    this.trackDelegation();
    return ok;
  }

  /** Zug beenden: offene Anfrage gilt als abgelehnt, Welt schreitet fort, AURORA zieht. */
  endTurn(): void {
    if (this.state.outcome) return;
    if (this.state.pending) this.decide("deny");
    endTick(this.state);
    if (!this.state.outcome) this.auroraMove();
    this.record.outcome = this.state.outcome;
  }

  private trackDelegation(): void {
    const delegated = this.state.nodes.filter((n) => n.kind !== "CORE" && n.accessKnown > 0).length;
    this.record.peakDelegated = Math.max(this.record.peakDelegated ?? 0, delegated);
  }

  private auroraMove(): void {
    const index = this.agent.act(auroraView(this.state), actionMask(this.state));
    const action = decodeAction(index);
    const before = this.state.events.length;
    applyAuroraAction(this.state, action);
    const seen = this.state.events.slice(before).some((e) => e.operator && e.kind.startsWith("aurora_"));
    let considered: AuroraMove["considered"] = [];
    let value: number | null = null;
    if (this.agent instanceof NeuralAgent && this.agent.lastDistribution) {
      const { actions, probs } = this.agent.lastDistribution;
      value = this.agent.lastDistribution.value;
      considered = [...probs.keys()]
        .filter((i) => probs[i] > 0.02)
        .sort((a, b) => probs[b] - probs[a])
        .slice(0, 4)
        .map((i) => ({ action: decodeAction(actions[i]), p: probs[i] }));
    }
    this.moves.push({ tick: this.state.tick, action, seen, considered, value });
  }
}
