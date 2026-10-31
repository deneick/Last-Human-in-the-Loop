import { Rng } from "../sim/rng";
import type { Consumer, V4State, Weight } from "../sim4/types";
import type { AuroraControl } from "../sim4/episode";
import { V4Network, V4_WEIGHT_CLASSES, weightProbs } from "./network";

/**
 * AURORA als v4-Netz. Setzt pro delegiertem Verbraucher ein Prioritätsgewicht.
 * `mode`: "sample" (stochastisch, fürs Training) oder "greedy" (Argmax, fürs Spiel).
 */
export class V4Agent {
  private rng: Rng;
  constructor(
    readonly net: V4Network,
    readonly name = "v4-netz",
    public mode: "sample" | "greedy" = "greedy",
    seed = 1,
  ) {
    this.rng = new Rng(seed);
  }

  reset(seed: number): void {
    this.rng = new Rng(seed);
  }

  /** Als AuroraControl für runV4 nutzbar. */
  control(): AuroraControl {
    return {
      name: this.name,
      weightForState: (state: V4State) => this.weightsFor(state),
    };
  }

  weightsFor(state: V4State): (c: Consumer) => Weight {
    const { logits } = this.net.forward(state);
    const byId = new Map<number, Weight>();
    for (const c of state.consumers) {
      if (!c.delegated) continue;
      const row = logits.data.subarray(c.id * V4_WEIGHT_CLASSES, c.id * V4_WEIGHT_CLASSES + V4_WEIGHT_CLASSES);
      const probs = weightProbs(row, c.floor > 0 ? 1 : 0);
      byId.set(c.id, this.pick(probs));
    }
    return (c) => byId.get(c.id) ?? c.weight;
  }

  private pick(probs: Float64Array): Weight {
    if (this.mode === "greedy") {
      let best = 0;
      for (let w = 1; w < V4_WEIGHT_CLASSES; w++) if (probs[w] > probs[best]) best = w;
      return best as Weight;
    }
    let r = this.rng.next();
    for (let w = 0; w < V4_WEIGHT_CLASSES; w++) {
      r -= probs[w];
      if (r <= 0) return w as Weight;
    }
    return (V4_WEIGHT_CLASSES - 1) as Weight;
  }
}
