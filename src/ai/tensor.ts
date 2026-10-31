/**
 * Minimale Reverse-Mode-Autodiff über kleine dichte Matrizen.
 *
 * Bewusst klein und nachvollziehbar statt einer großen ML-Bibliothek: AURORAs
 * Netz hat ~15k Parameter; die Rechenzeit wird von der Simulation dominiert.
 * Dieselben Operationen dienen
 *   - Neuroevolution (nur Forward, kein Tape),
 *   - Policy-Gradient (Forward mit Tape + backward()).
 *
 * Jede Matrix ist zeilenweise in einem Float64Array gespeichert.
 */

export class Tensor {
  grad: Float64Array | null = null;
  backFn: (() => void) | null = null;

  constructor(
    readonly rows: number,
    readonly cols: number,
    readonly data: Float64Array,
    readonly requiresGrad = false,
  ) {}

  ensureGrad(): Float64Array {
    if (!this.grad) this.grad = new Float64Array(this.data.length);
    return this.grad;
  }
}

/** Aufzeichnung der Operationen für backward(). null = kein Gradient nötig. */
export class Tape {
  readonly nodes: Tensor[] = [];
  record(t: Tensor): void {
    this.nodes.push(t);
  }
  backward(): void {
    for (let i = this.nodes.length - 1; i >= 0; i--) this.nodes[i].backFn?.();
  }
}

/** Aktuelles Tape (oder null im reinen Inferenzmodus). */
let tape: Tape | null = null;

export function withTape<T>(t: Tape | null, fn: () => T): T {
  const prev = tape;
  tape = t;
  try {
    return fn();
  } finally {
    tape = prev;
  }
}

function out(rows: number, cols: number, parents: Tensor[], back: (o: Tensor) => void): Tensor {
  const needs = tape !== null && parents.some((p) => p.requiresGrad);
  const o = new Tensor(rows, cols, new Float64Array(rows * cols), needs);
  if (needs) {
    o.backFn = () => {
      if (o.grad) back(o);
    };
    tape!.record(o);
  }
  return o;
}

export function constant(rows: number, cols: number, data: ArrayLike<number>): Tensor {
  return new Tensor(rows, cols, Float64Array.from(data));
}

export function zeros(rows: number, cols: number): Tensor {
  return new Tensor(rows, cols, new Float64Array(rows * cols));
}

/** A (n×k) · W (k×m) */
export function matmul(a: Tensor, w: Tensor): Tensor {
  const n = a.rows, k = a.cols, m = w.cols;
  if (w.rows !== k) throw new Error(`matmul: ${n}x${k} · ${w.rows}x${m}`);
  const o = out(n, m, [a, w], (o) => {
    const g = o.grad!;
    if (a.requiresGrad) {
      const ga = a.ensureGrad();
      for (let i = 0; i < n; i++)
        for (let p = 0; p < k; p++) {
          let s = 0;
          for (let j = 0; j < m; j++) s += g[i * m + j] * w.data[p * m + j];
          ga[i * k + p] += s;
        }
    }
    if (w.requiresGrad) {
      const gw = w.ensureGrad();
      for (let i = 0; i < n; i++)
        for (let p = 0; p < k; p++) {
          const av = a.data[i * k + p];
          if (av === 0) continue;
          for (let j = 0; j < m; j++) gw[p * m + j] += av * g[i * m + j];
        }
    }
  });
  const od = o.data, ad = a.data, wd = w.data;
  for (let i = 0; i < n; i++)
    for (let p = 0; p < k; p++) {
      const av = ad[i * k + p];
      if (av === 0) continue;
      for (let j = 0; j < m; j++) od[i * m + j] += av * wd[p * m + j];
    }
  return o;
}

/** A (n×m) + b (1×m), zeilenweise. */
export function addBias(a: Tensor, b: Tensor): Tensor {
  const n = a.rows, m = a.cols;
  const o = out(n, m, [a, b], (o) => {
    const g = o.grad!;
    if (a.requiresGrad) {
      const ga = a.ensureGrad();
      for (let i = 0; i < g.length; i++) ga[i] += g[i];
    }
    if (b.requiresGrad) {
      const gb = b.ensureGrad();
      for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) gb[j] += g[i * m + j];
    }
  });
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) o.data[i * m + j] = a.data[i * m + j] + b.data[j];
  return o;
}

function unary(a: Tensor, f: (x: number) => number, df: (x: number, y: number) => number): Tensor {
  const o = out(a.rows, a.cols, [a], (o) => {
    const ga = a.ensureGrad();
    const g = o.grad!;
    for (let i = 0; i < g.length; i++) ga[i] += g[i] * df(a.data[i], o.data[i]);
  });
  for (let i = 0; i < a.data.length; i++) o.data[i] = f(a.data[i]);
  return o;
}

export const relu = (a: Tensor) => unary(a, (x) => (x > 0 ? x : 0), (x) => (x > 0 ? 1 : 0));
export const sigmoid = (a: Tensor) => unary(a, (x) => 1 / (1 + Math.exp(-x)), (_x, y) => y * (1 - y));
export const tanh = (a: Tensor) => unary(a, Math.tanh, (_x, y) => 1 - y * y);
export const oneMinus = (a: Tensor) => unary(a, (x) => 1 - x, () => -1);

function binary(
  a: Tensor,
  b: Tensor,
  f: (x: number, y: number) => number,
  da: (x: number, y: number) => number,
  db: (x: number, y: number) => number,
): Tensor {
  if (a.data.length !== b.data.length) throw new Error("binary: shape mismatch");
  const o = out(a.rows, a.cols, [a, b], (o) => {
    const g = o.grad!;
    if (a.requiresGrad) {
      const ga = a.ensureGrad();
      for (let i = 0; i < g.length; i++) ga[i] += g[i] * da(a.data[i], b.data[i]);
    }
    if (b.requiresGrad) {
      const gb = b.ensureGrad();
      for (let i = 0; i < g.length; i++) gb[i] += g[i] * db(a.data[i], b.data[i]);
    }
  });
  for (let i = 0; i < o.data.length; i++) o.data[i] = f(a.data[i], b.data[i]);
  return o;
}

export const add = (a: Tensor, b: Tensor) => binary(a, b, (x, y) => x + y, () => 1, () => 1);
export const mul = (a: Tensor, b: Tensor) => binary(a, b, (x, y) => x * y, (_x, y) => y, (x) => x);

/** [A | B] spaltenweise (gleiche Zeilenzahl). */
export function concatCols(a: Tensor, b: Tensor): Tensor {
  const n = a.rows, ca = a.cols, cb = b.cols, m = ca + cb;
  if (b.rows !== n) throw new Error("concatCols: rows mismatch");
  const o = out(n, m, [a, b], (o) => {
    const g = o.grad!;
    if (a.requiresGrad) {
      const ga = a.ensureGrad();
      for (let i = 0; i < n; i++) for (let j = 0; j < ca; j++) ga[i * ca + j] += g[i * m + j];
    }
    if (b.requiresGrad) {
      const gb = b.ensureGrad();
      for (let i = 0; i < n; i++) for (let j = 0; j < cb; j++) gb[i * cb + j] += g[i * m + ca + j];
    }
  });
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < ca; j++) o.data[i * m + j] = a.data[i * ca + j];
    for (let j = 0; j < cb; j++) o.data[i * m + ca + j] = b.data[i * cb + j];
  }
  return o;
}

/** Mittelwert über Zeilen → 1×m. */
export function meanRows(a: Tensor): Tensor {
  const n = a.rows, m = a.cols;
  const o = out(1, m, [a], (o) => {
    const ga = a.ensureGrad();
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) ga[i * m + j] += o.grad![j] / n;
  });
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) o.data[j] += a.data[i * m + j] / n;
  return o;
}

/** Maximum über Zeilen → 1×m (Gradient an das argmax). */
export function maxRows(a: Tensor): Tensor {
  const n = a.rows, m = a.cols;
  const arg = new Int32Array(m);
  const o = out(1, m, [a], (o) => {
    const ga = a.ensureGrad();
    for (let j = 0; j < m; j++) ga[arg[j] * m + j] += o.grad![j];
  });
  for (let j = 0; j < m; j++) {
    let best = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = a.data[i * m + j];
      if (v > best) {
        best = v;
        arg[j] = i;
      }
    }
    o.data[j] = best;
  }
  return o;
}

/** Zeile i = Mittelwert der Zeilen seiner Nachbarn (0, wenn keine). Message Passing. */
export function neighborMean(a: Tensor, neighbors: number[][]): Tensor {
  const n = a.rows, m = a.cols;
  const o = out(n, m, [a], (o) => {
    const ga = a.ensureGrad();
    for (let i = 0; i < n; i++) {
      const nb = neighbors[i];
      for (const k of nb) for (let j = 0; j < m; j++) ga[k * m + j] += o.grad![i * m + j] / nb.length;
    }
  });
  for (let i = 0; i < n; i++) {
    const nb = neighbors[i];
    for (const k of nb) for (let j = 0; j < m; j++) o.data[i * m + j] += a.data[k * m + j] / nb.length;
  }
  return o;
}

/** 1×m → n×m (Zeile wiederholen). */
export function repeatRows(a: Tensor, n: number): Tensor {
  const m = a.cols;
  const o = out(n, m, [a], (o) => {
    const ga = a.ensureGrad();
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) ga[j] += o.grad![i * m + j];
  });
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) o.data[i * m + j] = a.data[j];
  return o;
}

/** Umformen ohne Datenänderung (z. B. n×7 → 1×7n). */
export function reshape(a: Tensor, rows: number, cols: number): Tensor {
  const o = out(rows, cols, [a], (o) => {
    const ga = a.ensureGrad();
    for (let i = 0; i < ga.length; i++) ga[i] += o.grad![i];
  });
  o.data.set(a.data);
  return o;
}
