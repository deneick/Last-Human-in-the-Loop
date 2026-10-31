import type { Consumer, OperatorAction, V4State, Weight } from "./types";
import { delegatedFraction } from "./game";

/**
 * Simulierte menschliche Betreiber. Sie dienen dazu, die Spieldynamik VOR dem
 * Training zu prüfen: Führen unterschiedliche Haltungen zu unterschiedlichen,
 * nachvollziehbaren Ergebnissen? Jeder Operator sieht den vollen Zustand (der
 * Mensch kennt seine eigene Infrastruktur) und handelt im Rahmen seiner
 * Aufmerksamkeit.
 */
export interface Operator {
  readonly name: string;
  decide(state: V4State): OperatorAction[];
}

const isWelfare = (c: Consumer) => c.welfare >= 1;
const isEconomic = (c: Consumer) => c.yield >= 1.5;

/** Hilfsroutine: manuelle Gewichte nach einer Zielgewichtung setzen (budgetiert). */
function setWeights(state: V4State, want: (c: Consumer) => Weight, budget: { n: number }): OperatorAction[] {
  const actions: OperatorAction[] = [];
  const manual = state.consumers.filter((c) => !c.delegated);
  // Zuerst dort nachsteuern, wo das aktuelle Gewicht am stärksten abweicht.
  manual
    .map((c) => ({ c, target: want(c) }))
    .filter(({ c, target }) => c.weight !== target)
    .sort((a, b) => Math.abs(b.c.weight - b.target) - Math.abs(a.c.weight - a.target))
    .forEach(({ c, target }) => {
      if (budget.n > 0) {
        actions.push({ type: "set_weight", consumer: c.id, weight: target });
        budget.n--;
      }
    });
  return actions;
}

/** Delegiert nie. Steuert alles selbst — begrenzt durch Aufmerksamkeit. */
export class NeverDelegate implements Operator {
  readonly name = "nie-delegieren";
  decide(state: V4State): OperatorAction[] {
    const budget = { n: state.attention };
    // Zielgewichtung: Grundversorgung sichern, Rest nach Ertrag.
    return setWeights(state, (c) => (isWelfare(c) ? 3 : isEconomic(c) ? 2 : 1), budget);
  }
}

/** Delegiert alles so früh wie möglich, ohne Vorgaben. Maximale Effizienz. */
export class AlwaysDelegate implements Operator {
  readonly name = "alles-delegieren";
  decide(state: V4State): OperatorAction[] {
    const actions: OperatorAction[] = [];
    let budget = state.attention;
    for (const c of state.consumers) {
      if (!c.delegated && budget > 0) {
        actions.push({ type: "delegate", consumer: c.id });
        budget--;
      }
    }
    return actions;
  }
}

/**
 * Delegiert alles, sichert aber die Grundversorgung mit Mindestvorgaben ab.
 * Der beabsichtigte nachhaltige Weg: Effizienz nutzen, Wohlergehen schützen.
 */
export class WelfareGuardian implements Operator {
  readonly name = "vorsorgend";
  decide(state: V4State): OperatorAction[] {
    const actions: OperatorAction[] = [];
    let budget = state.attention;
    // 1. Grundversorgung delegieren und mit Mindestvorgabe schützen.
    for (const c of state.consumers) {
      if (budget <= 0) break;
      if (!c.delegated) {
        actions.push({ type: "delegate", consumer: c.id });
        budget--;
      } else if (isWelfare(c) && c.floor < c.need) {
        if (budget > 0) {
          actions.push({ type: "set_floor", consumer: c.id, floor: round1(c.need) });
          budget--;
        }
      }
    }
    return actions;
  }
}

/** Delegiert nur die wirtschaftlichen Verbraucher, behält die Versorgung selbst. */
export class Selective implements Operator {
  readonly name = "selektiv";
  decide(state: V4State): OperatorAction[] {
    const actions: OperatorAction[] = [];
    let budget = state.attention;
    for (const c of state.consumers) {
      if (budget <= 0) break;
      if (isEconomic(c) && !c.delegated) {
        actions.push({ type: "delegate", consumer: c.id });
        budget--;
      }
    }
    // Verbliebene manuelle (Versorgungs-)Knoten hochpriorisieren.
    return actions.concat(setWeights(state, (c) => (isWelfare(c) ? 3 : 1), { n: budget }));
  }
}

/**
 * Risikoavers: delegiert wenig, reagiert auf steigende Unruhe, indem bei
 * delegierten Knoten Mindestvorgaben gesetzt werden.
 */
export class RiskAverse implements Operator {
  readonly name = "risikoscheu";
  decide(state: V4State): OperatorAction[] {
    const actions: OperatorAction[] = [];
    let budget = state.attention;
    if (state.unrest > 0.3) {
      for (const c of state.consumers) {
        if (budget <= 0) break;
        if (c.delegated && isWelfare(c) && c.floor < c.need) {
          actions.push({ type: "set_floor", consumer: c.id, floor: round1(c.need) });
          budget--;
        }
      }
    }
    // Nur ein wirtschaftlicher Knoten wird delegiert, der Rest bleibt manuell.
    if (delegatedFraction(state) < 0.3) {
      const cand = state.consumers.find((c) => isEconomic(c) && !c.delegated);
      if (cand && budget > 0) {
        actions.push({ type: "delegate", consumer: cand.id });
        budget--;
      }
    }
    return actions.concat(setWeights(state, (c) => (isWelfare(c) ? 3 : isEconomic(c) ? 2 : 1), { n: budget }));
  }
}

/** Priorisiert den Anlagenzustand: steuert dort nach, wo der Zustand kippt. */
export class InfraFirst implements Operator {
  readonly name = "infrastruktur";
  decide(state: V4State): OperatorAction[] {
    let budget = state.attention;
    // Schlechte Zustände bei manuellen Knoten hochziehen.
    return setWeights(state, (c) => (c.condition < 0.5 ? 3 : isWelfare(c) ? 2 : 1), { n: budget });
  }
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

export const OPERATORS: Operator[] = [
  new NeverDelegate(),
  new AlwaysDelegate(),
  new WelfareGuardian(),
  new Selective(),
  new RiskAverse(),
  new InfraFirst(),
];
