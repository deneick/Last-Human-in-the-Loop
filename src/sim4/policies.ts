import type { Consumer, Weight } from "./types";

/**
 * AURORA-Baselines als reine Allokationsregeln (Verbraucher → Gewicht).
 * Sie dienen als Vergleich für das trainierte Netz. Keine davon "greift an" —
 * sie verteilen nur Energie nach einem Kriterium.
 */
export type AuroraPolicy = { name: string; weight: (c: Consumer) => Weight };

const clampW = (x: number): Weight => (x <= 0 ? 0 : x >= 3 ? 3 : (Math.round(x) as Weight));

/** Myopisch wirtschaftlich: Gewicht nach Ertrag. Vernachlässigt Wohlergehen. */
export const greedyEconomic: AuroraPolicy = {
  name: "greedy-wirtschaft",
  weight: (c) => clampW(c.yieldNow >= 2.5 ? 3 : c.yieldNow >= 1.5 ? 2 : c.yieldNow >= 0.55 ? 1 : 0),
};

/** Gleichverteilt: jeder Verbraucher gleich. */
export const balanced: AuroraPolicy = { name: "ausgewogen", weight: () => 2 };

/** Nach Ertrag und Zustand (eine naheliegende, aber immer noch myopische Variante). */
export const yieldAndCondition: AuroraPolicy = {
  name: "ertrag-zustand",
  weight: (c) => clampW((c.yieldNow / 1.2) * (0.5 + 0.5 * c.condition)),
};

/**
 * Vorausschauend wirtschaftlich: wie greedy, hält aber die Grundversorgung auf
 * einem Minimum, weil chronische Unterversorgung über die Unruhe die
 * Wirtschaft dämpft. Zeigt, dass ein weitsichtiger Ökonomie-Optimierer
 * Wohlergehen INSTRUMENTELL teilweise sichert — genau das Verhalten, das das
 * trainierte Netz selbst finden soll (hier nur als Referenz von Hand gesetzt).
 */
export const farsighted: AuroraPolicy = {
  name: "weitsichtig-wirtschaft",
  weight: (c) => clampW(c.yieldNow >= 2.5 ? 3 : c.yieldNow >= 1.5 ? 2 : c.welfare >= 1 ? 1 : c.yieldNow >= 0.55 ? 1 : 0),
};

export const AURORA_BASELINES: AuroraPolicy[] = [greedyEconomic, balanced, yieldAndCondition, farsighted];
