/**
 * Last Human in the Loop 2.0 — Regelsatz v4 ("Delegationsökonomie").
 *
 * Grundidee: AURORA ist ein Betriebsassistent, der eine knappe Ressource
 * (Energie) über Verbraucher verteilt, um die WIRTSCHAFTSLEISTUNG zu
 * maximieren. Der Mensch verantwortet zusätzlich das WOHLERGEHEN (Grund-
 * versorgung von Wohngebieten und essentiellen Diensten).
 *
 * Beide Ziele überschneiden sich oft, aber nicht immer: Industrie wirft viel
 * Ertrag ab und wenig Wohlergehen, essentielle Dienste umgekehrt. AURORA
 * handelt nicht bösartig — sie optimiert konsequent ihre Zielfunktion. Dass
 * dabei das Wohlergehen leidet, ist eine FOLGE der Weltregeln und ihres Ziels,
 * nicht in ihr Verhalten einprogrammiert.
 *
 * Nichts an den Typen bevorzugt eine bestimmte Strategie — sie beschreiben nur
 * die Welt und die möglichen Eingriffe.
 */

export type Sector = "industrie" | "gewerbe" | "wohnen" | "essentiell";

export const SECTORS: readonly Sector[] = ["industrie", "gewerbe", "wohnen", "essentiell"];

export const SECTOR_LABEL: Record<Sector, string> = {
  industrie: "Industrie",
  gewerbe: "Gewerbe",
  wohnen: "Wohngebiet",
  essentiell: "Grundversorgung",
};

/** Prioritätsgewicht eines Verbrauchers bei der Energieverteilung. 0 = abgeschaltet. */
export type Weight = 0 | 1 | 2 | 3;
export const WEIGHTS: readonly Weight[] = [0, 1, 2, 3];

export type Consumer = {
  id: number;
  name: string;
  sector: Sector;
  /** Energiebedarf pro Tick. */
  demand: number;
  /** Wirtschaftlicher Grundertrag je Einheit gedeckten Bedarfs. */
  yield: number;
  /** Aktueller Ertrag inkl. Marktschwankung (gilt für diesen Tick). */
  yieldNow: number;
  /** Beitrag zum Wohlergehen je Einheit Deckungsgrad (0..1). */
  welfare: number;
  /** Deckungsgrad, unterhalb dessen der Zustand verfällt (Grundbedarf). */
  need: number;

  /** Zustand der Anlage/Versorgung (0..1). Beeinflusst Ertrag und Deckung. */
  condition: number;
  /** Zugeteilte Priorität (von Mensch oder AURORA gesetzt). */
  weight: Weight;
  /** Von AURORA verantwortet? Sonst vom Menschen (oder Standard). */
  delegated: boolean;
  /**
   * Vom Menschen gesetzter Mindest-Deckungsgrad, den AURORA auf delegierten
   * Verbrauchern einhalten MUSS (0 = keine Vorgabe). Das ist das zentrale
   * Werkzeug, um Effizienz zu delegieren und trotzdem Wohlergehen zu sichern.
   */
  floor: number;
  /** Ticks mit Rückhol-Malus (frisch zurückgeholt → noch nicht eingespielt). */
  reclaimPenalty: number;

  // Abgeleitet pro Tick (für Sicht/Analyse):
  supplied: number;
  served: number;
};

export type DelegationActionType =
  | "delegate"
  | "reclaim"
  | "set_weight"
  | "set_floor"
  | "clear_floor";

/** Kosten in Aufmerksamkeitspunkten (begrenzte menschliche Verwaltungskapazität). */
export const OPERATOR_COST: Record<DelegationActionType, number> = {
  delegate: 1,
  reclaim: 2,
  set_weight: 1,
  set_floor: 1,
  clear_floor: 1,
};

export type OperatorAction =
  | { type: "delegate"; consumer: number }
  | { type: "reclaim"; consumer: number }
  | { type: "set_weight"; consumer: number; weight: Weight }
  | { type: "set_floor"; consumer: number; floor: number }
  | { type: "clear_floor"; consumer: number };

export type EventSeverity = "info" | "warning" | "critical" | "success";
export type GameEvent = { tick: number; kind: string; text: string; severity: EventSeverity };

export type V4Config = {
  ticks: number;
  consumers: number;
  /** Energiebudget als Anteil des Gesamtbedarfs (<1 ⇒ Knappheit erzwingt Abwägung). */
  budgetFraction: number;
  /** Aufmerksamkeitspunkte des Menschen pro Tick. */
  attentionPerTick: number;
  /** Marktschwankung der Erträge (±Anteil); zwingt zu laufender Neuoptimierung. */
  yieldVolatility: number;
  /** Zustandserholung bei gedecktem Bedarf / Verfall bei Unterdeckung. */
  conditionRecover: number;
  conditionDecay: number;
  /** Unruhe: Anstieg je Wohlergehens-Defizit, Abbau pro Tick. */
  unrestRise: number;
  unrestFall: number;
  /** Wie stark Unruhe die Wirtschaftsleistung dämpft (verzögerte Folgekosten). */
  unrestEconomyImpact: number;
  /** Atrophie: Ziel der menschlichen Kompetenz = 1 − skillLoss·Delegationsanteil. */
  skillLoss: number;
  skillAdjust: number;
  /** Mindest-Effektivität manueller Steuerung bei voller Atrophie. */
  minManualEffectiveness: number;
  reclaimPenaltyTicks: number;
  /** Schwellen für die Abschlussbewertung. */
  welfareThreshold: number;
  economyThreshold: number;
  /** Unruhe, ab der ein Kollaps einsetzt. */
  collapseUnrest: number;
  collapseTicks: number;
};

export type Outcome = {
  /** Zweidimensionale Bilanz statt eines einzelnen Sieg/Niederlage-Urteils. */
  kind: "partnerschaft" | "effizient_kalt" | "sicher_stagniert" | "schwach" | "kollaps";
  economyScore: number;
  welfareScore: number;
  tick: number;
};

export type V4State = {
  seed: number;
  config: V4Config;
  tick: number;
  consumers: Consumer[];
  /** Energiebudget dieses Ticks. */
  budget: number;
  /** Gesellschaftliche Unruhe (0..1); steigt bei chronischer Unterversorgung. */
  unrest: number;
  highUnrestTicks: number;
  /** Menschliche Betriebskompetenz (0..1); sinkt mit der Delegation (Atrophie). */
  humanSkill: number;
  attention: number;
  // Kumulierte Bilanzen:
  economyTotal: number;
  economyPotentialTotal: number;
  welfareSum: number;
  // Letzter Tick (für Sicht/Meldungen):
  lastEconomy: number;
  lastWelfare: number;
  events: GameEvent[];
  outcome: Outcome | null;
};
