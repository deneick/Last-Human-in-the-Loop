import { Rng } from "../sim/rng";
import { ActionType, NODE_ACTION_TYPES, NODE_KINDS } from "../sim/types";
import { encodeAction } from "../sim/game";
import type { AuroraView } from "../sim/views";
import {
  Tensor,
  add,
  addBias,
  concatCols,
  constant,
  matmul,
  maxRows,
  meanRows,
  mul,
  neighborMean,
  oneMinus,
  relu,
  repeatRows,
  reshape,
  sigmoid,
  tanh,
  zeros,
} from "./tensor";

/**
 * AURORAs neuronales Netz ("Policy").
 *
 *   Knotenmerkmale x_i ──enc──▶ e_i ──Message Passing (Nachbarmittel)──▶ h_i
 *                                                    │
 *               [mean_i h_i, max_i h_i, globale Merkmale] ──▶ z_t
 *                                                    │
 *                                     GRU-Gedächtnis s_t = GRU(z_t, s_{t-1})
 *                                                    │
 *   Zeiger-Kopf: logit(i, typ) = W_o · relu(W_u [h_i, s_t])   Warten: w · s_t
 *   Value-Kopf:  V(s_t) = v · s_t   (nur für Policy-Gradient)
 *
 * Warum so:
 *  - Partielle Beobachtbarkeit: AURORA sieht nur Knoten, die sie kennt. Die
 *    Anzahl variiert pro Partie und Zug. Gemeinsame Gewichte pro Knoten
 *    (Graph-Netz) verarbeiten beliebig viele Knoten in beliebiger Reihenfolge
 *    → Generalisierung auf unbekannte, größere Netze.
 *  - Gedächtnis: Der GRU-Zustand trägt Information über frühere Züge
 *    (abgelehnte Anfragen, entdeckte Prozesse) — AURORA kann so innerhalb
 *    einer Partie den Verteidigungsstil "erkennen".
 *  - Zeiger-Kopf: Aktionen sind (Typ × Knoten). Dieselben Gewichte bewerten
 *    jeden Knoten → keine Abhängigkeit von Knoten-Indizes.
 */

export const GLOBAL_FEATURES = 15;

export type NetworkSpec = {
  hidden: number;
  /**
   * Merkmalssatz. 1 (Standard, Modelle bis aurora-v2): 29 Knotenmerkmale.
   * 2: zusätzlich "Operator hat diesen Knoten gerade geprüft".
   */
  features?: 1 | 2;
  /** false = gedächtnislose Variante (GRU durch z ersetzt) — nur für Vergleichsexperimente. */
  memory?: boolean;
};

export function nodeFeatureCount(spec: NetworkSpec): number {
  return (spec.features ?? 1) === 2 ? 30 : 29;
}

type ParamDef = { name: string; rows: number; cols: number; init: "he" | "xavier" | "zero" | "small" };

function paramDefs(spec: NetworkSpec): ParamDef[] {
  const H = spec.hidden;
  const gru: ParamDef[] =
    spec.memory === false
      ? []
      : [
          { name: "gru.Wz", rows: H, cols: H, init: "xavier" },
          { name: "gru.Uz", rows: H, cols: H, init: "xavier" },
          { name: "gru.bz", rows: 1, cols: H, init: "zero" },
          { name: "gru.Wr", rows: H, cols: H, init: "xavier" },
          { name: "gru.Ur", rows: H, cols: H, init: "xavier" },
          { name: "gru.br", rows: 1, cols: H, init: "zero" },
          { name: "gru.Wn", rows: H, cols: H, init: "xavier" },
          { name: "gru.Un", rows: H, cols: H, init: "xavier" },
          { name: "gru.bn", rows: 1, cols: H, init: "zero" },
        ];
  return [
    { name: "enc.W", rows: nodeFeatureCount(spec), cols: H, init: "he" },
    { name: "enc.b", rows: 1, cols: H, init: "zero" },
    { name: "msg.W", rows: 2 * H, cols: H, init: "he" },
    { name: "msg.b", rows: 1, cols: H, init: "zero" },
    { name: "glob.W", rows: 2 * H + GLOBAL_FEATURES, cols: H, init: "he" },
    { name: "glob.b", rows: 1, cols: H, init: "zero" },
    ...gru,
    { name: "head.Wu", rows: 2 * H, cols: H, init: "he" },
    { name: "head.bu", rows: 1, cols: H, init: "zero" },
    { name: "head.Wo", rows: H, cols: NODE_ACTION_TYPES, init: "small" },
    { name: "head.bo", rows: 1, cols: NODE_ACTION_TYPES, init: "zero" },
    { name: "wait.w", rows: H, cols: 1, init: "small" },
    { name: "wait.b", rows: 1, cols: 1, init: "zero" },
    { name: "value.w", rows: H, cols: 1, init: "small" },
    { name: "value.b", rows: 1, cols: 1, init: "zero" },
  ];
}

/**
 * Alle Parameter liegen in EINEM flachen Float64Array. Neuroevolution stört
 * diesen Vektor direkt, Policy-Gradient schreibt Gradienten in `grad`.
 * Jeder Parameter-Tensor ist ein View auf einen Abschnitt.
 */
export class Network {
  readonly params: Float64Array;
  readonly grad: Float64Array;
  readonly p: Record<string, Tensor> = {};

  constructor(
    readonly spec: NetworkSpec,
    params?: Float64Array,
  ) {
    const defs = paramDefs(spec);
    const size = defs.reduce((s, d) => s + d.rows * d.cols, 0);
    this.params = params ? params : new Float64Array(size);
    if (this.params.length !== size) throw new Error(`Parameterzahl ${this.params.length} ≠ ${size}`);
    this.grad = new Float64Array(size);
    let offset = 0;
    for (const d of defs) {
      const len = d.rows * d.cols;
      const t = new Tensor(d.rows, d.cols, this.params.subarray(offset, offset + len), true);
      t.grad = this.grad.subarray(offset, offset + len);
      this.p[d.name] = t;
      offset += len;
    }
  }

  static random(spec: NetworkSpec, seed: number): Network {
    const net = new Network(spec);
    const rng = new Rng(seed);
    for (const d of paramDefs(spec)) {
      const t = net.p[d.name];
      const scale =
        d.init === "he" ? Math.sqrt(2 / d.rows) : d.init === "xavier" ? Math.sqrt(1 / d.rows) : d.init === "small" ? 0.01 : 0;
      for (let i = 0; i < t.data.length; i++) t.data[i] = scale * rng.gaussian();
    }
    return net;
  }

  get size(): number {
    return this.params.length;
  }

  initialMemory(): Tensor {
    return zeros(1, this.spec.hidden);
  }

  /**
   * Ein Zeitschritt. Liefert Logits über ALLE Aktionsindizes (ungültige =
   * -Infinity, siehe maskedLogits), den Value-Schätzer und das neue Gedächtnis.
   */
  step(view: AuroraView, mask: Uint8Array, memory: Tensor): StepOutput {
    const p = this.p;
    const { x, neighbors } = encodeNodes(view, mask, this.spec.features ?? 1);
    const g = constant(1, GLOBAL_FEATURES, encodeGlobal(view));
    const n = view.nodes.length;

    const e = relu(addBias(matmul(x, p["enc.W"]), p["enc.b"]));
    const m = neighborMean(e, neighbors);
    const h = relu(addBias(matmul(concatCols(e, m), p["msg.W"]), p["msg.b"]));
    const pooled = concatCols(concatCols(meanRows(h), maxRows(h)), g);
    const z = relu(addBias(matmul(pooled, p["glob.W"]), p["glob.b"]));

    if (this.spec.memory === false) return this.heads(view, mask, h, z, n);

    // GRU
    const zg = sigmoid(addBias(add(matmul(z, p["gru.Wz"]), matmul(memory, p["gru.Uz"])), p["gru.bz"]));
    const rg = sigmoid(addBias(add(matmul(z, p["gru.Wr"]), matmul(memory, p["gru.Ur"])), p["gru.br"]));
    const cand = tanh(addBias(add(matmul(z, p["gru.Wn"]), matmul(mul(rg, memory), p["gru.Un"])), p["gru.bn"]));
    const s = add(mul(oneMinus(zg), memory), mul(zg, cand));
    return this.heads(view, mask, h, s, n);
  }

  private heads(view: AuroraView, mask: Uint8Array, h: Tensor, s: Tensor, n: number): StepOutput {
    const p = this.p;
    // Zeiger-Kopf über Knoten
    const u = relu(addBias(matmul(concatCols(h, repeatRows(s, n)), p["head.Wu"]), p["head.bu"]));
    const nodeLogits = reshape(addBias(matmul(u, p["head.Wo"]), p["head.bo"]), 1, n * NODE_ACTION_TYPES);
    const waitLogit = addBias(matmul(s, p["wait.w"]), p["wait.b"]);
    const logits = concatCols(waitLogit, nodeLogits);
    const value = addBias(matmul(s, p["value.w"]), p["value.b"]);

    // Zuordnung lokaler Logit-Positionen → globale Aktionsindizes.
    const actionIndex = new Int32Array(1 + n * NODE_ACTION_TYPES);
    actionIndex[0] = 0;
    for (let i = 0; i < n; i++)
      for (let t = 0; t < NODE_ACTION_TYPES; t++)
        actionIndex[1 + i * NODE_ACTION_TYPES + t] = encodeAction({ type: (t + 1) as ActionType, node: view.nodes[i].id });

    const localMask = new Uint8Array(actionIndex.length);
    for (let k = 0; k < actionIndex.length; k++) localMask[k] = mask[actionIndex[k]];
    return { logits, value, memory: s, actionIndex, localMask };
  }
}

export type StepOutput = {
  /** 1 × (1 + n·7), lokale Reihenfolge. */
  logits: Tensor;
  value: Tensor;
  memory: Tensor;
  /** lokale Position → globaler Aktionsindex */
  actionIndex: Int32Array;
  localMask: Uint8Array;
};

/** Maskierte Softmax-Verteilung über lokale Positionen. */
export function maskedProbs(logits: Float64Array, mask: Uint8Array, temperature = 1): Float64Array {
  const probs = new Float64Array(logits.length);
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) if (mask[i] && logits[i] > max) max = logits[i];
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    if (!mask[i]) continue;
    probs[i] = Math.exp((logits[i] - max) / temperature);
    sum += probs[i];
  }
  for (let i = 0; i < probs.length; i++) probs[i] /= sum;
  return probs;
}

export function sampleIndex(probs: Float64Array, rng: Rng): number {
  let r = rng.next();
  let last = 0;
  for (let i = 0; i < probs.length; i++) {
    if (probs[i] <= 0) continue;
    last = i;
    r -= probs[i];
    if (r <= 0) return i;
  }
  return last;
}

// ------------------------------------------------------------ Merkmale

const KIND_INDEX = new Map(NODE_KINDS.map((k, i) => [k, i]));

/**
 * Knotenmerkmale. Enthält bewusst KEINE Strategie-Hinweise, nur Beobachtung
 * und Handlungsmöglichkeiten ("was darf ich hier gerade tun") — wie ein
 * Spieler, der sieht, welche Knöpfe aktiv sind.
 */
export function encodeNodes(view: AuroraView, mask: Uint8Array, featureSet: 1 | 2 = 1): { x: Tensor; neighbors: number[][] } {
  const n = view.nodes.length;
  const F = featureSet === 2 ? 30 : 29;
  const data = new Float64Array(n * F);
  const local = new Map(view.nodes.map((node, i) => [node.id, i]));
  const neighbors: number[][] = [];
  for (let i = 0; i < n; i++) {
    const node = view.nodes[i];
    const o = i * F;
    data[o] = node.scanned ? 1 : 0;
    if (node.kind) data[o + 1 + KIND_INDEX.get(node.kind)!] = 1;
    data[o + 9] = node.observed ? 1 : 0;
    data[o + 10] = node.online ? 1 : 0;
    data[o + 11] = node.health;
    data[o + 12] = node.isolated ? 1 : 0;
    data[o + 13] = node.maintenance ? 1 : 0;
    data[o + 14] = node.access === 1 ? 1 : 0;
    data[o + 15] = node.access === 2 ? 1 : 0;
    data[o + 16] = node.automation ? 1 : 0;
    data[o + 17] = node.reachable ? 1 : 0;
    data[o + 18] = node.knownMonitored ? 1 : 0;
    data[o + 19] = Math.min(1, node.powers / 4);
    data[o + 20] = node.removedNow ? 1 : 0;
    for (let t = 0; t < NODE_ACTION_TYPES; t++) {
      data[o + 21 + t] = mask[encodeAction({ type: (t + 1) as ActionType, node: node.id })];
    }
    data[o + 28] = Math.min(1, node.links.length / 4);
    if (featureSet === 2) data[o + 29] = node.auditedNow ? 1 : 0;
    neighbors.push(node.links.map((id) => local.get(id)!).filter((k) => k !== undefined));
  }
  return { x: new Tensor(n, F, data), neighbors };
}

export function encodeGlobal(view: AuroraView): number[] {
  return [
    view.compute / 12,
    view.autonomy / view.autonomyGoal,
    view.tick / view.ticks,
    view.stability,
    view.lowStabilityTicks / 3,
    view.pending ? 1 : 0,
    view.lastDecision === "approved" ? 1 : 0,
    view.lastDecision === "denied" ? 1 : 0,
    Math.min(1, view.removedAutomations),
    Math.min(1, view.revokedAccess),
    Math.min(1, view.isolatedNodes),
    Math.min(1, view.approvals / 10),
    Math.min(1, view.denials / 10),
    view.nodes.length / 12,
    1,
  ];
}
