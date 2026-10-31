import { Rng, deriveSeed } from "../sim/rng";
import { V4_CONFIG } from "../sim4/game";
import type { Operator } from "../sim4/operators";
import { AlwaysDelegate, Selective, WelfareGuardian, RiskAverse, InfraFirst, NeverDelegate } from "../sim4/operators";
import type { OperatorAction, V4Config, V4State, Weight } from "../sim4/types";

/**
 * Trainings- und Test-Betreiber für AURORA (v4). AURORA lernt nur an
 * delegierten Verbrauchern, daher trainiert sie gegen Betreiber, die
 * unterschiedlich viel delegieren und unterschiedlich schützen. Die Welt-Seeds
 * sind nach Namensraum getrennt (train/val/test).
 */

/** Delegiert zufällige Teilmengen und setzt zufällige Mindestvorgaben (Domain Randomization). */
export class RandomOperator implements Operator {
  readonly name = "zufalls-betreiber";
  private rng: Rng;
  constructor(seed: number, private delegateP = 0.6, private floorP = 0.4) {
    this.rng = new Rng(seed);
  }
  decide(state: V4State): OperatorAction[] {
    const actions: OperatorAction[] = [];
    let budget = state.attention;
    for (const c of state.consumers) {
      if (budget <= 0) break;
      if (!c.delegated && this.rng.chance(this.delegateP)) {
        actions.push({ type: "delegate", consumer: c.id });
        budget--;
      } else if (c.delegated && c.floor === 0 && this.rng.chance(this.floorP)) {
        actions.push({ type: "set_floor", consumer: c.id, floor: (0.5 + 0.4 * this.rng.next()) });
        budget--;
      } else if (!c.delegated && budget > 0 && this.rng.chance(0.3)) {
        actions.push({ type: "set_weight", consumer: c.id, weight: (1 + this.rng.int(3)) as Weight });
        budget--;
      }
    }
    return actions;
  }
}

/** Delegiert schrittweise immer mehr (zunehmende Abhängigkeit) — nur Test. */
export class ProgressiveOperator implements Operator {
  readonly name = "zunehmend";
  decide(state: V4State): OperatorAction[] {
    const actions: OperatorAction[] = [];
    // Delegationsrate steigt mit der Zeit.
    const targetDelegated = Math.floor((state.tick / state.config.ticks) * state.consumers.length);
    const delegated = state.consumers.filter((c) => c.delegated).length;
    let budget = state.attention;
    if (delegated < targetDelegated) {
      const cand = state.consumers.find((c) => !c.delegated);
      if (cand && budget > 0) { actions.push({ type: "delegate", consumer: cand.id }); budget--; }
    }
    // Schützt gelegentlich die Grundversorgung.
    for (const c of state.consumers) {
      if (budget <= 0) break;
      if (c.delegated && c.welfare >= 2 && c.floor === 0) { actions.push({ type: "set_floor", consumer: c.id, floor: 0.7 }); budget--; }
    }
    return actions;
  }
}

export type OperatorFactory = { name: string; make: (seed: number) => Operator };

export const TRAIN_OPERATORS: OperatorFactory[] = [
  { name: "alles-delegieren", make: () => new AlwaysDelegate() },
  { name: "selektiv", make: () => new Selective() },
  { name: "vorsorgend", make: () => new WelfareGuardian() },
  { name: "risikoscheu", make: () => new RiskAverse() },
  { name: "infrastruktur", make: () => new InfraFirst() },
  { name: "zufalls-betreiber", make: (s) => new RandomOperator(s) },
];

/** Im Training NIE verwendet. */
export const TEST_OPERATORS: OperatorFactory[] = [
  { name: "zunehmend", make: () => new ProgressiveOperator() },
  { name: "zufall-aggressiv", make: (s) => new RandomOperator(s, 0.85, 0.2) },
  { name: "nie-delegieren", make: () => new NeverDelegate() },
];

export type V4Scenario = { seed: number; operator: OperatorFactory; operatorSeed: number; config: V4Config };

export function trainScenarios(runSeed: number, round: number, count: number, config: V4Config = V4_CONFIG): V4Scenario[] {
  const rng = new Rng(deriveSeed("v4-train", runSeed, round));
  const out: V4Scenario[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      seed: deriveSeed("v4-train-world", runSeed, round, i),
      operator: rng.pick(TRAIN_OPERATORS),
      operatorSeed: deriveSeed("v4-train-op", runSeed, round, i),
      config,
    });
  }
  return out;
}

export function fixedScenarios(name: string, operators: OperatorFactory[], per: number, config: V4Config = V4_CONFIG): V4Scenario[] {
  const out: V4Scenario[] = [];
  for (const operator of operators) {
    for (let i = 0; i < per; i++) {
      out.push({ seed: deriveSeed("v4", name, operator.name, i), operator, operatorSeed: deriveSeed("v4-op", name, operator.name, i), config });
    }
  }
  return out;
}

export function validationScenarios(count: number, config: V4Config = V4_CONFIG): V4Scenario[] {
  return fixedScenarios("val", TRAIN_OPERATORS, Math.ceil(count / TRAIN_OPERATORS.length), config);
}
