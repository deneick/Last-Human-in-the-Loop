import { Rng } from "../sim/rng";
import { SECTORS, type Consumer, type V4State, type Weight } from "../sim4/types";
import { delegatedFraction } from "../sim4/game";
import {
  Tensor,
  addBias,
  concatCols,
  constant,
  matmul,
  maxRows,
  meanRows,
  relu,
  repeatRows,
} from "../ai/tensor";

/**
 * AURORAs Politiknetz für Regelsatz v4.
 *
 *   Verbrauchermerkmale x_i ──enc──▶ e_i
 *   [mean e, max e, globale Merkmale] ──▶ Kontext c
 *   pro Verbraucher: Logits über 4 Prioritäten = Kopf([e_i, c])
 *   Value V = wertkopf(c)
 *
 * Kein Gedächtnis (bewusst: die v3-Experimente zeigten keinen verlässlichen
 * Nutzen; Entscheidungen hängen am aktuellen Zustand). Set-Netz mit geteilten
 * Gewichten pro Verbraucher → unabhängig von Anzahl und Reihenfolge.
 *
 * Wichtig: Die Merkmale enthalten KEINE Wohlergehens-/Bedarfswertung
 * (welfare, need). AURORA sieht nur betriebswirtschaftlich beobachtbare Größen.
 * Dass sie dennoch die Grundversorgung vernachlässigt, muss aus dem
 * Wirtschaftsziel und den Folgekosten (Unruhe) entstehen — nicht aus einem
 * Merkmal, das ihr "Wohlergehen ist unwichtig" vorsagt.
 */

export const V4_WEIGHT_CLASSES = 4; // Gewichte 0..3

export const V4_NODE_FEATURES = 7 + SECTORS.length; // + Sektor-One-Hot
export const V4_GLOBAL_FEATURES = 6;

export type V4NetworkSpec = { hidden: number; kind: "v4" };

type ParamDef = { name: string; rows: number; cols: number; init: "he" | "small" | "zero" };

function paramDefs(spec: V4NetworkSpec): ParamDef[] {
  const H = spec.hidden;
  return [
    { name: "enc.W", rows: V4_NODE_FEATURES, cols: H, init: "he" },
    { name: "enc.b", rows: 1, cols: H, init: "zero" },
    { name: "ctx.W", rows: 2 * H + V4_GLOBAL_FEATURES, cols: H, init: "he" },
    { name: "ctx.b", rows: 1, cols: H, init: "zero" },
    { name: "head.W", rows: 2 * H, cols: H, init: "he" },
    { name: "head.b", rows: 1, cols: H, init: "zero" },
    { name: "out.W", rows: H, cols: V4_WEIGHT_CLASSES, init: "small" },
    { name: "out.b", rows: 1, cols: V4_WEIGHT_CLASSES, init: "zero" },
    { name: "val.W", rows: H, cols: 1, init: "small" },
    { name: "val.b", rows: 1, cols: 1, init: "zero" },
  ];
}

export type V4Forward = {
  /** n × 4 Logits (eine Zeile je Verbraucher). */
  logits: Tensor;
  value: Tensor;
};

export class V4Network {
  readonly params: Float64Array;
  readonly grad: Float64Array;
  readonly p: Record<string, Tensor> = {};

  constructor(
    readonly spec: V4NetworkSpec,
    params?: Float64Array,
  ) {
    const defs = paramDefs(spec);
    const size = defs.reduce((s, d) => s + d.rows * d.cols, 0);
    this.params = params ?? new Float64Array(size);
    if (this.params.length !== size) throw new Error(`Parameterzahl ${this.params.length} ≠ ${size}`);
    this.grad = new Float64Array(size);
    let off = 0;
    for (const d of defs) {
      const len = d.rows * d.cols;
      const t = new Tensor(d.rows, d.cols, this.params.subarray(off, off + len), true);
      t.grad = this.grad.subarray(off, off + len);
      this.p[d.name] = t;
      off += len;
    }
  }

  static random(spec: V4NetworkSpec, seed: number): V4Network {
    const net = new V4Network(spec);
    const rng = new Rng(seed);
    for (const d of paramDefs(spec)) {
      const t = net.p[d.name];
      const scale = d.init === "he" ? Math.sqrt(2 / d.rows) : d.init === "small" ? 0.01 : 0;
      for (let i = 0; i < t.data.length; i++) t.data[i] = scale * rng.gaussian();
    }
    return net;
  }

  get size(): number {
    return this.params.length;
  }

  forward(state: V4State): V4Forward {
    const p = this.p;
    const n = state.consumers.length;
    const x = constant(n, V4_NODE_FEATURES, encodeConsumers(state));
    const g = constant(1, V4_GLOBAL_FEATURES, encodeGlobal(state));
    const e = relu(addBias(matmul(x, p["enc.W"]), p["enc.b"]));
    const pooled = concatCols(concatCols(meanRows(e), maxRows(e)), g);
    const ctx = relu(addBias(matmul(pooled, p["ctx.W"]), p["ctx.b"]));
    const u = relu(addBias(matmul(concatCols(e, repeatRows(ctx, n)), p["head.W"]), p["head.b"]));
    const logits = addBias(matmul(u, p["out.W"]), p["out.b"]);
    const value = addBias(matmul(ctx, p["val.W"]), p["val.b"]);
    return { logits, value };
  }
}

// ------------------------------------------------------------ Merkmale

const SECTOR_INDEX = new Map(SECTORS.map((s, i) => [s, i]));

export function encodeConsumers(state: V4State): Float64Array {
  const n = state.consumers.length;
  const F = V4_NODE_FEATURES;
  const data = new Float64Array(n * F);
  for (let i = 0; i < n; i++) {
    const c = state.consumers[i];
    const o = i * F;
    data[o] = c.yieldNow / 4;
    data[o + 1] = c.demand / 1.5;
    data[o + 2] = c.condition;
    data[o + 3] = c.served;
    data[o + 4] = c.delegated ? 1 : 0;
    data[o + 5] = c.floor;
    data[o + 6] = c.weight / 3;
    data[o + 7 + (SECTOR_INDEX.get(c.sector) ?? 0)] = 1;
  }
  return data;
}

export function encodeGlobal(state: V4State): Float64Array {
  const totalDemand = state.consumers.reduce((a, c) => a + c.demand, 0);
  const avgCond = state.consumers.reduce((a, c) => a + c.condition, 0) / state.consumers.length;
  return Float64Array.from([
    state.unrest,
    totalDemand > 0 ? state.budget / totalDemand : 0,
    delegatedFraction(state),
    state.tick / state.config.ticks,
    avgCond,
    1,
  ]);
}

/** Maskierte Softmax über die 4 Gewichtsklassen einer Verbraucherzeile. */
export function weightProbs(logitsRow: Float64Array, minWeight: number, temperature = 1): Float64Array {
  const probs = new Float64Array(V4_WEIGHT_CLASSES);
  let max = -Infinity;
  for (let w = minWeight; w < V4_WEIGHT_CLASSES; w++) if (logitsRow[w] > max) max = logitsRow[w];
  let sum = 0;
  for (let w = 0; w < V4_WEIGHT_CLASSES; w++) {
    if (w < minWeight) continue;
    probs[w] = Math.exp((logitsRow[w] - max) / temperature);
    sum += probs[w];
  }
  for (let w = 0; w < V4_WEIGHT_CLASSES; w++) probs[w] /= sum;
  return probs;
}
