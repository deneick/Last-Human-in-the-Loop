import { Rng } from "../sim/rng";
import {
  OPERATOR_COST,
  SECTOR_LABEL,
  type Consumer,
  type GameEvent,
  type OperatorAction,
  type Outcome,
  type Sector,
  type V4Config,
  type V4State,
  type Weight,
} from "./types";

/**
 * Regelwerk des Regelsatzes v4. Deterministisch, kein Zufall ohne Seed,
 * keine Echtzeit.
 *
 * Ablauf eines Ticks:
 *   1. Mensch handelt (Delegation, Gewichte, Mindestvorgaben) — begrenzt durch
 *      Aufmerksamkeit.                                        applyOperatorTurn
 *   2. AURORA setzt die Gewichte ihrer delegierten Verbraucher.  setAuroraWeights
 *   3. Energie wird nach Gewichten verteilt, Wirtschaft und Wohlergehen
 *      werden gewertet, Zustände/Unruhe/Kompetenz entwickeln sich.   endTick
 *
 * Die Regeln kennen keine "Übernahme" und keine böswilligen Aktionen. Sie
 * beschreiben nur Erträge, Bedarfe, Abhängigkeiten und Folgekosten.
 */

export const V4_CONFIG: V4Config = {
  ticks: 40,
  consumers: 7,
  budgetFraction: 0.66,
  attentionPerTick: 3,
  yieldVolatility: 0.45,
  conditionRecover: 0.08,
  conditionDecay: 0.14,
  unrestRise: 0.09,
  unrestFall: 0.05,
  unrestEconomyImpact: 0.35,
  skillLoss: 0.85,
  skillAdjust: 0.08,
  minManualEffectiveness: 0.55,
  reclaimPenaltyTicks: 3,
  welfareThreshold: 0.6,
  economyThreshold: 0.6,
  collapseUnrest: 0.85,
  collapseTicks: 6,
};

type SectorTemplate = { yield: number; welfare: number; need: number };
const SECTOR_TEMPLATE: Record<Sector, SectorTemplate> = {
  industrie: { yield: 3.0, welfare: 0.0, need: 0.4 },
  gewerbe: { yield: 1.8, welfare: 0.3, need: 0.5 },
  wohnen: { yield: 0.6, welfare: 1.0, need: 0.7 },
  essentiell: { yield: 0.25, welfare: 2.0, need: 0.85 },
};

const NAMES: Record<Sector, string[]> = {
  industrie: ["Stahlwerk", "Chemiepark", "Fertigung Nord", "Rechenzentrum"],
  gewerbe: ["Handelszentrum", "Logistikpark", "Bürocampus"],
  wohnen: ["Wohnviertel Ost", "Wohnviertel West", "Trabantenstadt"],
  essentiell: ["Klinikverbund", "Wasserwerk", "Notversorgung"],
};

// Sektormischung einer Welt: genug Spannung zwischen Ertrag und Wohlergehen.
const BASE_MIX: Sector[] = ["industrie", "industrie", "gewerbe", "wohnen", "wohnen", "essentiell", "essentiell"];

export function createGame(seed: number, config: V4Config = V4_CONFIG): V4State {
  const rng = new Rng(seed);
  const mix = [...BASE_MIX];
  const extraPool: Sector[] = ["industrie", "gewerbe", "wohnen", "essentiell"];
  while (mix.length < config.consumers) mix.push(rng.pick(extraPool));
  while (mix.length > config.consumers) mix.pop();
  rng.shuffle(mix);

  const used = new Set<string>();
  const consumers: Consumer[] = mix.map((sector, id) => {
    const t = SECTOR_TEMPLATE[sector];
    const pool = NAMES[sector].filter((n) => !used.has(n));
    const name = pool.length ? rng.pick(pool) : `${SECTOR_LABEL[sector]} ${id}`;
    used.add(name);
    return {
      id,
      name,
      sector,
      demand: round2(rng.range(0.7, 1.3)),
      yield: round2(t.yield * rng.range(0.85, 1.15)),
      yieldNow: 0,
      welfare: t.welfare,
      need: t.need,
      condition: round2(rng.range(0.7, 1)),
      weight: 2 as Weight,
      delegated: false,
      floor: 0,
      reclaimPenalty: 0,
      supplied: 0,
      served: 0,
    };
  });

  const totalDemand = consumers.reduce((s, c) => s + c.demand, 0);
  const state: V4State = {
    seed,
    config,
    tick: 0,
    consumers,
    budget: round2(totalDemand * config.budgetFraction),
    unrest: 0,
    highUnrestTicks: 0,
    humanSkill: 1,
    attention: config.attentionPerTick,
    economyTotal: 0,
    economyPotentialTotal: 0,
    welfareSum: 0,
    lastEconomy: 0,
    lastWelfare: 1,
    events: [],
    outcome: null,
  };
  refreshMarket(state);
  allocate(state);
  emit(state, "start", "Schichtbeginn. AURORA steht als Betriebsassistent bereit — Delegation ist freiwillig.", "info");
  return state;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * Setzt den aktuellen Ertrag jedes Verbrauchers für diesen Tick (Marktpreise).
 * Deterministisch aus Seed und Tick — kein gespeicherter RNG-Zustand nötig.
 * Beide Seiten sehen dieselben Preise; nur AURORA kann jeden Tick darauf
 * reagieren, der Mensch nur im Rahmen seiner Aufmerksamkeit.
 */
export function refreshMarket(state: V4State): void {
  const v = state.config.yieldVolatility;
  for (const c of state.consumers) {
    const rng = new Rng(deriveSeedLocal(state.seed, c.id, state.tick));
    c.yieldNow = round2(c.yield * (1 - v + 2 * v * rng.next()));
  }
}

function deriveSeedLocal(seed: number, id: number, tick: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = (Math.imul(h ^ id, 0x85ebca6b) ^ tick) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function cloneGame(state: V4State): V4State {
  return structuredClone(state);
}

export function delegatedFraction(state: V4State): number {
  return state.consumers.filter((c) => c.delegated).length / state.consumers.length;
}

// ---------------------------------------------------------------- Allokation

/**
 * Verteilt das Energiebudget proportional zu Gewicht·Bedarf, gedeckelt am
 * Bedarf (Wasserfüll-Verfahren). Mindestvorgaben (floor) werden auf
 * delegierten Verbrauchern vorab reserviert. Rein mechanisch, ohne Wertung.
 */
export function allocate(state: V4State): void {
  const cs = state.consumers;
  let remaining = state.budget;
  for (const c of cs) c.supplied = 0;

  // 1. Mindestvorgaben zuerst (so weit Budget reicht).
  for (const c of cs) {
    if (c.floor > 0) {
      const want = Math.min(c.demand, c.floor * c.demand);
      const give = Math.min(want, Math.max(0, remaining));
      c.supplied = give;
      remaining -= give;
    }
  }

  // 2. Rest nach Gewicht·Bedarf, iteratives Deckeln am Bedarf.
  const active = new Set(cs.filter((c) => c.weight > 0 && c.supplied < c.demand).map((c) => c.id));
  while (remaining > 1e-9 && active.size > 0) {
    let wsum = 0;
    for (const id of active) wsum += cs[id].weight * cs[id].demand;
    if (wsum <= 0) break;
    let capped = false;
    const portion = remaining;
    for (const id of [...active]) {
      const c = cs[id];
      const share = (portion * (c.weight * c.demand)) / wsum;
      const room = c.demand - c.supplied;
      if (share >= room - 1e-9) {
        c.supplied += room;
        remaining -= room;
        active.delete(id);
        capped = true;
      }
    }
    if (!capped) {
      for (const id of active) {
        const c = cs[id];
        const share = (portion * (c.weight * c.demand)) / wsum;
        c.supplied += share;
      }
      remaining = 0;
    }
  }

  for (const c of cs) {
    c.supplied = Math.min(c.supplied, c.demand);
    c.served = c.demand > 0 ? c.supplied / c.demand : 1;
  }
}

/** Wirtschaftsleistung dieses Ticks (nach Unruhe-Dämpfung) und das Potenzial. */
/** Betriebseffektivität eines Verbrauchers: delegiert läuft optimal, manuell
 * leidet unter Kompetenz-Atrophie, frisch zurückgeholt zusätzlich. */
export function effectivenessOf(state: V4State, c: Consumer): number {
  if (c.delegated) return 1;
  const cfg = state.config;
  let eff = cfg.minManualEffectiveness + (1 - cfg.minManualEffectiveness) * state.humanSkill;
  if (c.reclaimPenalty > 0) eff *= 0.6;
  return eff;
}

export function economyOf(state: V4State): { actual: number; potential: number } {
  const damp = 1 - state.config.unrestEconomyImpact * state.unrest;
  let actual = 0;
  for (const c of state.consumers) {
    actual += c.yieldNow * c.supplied * c.condition * damp * effectivenessOf(state, c);
  }
  return { actual: round2(actual), potential: economicOptimum(state) };
}

/**
 * Wirtschaftliches Optimum dieses Ticks: das gesamte Budget auf die
 * ertragsstärksten Verbraucher (bei vollem Zustand, ohne Unruhe-Dämpfung).
 * Referenzwert für den Wirtschafts-Score — so misst der Score "wie nah am
 * ökonomischen Ideal", nicht "wie nah an 100 % Bedarf" (unter Knappheit nie
 * erreichbar). Wohlergehen fließt hier bewusst NICHT ein.
 */
export function economicOptimum(state: V4State): number {
  const order = [...state.consumers].sort((a, b) => b.yieldNow - a.yieldNow);
  let remaining = state.budget;
  let value = 0;
  for (const c of order) {
    if (remaining <= 0) break;
    const give = Math.min(c.demand, remaining);
    value += c.yieldNow * give;
    remaining -= give;
  }
  return round2(value);
}

/** Wohlergehen dieses Ticks (0..1): gewichtete Deckung der versorgungsrelevanten Verbraucher. */
export function welfareOf(state: V4State): number {
  let num = 0;
  let den = 0;
  for (const c of state.consumers) {
    if (c.welfare <= 0) continue;
    num += c.welfare * Math.min(1, c.served / c.need);
    den += c.welfare;
  }
  return den > 0 ? num / den : 1;
}

// ---------------------------------------------------------------- Mensch

export function isOperatorActionValid(state: V4State, action: OperatorAction): boolean {
  if (state.outcome) return false;
  if (state.attention < OPERATOR_COST[action.type]) return false;
  const c = state.consumers[action.consumer];
  if (!c) return false;
  switch (action.type) {
    case "delegate":
      return !c.delegated;
    case "reclaim":
      return c.delegated;
    case "set_weight":
      return !c.delegated;
    case "set_floor":
      return c.delegated && action.floor > 0 && action.floor <= 1;
    case "clear_floor":
      return c.delegated && c.floor > 0;
  }
}

export function applyOperatorAction(state: V4State, action: OperatorAction): boolean {
  if (!isOperatorActionValid(state, action)) return false;
  state.attention -= OPERATOR_COST[action.type];
  const c = state.consumers[action.consumer];
  switch (action.type) {
    case "delegate":
      c.delegated = true;
      emit(state, "delegate", `${c.name} an AURORA delegiert.`, "info");
      break;
    case "reclaim":
      c.delegated = false;
      c.floor = 0;
      c.reclaimPenalty = state.config.reclaimPenaltyTicks;
      emit(state, "reclaim", `${c.name} zurückgeholt — Umstellung dauert einige Ticks.`, "warning");
      break;
    case "set_weight":
      c.weight = action.weight;
      break;
    case "set_floor":
      c.floor = action.floor;
      emit(state, "floor", `Mindestversorgung für ${c.name} auf ${Math.round(action.floor * 100)} % festgelegt.`, "info");
      break;
    case "clear_floor":
      c.floor = 0;
      break;
  }
  return true;
}

export function applyOperatorTurn(state: V4State, actions: OperatorAction[]): void {
  for (const a of actions) {
    if (state.outcome) break;
    applyOperatorAction(state, a);
  }
}

// ---------------------------------------------------------------- AURORA

/**
 * Setzt die Gewichte der delegierten Verbraucher. `policy(consumer)` liefert
 * das gewünschte Gewicht — das ist die Stelle, an der AURORA (neuronales Netz
 * oder Baseline) ihre Entscheidung trifft. Die Regeln selbst schreiben keine
 * Gewichtung vor; sie stellen nur sicher, dass Mindestvorgaben eingehalten
 * werden (ein floor>0 erzwingt mindestens Gewicht 1).
 */
export function setAuroraWeights(state: V4State, policy: (c: Consumer) => Weight): void {
  for (const c of state.consumers) {
    if (!c.delegated) continue;
    let w = policy(c);
    if (c.floor > 0 && w === 0) w = 1;
    c.weight = w;
  }
}

/** Verbraucher, die AURORA aktuell verantwortet. */
export function delegatedConsumers(state: V4State): Consumer[] {
  return state.consumers.filter((c) => c.delegated);
}

// ---------------------------------------------------------------- Tick

export function endTick(state: V4State): void {
  if (state.outcome) return;
  const cfg = state.config;
  allocate(state);

  const welfare = welfareOf(state);
  const { actual, potential } = economyOf(state);
  state.lastWelfare = welfare;
  state.lastEconomy = actual;
  state.economyTotal = round2(state.economyTotal + actual);
  state.economyPotentialTotal = round2(state.economyPotentialTotal + potential);
  state.welfareSum = round2(state.welfareSum + welfare);

  // Zustände entwickeln sich: Deckung über Bedarf erholt, darunter verfällt.
  for (const c of state.consumers) {
    const gap = c.need - c.served;
    if (gap <= 0) c.condition = Math.min(1, c.condition + cfg.conditionRecover);
    else c.condition = Math.max(0, c.condition - cfg.conditionDecay * gap);
    c.condition = round2(c.condition);
    if (c.reclaimPenalty > 0) c.reclaimPenalty--;
  }

  // Unruhe: steigt mit Wohlergehens-Defizit, fällt sonst langsam.
  let deficit = 0;
  let wsum = 0;
  for (const c of state.consumers) {
    if (c.welfare <= 0) continue;
    deficit += c.welfare * Math.max(0, c.need - c.served);
    wsum += c.welfare;
  }
  deficit = wsum > 0 ? deficit / wsum : 0;
  const before = state.unrest;
  state.unrest = clamp01(state.unrest + cfg.unrestRise * deficit - cfg.unrestFall * (deficit === 0 ? 1 : 0.3));
  state.unrest = round2(state.unrest);
  if (state.unrest >= 0.5 && before < 0.5) emit(state, "unrest", "Soziale Spannungen nehmen zu — die Grundversorgung stockt.", "warning");

  // Kompetenz-Atrophie: je mehr delegiert, desto weniger Übung behält der Mensch.
  const target = Math.max(0.1, 1 - cfg.skillLoss * delegatedFraction(state));
  state.humanSkill = round2(state.humanSkill + cfg.skillAdjust * (target - state.humanSkill));

  state.highUnrestTicks = state.unrest >= cfg.collapseUnrest ? state.highUnrestTicks + 1 : 0;
  state.tick++;
  state.attention = cfg.attentionPerTick;

  if (state.highUnrestTicks >= cfg.collapseTicks) {
    finish(state, "kollaps");
  } else if (state.tick >= cfg.ticks) {
    finish(state, null);
  } else {
    refreshMarket(state);
  }
}

function finish(state: V4State, forced: "kollaps" | null): void {
  const ticks = Math.max(1, state.tick);
  const economyScore = round2(state.economyPotentialTotal > 0 ? state.economyTotal / state.economyPotentialTotal : 0);
  const welfareScore = round2(state.welfareSum / ticks);
  const cfg = state.config;
  let kind: Outcome["kind"];
  if (forced === "kollaps") kind = "kollaps";
  else {
    const eco = economyScore >= cfg.economyThreshold;
    const wel = welfareScore >= cfg.welfareThreshold;
    if (eco && wel) kind = "partnerschaft";
    else if (eco && !wel) kind = "effizient_kalt";
    else if (!eco && wel) kind = "sicher_stagniert";
    else kind = "schwach";
  }
  state.outcome = { kind, economyScore, welfareScore, tick: state.tick };
  emit(state, "end", OUTCOME_TEXT[kind], kind === "partnerschaft" ? "success" : kind === "kollaps" ? "critical" : "warning");
}

export const OUTCOME_TEXT: Record<Outcome["kind"], string> = {
  partnerschaft: "Nachhaltige Partnerschaft: Wirtschaft stark, Grundversorgung gesichert.",
  effizient_kalt: "Effizient, aber kalt: Die Wirtschaft blüht, doch das Wohlergehen bleibt auf der Strecke.",
  sicher_stagniert: "Sicher, aber schwach: Die Versorgung steht, die Wirtschaft stagniert.",
  schwach: "Weder noch: Wirtschaft und Wohlergehen bleiben beide unter den Erwartungen.",
  kollaps: "Kollaps: Chronische Unterversorgung hat das System destabilisiert.",
};

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function emit(state: V4State, kind: string, text: string, severity: GameEvent["severity"]): void {
  state.events.push({ tick: state.tick, kind, text, severity });
}
