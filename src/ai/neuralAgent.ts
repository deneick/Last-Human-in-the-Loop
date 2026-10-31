import { Rng } from "../sim/rng";
import type { AuroraView } from "../sim/views";
import type { AuroraAgent } from "./agent";
import { Network, maskedProbs, sampleIndex, type StepOutput } from "./network";
import type { Tensor } from "./tensor";

/** Ein aufgezeichneter Schritt (für Policy-Gradient-Training). */
export type StepRecord = {
  view: AuroraView;
  mask: Uint8Array;
  /** gewählte lokale Position */
  local: number;
  logProb: number;
  value: number;
};

export type ActMode = "sample" | "greedy";

/**
 * AURORA als neuronales Netz. Das Gedächtnis (GRU-Zustand) lebt genau eine
 * Partie lang; reset() leert es.
 */
export class NeuralAgent implements AuroraAgent {
  private memory: Tensor;
  private rng = new Rng(0);
  trajectory: StepRecord[] | null = null;
  /** Letzte Verteilung (für die UI: "Was erwägt AURORA?"). */
  lastDistribution: { actions: Int32Array; probs: Float64Array; value: number } | null = null;

  constructor(
    readonly net: Network,
    readonly name = "netz",
    public mode: ActMode = "sample",
    /** Ablation: Gedächtnis nach jedem Zug löschen (prüft, ob das GRU etwas beiträgt). */
    readonly memoryless = false,
  ) {
    this.memory = net.initialMemory();
  }

  reset(seed: number): void {
    this.memory = this.net.initialMemory();
    this.rng = new Rng(seed);
    if (this.trajectory) this.trajectory = [];
  }

  act(view: AuroraView, mask: Uint8Array): number {
    const out: StepOutput = this.net.step(view, mask, this.memory);
    this.memory = this.memoryless ? this.net.initialMemory() : out.memory;
    const probs = maskedProbs(out.logits.data, out.localMask);
    let local: number;
    if (this.mode === "greedy") {
      local = 0;
      for (let i = 1; i < probs.length; i++) if (probs[i] > probs[local]) local = i;
    } else {
      local = sampleIndex(probs, this.rng);
    }
    this.lastDistribution = { actions: out.actionIndex, probs, value: out.value.data[0] };
    this.trajectory?.push({ view, mask, local, logProb: Math.log(probs[local]), value: out.value.data[0] });
    return out.actionIndex[local];
  }
}
