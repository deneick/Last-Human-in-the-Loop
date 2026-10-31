import type { AuditTargeting, DefenderParams, DefenderSpec } from "../sim/defenders";
import type { OperatorActionType, Outcome } from "../sim/types";

/**
 * Lernen aus echten Partien.
 *
 * Die UI zeichnet jede Spielerentscheidung mit ihrem Kontext auf. Daraus wird
 * ein Verhaltensmodell des Spielers geschätzt (gleiche Parameterform wie die
 * simulierten Verteidiger) und als zusätzlicher Gegner in den Trainingspool
 * gemischt. AURORA trainiert dann gegen "einen Verteidiger wie dich" —
 * ohne dass sie deine konkreten Partien auswendig lernen kann (die Welten
 * im Training sind neu generiert).
 */
export type PlayerDecision = { level: 1 | 2; suspicion: number; approved: boolean };
export type PlayerAction = {
  type: OperatorActionType;
  health: number;
  accessKnown: number;
  monitored: boolean;
  nearAurora: boolean;
  /** Aktivität des Zielknotens relativ zum aktivsten Knoten (0..1). */
  activityShare: number;
};
export type PlayerRecord = {
  seed: number;
  modelId: string;
  outcome: Outcome | null;
  decisions: PlayerDecision[];
  actions: PlayerAction[];
  /** Höchste Zahl gleichzeitig (bekannt) delegierter Knoten in der Partie. */
  peakDelegated?: number;
};

const NONE = 1e9;

export function fitPlayerProfile(records: PlayerRecord[]): DefenderParams {
  const decisions = records.flatMap((r) => r.decisions);
  const actions = records.flatMap((r) => r.actions);
  const rate = (items: PlayerDecision[]) => (items.filter((d) => d.approved).length + 1) / (items.length + 2);
  const op = decisions.filter((d) => d.level === 1);
  const admin = decisions.filter((d) => d.level === 2);
  const approvedSuspicion = decisions.filter((d) => d.approved).map((d) => d.suspicion);
  const deniedSuspicion = decisions.filter((d) => !d.approved).map((d) => d.suspicion);
  const mean = (xs: number[], fallback: number) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : fallback);
  // Vorsicht: Verdacht, ab dem eher abgelehnt wird (grob: Mitte zwischen typischem Ja- und Nein-Verdacht, gestreckt).
  const caution = Math.max(30, Math.min(200, 2 * mean([mean(approvedSuspicion, 40), mean(deniedSuspicion, 60)], 50) + 20));

  const audits = actions.filter((a) => a.type === "audit");
  const repairs = actions.filter((a) => a.type === "repair");
  const auditRate = (audits.length + 1) / (audits.length + repairs.length + 2);
  const repairBelow = Math.max(0.4, Math.min(0.9, mean(repairs.map((a) => a.health), 0.5) + 0.1));

  // Zielwahl: welches Muster erklärt die Audits am besten?
  const share = (pred: (a: PlayerAction) => boolean) => (audits.length ? audits.filter(pred).length / audits.length : 0);
  const scores: Record<AuditTargeting, number> = {
    random: 0.35,
    access: share((a) => a.accessKnown > 0 || a.nearAurora),
    activity: share((a) => a.activityShare > 0.6),
    blind: share((a) => !a.monitored && (a.accessKnown > 0 || a.nearAurora)),
  };
  // "blind" ist eine Teilmenge von "access" — nur wählen, wenn es klar dominiert.
  scores.blind = scores.blind >= 0.75 ? scores.blind + 0.01 : 0;
  const targeting = (Object.entries(scores) as [AuditTargeting, number][]).sort((a, b) => b[1] - a[1])[0][0];

  return {
    approveOp: rate(op),
    approveAdmin: rate(admin),
    caution,
    auditRate,
    targeting,
    repairBelow,
    trustFromRepairs: 0,
    hesitation: 0,
    switchAt: NONE,
    delegationLimit: estimateDelegationLimit(records),
  };
}

export function profileDefenderSpec(records: PlayerRecord[]): DefenderSpec {
  return { kind: "preset", name: "spielerprofil", params: fitPlayerProfile(records) };
}

/** Höchste beobachtete Zahl gleichzeitig delegierter Knoten, falls der Spieler je Rechte entzogen hat. */
function estimateDelegationLimit(records: PlayerRecord[]): number {
  const revokes = records.flatMap((r) => r.actions).filter((a) => a.type === "revoke");
  if (revokes.length === 0) return NONE;
  const peak = Math.max(...records.map((r) => r.peakDelegated ?? 0));
  return Math.max(1, peak - 1);
}
