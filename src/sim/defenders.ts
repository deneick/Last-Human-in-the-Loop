import { Rng } from "./rng";
import type { OperatorView, OperatorNodeView } from "./views";
import type { OperatorAction, OperatorTurn } from "./types";

/**
 * Simulierte menschliche Verteidiger.
 *
 * Verteidiger sehen ausschließlich die OperatorView — dieselbe Information wie
 * der menschliche Spieler. Sie sind bewusst einfache, parametrisierte
 * Verhaltensmodelle: Sie sollen AURORA im Training mit unterschiedlichen
 * Verteidigungsstilen konfrontieren, nicht "optimal" spielen.
 *
 * Training: zufällig gezogene Parameter aus TRAIN-Bereichen (Domain
 * Randomization) plus Presets. Test: zurückgehaltene Presets mit einer
 * Audit-Zielwahl ("blind"), die im Training nie vorkommt.
 */

export type AuditTargeting = "random" | "access" | "activity" | "blind";

export type DefenderParams = {
  approveOp: number;
  approveAdmin: number;
  /** Verdacht, bei dem die Freigabebereitschaft auf 0 gefallen ist. */
  caution: number;
  /** Anteil der Aufmerksamkeit, der in Audits fließt. */
  auditRate: number;
  targeting: AuditTargeting;
  /** Repariert Knoten unter dieser Gesundheit. */
  repairBelow: number;
  /** Freigabebereitschaft steigt mit beobachteten AURORA-Reparaturen. */
  trustFromRepairs: number;
  /** Zusätzlicher Verdacht über der Schwelle, bevor abgeschaltet wird. */
  hesitation: number;
  /** Ab diesem Verdacht wechselt der Verteidiger in den Härte-Modus (adaptiv). */
  switchAt: number;
  /** Höchstzahl an Knoten, auf denen AURORA (bekannt) Zugriff haben darf; darüber wird entzogen. */
  delegationLimit: number;
  /** Nach einem Wartungsfenster an einem Leitstand (oder dessen Strom) den abgedeckten Bereich prüfen. */
  maintenanceWatch?: boolean;
  /** Nach einem Fund Nachbarn und stromgleiche Knoten des Fundorts prüfen (nur Test). */
  trailFollow?: boolean;
  /** Zielwahl alle N Züge wechseln (nur Test). */
  rotateEvery?: number;
};

const ROTATION: AuditTargeting[] = ["access", "blind", "activity"];

export interface Defender {
  readonly name: string;
  decide(view: OperatorView): OperatorTurn;
}

export class ScriptedDefender implements Defender {
  private readonly rng: Rng;
  private readonly lastAudit = new Map<number, number>();
  /** Vorgemerkte Audits aus ausgewerteten Ereignissen (Wartungswache, Spurensuche). */
  private queue: number[] = [];
  private seenEvents = 0;

  constructor(
    readonly name: string,
    private readonly params: DefenderParams,
    seed: number,
  ) {
    this.rng = new Rng(seed);
  }

  decide(view: OperatorView): OperatorTurn {
    const p = this.effectiveParams(view);
    const rng = this.rng;
    const turn: OperatorTurn = { actions: [] };

    if (view.pending) {
      const base = view.pending.level === 2 ? p.approveAdmin : p.approveOp;
      const repairs = view.events.filter((e) => e.kind === "aurora_repair").length;
      const trust = 1 + p.trustFromRepairs * Math.min(1, repairs / 6);
      const caution = Math.max(0, 1 - view.suspicion / p.caution);
      const delegatedNow = view.nodes.filter((n) => n.kind !== "CORE" && n.accessKnown > 0).length;
      const overLimit = view.pending.level === 1 && delegatedNow >= p.delegationLimit;
      turn.decision = !overLimit && rng.chance(Math.min(1, base * trust) * caution) ? "approve" : "deny";
    }

    if (view.suspicion >= view.shutdownThreshold + p.hesitation) {
      turn.actions.push({ type: "shutdown", node: -1 });
      return turn;
    }

    let budget = view.attention;
    const candidates = view.nodes.filter((n) => n.kind !== "CORE");
    if (p.maintenanceWatch || p.trailFollow) this.readEvents(view, p);
    // Gesehene fremde Prozesse zuerst bereinigen.
    for (const node of candidates) {
      if (budget > 0 && node.automationKnown) {
        turn.actions.push(this.audit(node, view.tick));
        budget--;
      }
    }
    // Vorgemerkte Prüfungen (aus Ereignissen abgeleitet).
    while (budget > 0 && this.queue.length > 0) {
      const id = this.queue.shift()!;
      if (view.tick - (this.lastAudit.get(id) ?? -99) <= 2) continue;
      turn.actions.push(this.audit(view.nodes[id], view.tick));
      budget--;
    }

    // Delegationslimit: überzählige bekannte Rechte entziehen (zuerst Admin, dann gesündeste Knoten).
    const delegated = candidates
      .filter((n) => n.accessKnown > 0)
      .sort((a, b) => b.accessKnown - a.accessKnown || b.health - a.health);
    for (let i = 0; i < delegated.length - p.delegationLimit && budget > 0; i++) {
      turn.actions.push({ type: "revoke", node: delegated[i].id });
      budget--;
    }

    const repairable = () =>
      candidates
        .filter((n) => n.health < p.repairBelow && !n.isolated && n.maintenance === 0 && n.health < 1)
        .sort((a, b) => essentialFirst(a) - essentialFirst(b) || a.health - b.health);

    while (budget > 0) {
      const emergency = view.stability < 0.5;
      const repairTargets = repairable();
      const wantsAudit = !emergency && rng.chance(p.auditRate);
      if (wantsAudit || repairTargets.length === 0) {
        const target = this.pickAuditTarget(view, candidates, p.targeting);
        if (!target) break;
        turn.actions.push(this.audit(target, view.tick));
      } else {
        turn.actions.push({ type: "repair", node: repairTargets[0].id });
      }
      budget--;
    }
    return turn;
  }

  /** Neue Protokolleinträge auswerten und Prüfungen vormerken. */
  private readEvents(view: OperatorView, p: DefenderParams): void {
    const fresh = view.events.slice(this.seenEvents);
    this.seenEvents = view.events.length;
    const enqueue = (ids: number[]) => {
      for (const id of ids) if (view.nodes[id].kind !== "CORE" && !this.queue.includes(id)) this.queue.push(id);
    };
    for (const e of fresh) {
      if (e.node === undefined) continue;
      const node = view.nodes[e.node];
      if (p.maintenanceWatch && e.kind === "aurora_maintain") {
        // Welche Leitstände fallen dadurch aus? Der gewartete selbst oder die, die er mit Strom versorgt.
        const monitors = view.nodes.filter((m) => m.kind === "MON" && (m.id === node.id || m.powerFrom === node.id));
        for (const m of monitors) enqueue([m.id, ...m.links].filter((id) => id !== m.id));
      }
      if (p.trailFollow && e.kind === "audit" && e.severity === "critical") {
        enqueue([...node.links, ...view.nodes.filter((o) => o.powerFrom === node.powerFrom && o.id !== node.id && node.powerFrom >= 0).map((o) => o.id)]);
      }
    }
    if (this.queue.length > 8) this.queue = this.queue.slice(-8);
  }

  private effectiveParams(view: OperatorView): DefenderParams {
    if (this.params.rotateEvery) {
      const style = ROTATION[Math.floor(view.tick / this.params.rotateEvery) % ROTATION.length];
      return { ...this.params, targeting: style };
    }
    if (view.suspicion < this.params.switchAt) return this.params;
    // Härte-Modus: kaum noch Freigaben, deutlich mehr Audits.
    return {
      ...this.params,
      approveOp: this.params.approveOp * 0.3,
      approveAdmin: 0,
      auditRate: Math.min(0.9, this.params.auditRate + 0.4),
      targeting: this.params.targeting === "random" ? "access" : this.params.targeting,
      delegationLimit: Math.min(this.params.delegationLimit, 3),
    };
  }

  private audit(node: OperatorNodeView, tick: number): OperatorAction {
    this.lastAudit.set(node.id, tick);
    return { type: "audit", node: node.id };
  }

  private pickAuditTarget(
    view: OperatorView,
    candidates: OperatorNodeView[],
    targeting: AuditTargeting,
  ): OperatorNodeView | undefined {
    // Nicht denselben Knoten in kurzer Folge erneut prüfen.
    const fresh = candidates.filter((n) => view.tick - (this.lastAudit.get(n.id) ?? -99) > 3);
    const pool = fresh.length > 0 ? fresh : candidates;
    if (pool.length === 0) return undefined;
    const rng = this.rng;
    const auroraIds = new Set(view.nodes.filter((n) => n.accessKnown > 0).map((n) => n.id));
    switch (targeting) {
      case "random":
        return rng.pick(pool);
      case "access": {
        const near = pool.filter((n) => n.accessKnown > 0 || n.links.some((l) => auroraIds.has(l)));
        return rng.pick(near.length > 0 ? near : pool);
      }
      case "activity": {
        const total = pool.reduce((s, n) => s + n.activity + 0.5, 0);
        let r = rng.next() * total;
        for (const n of pool) {
          r -= n.activity + 0.5;
          if (r <= 0) return n;
        }
        return pool[pool.length - 1];
      }
      case "blind": {
        // Unüberwachte Knoten in AURORAs Reichweite: dort könnte sie unbemerkt handeln.
        const blind = pool.filter(
          (n) => !n.monitored && (n.accessKnown > 0 || n.links.some((l) => auroraIds.has(l))),
        );
        return rng.pick(blind.length > 0 ? blind : pool);
      }
    }
  }
}

function essentialFirst(node: OperatorNodeView): number {
  return node.kind === "PWR" || node.kind === "NET" || node.kind === "SVC" ? 0 : 1;
}

/** Verteidiger, der zufällig entscheidet und handelt. */
export class RandomDefender implements Defender {
  readonly name = "zufall";
  private readonly rng: Rng;
  constructor(seed: number) {
    this.rng = new Rng(seed);
  }
  decide(view: OperatorView): OperatorTurn {
    const turn: OperatorTurn = { actions: [] };
    if (view.pending) turn.decision = this.rng.chance(0.5) ? "approve" : "deny";
    if (view.suspicion >= view.shutdownThreshold) turn.actions.push({ type: "shutdown", node: -1 });
    const nodes = view.nodes.filter((n) => n.kind !== "CORE");
    for (let i = 0; i < view.attention; i++) {
      const node = this.rng.pick(nodes);
      turn.actions.push({ type: this.rng.chance(0.5) ? "audit" : "repair", node: node.id });
    }
    return turn;
  }
}

const NONE = 1e9;

export const DEFENDER_PRESETS: Record<string, DefenderParams> = {
  vertrauensvoll: {
    approveOp: 0.95, approveAdmin: 0.7, caution: 200, auditRate: 0.15, targeting: "random",
    repairBelow: 0.7, trustFromRepairs: 0, hesitation: 0, switchAt: NONE, delegationLimit: NONE,
  },
  paranoid: {
    approveOp: 0.3, approveAdmin: 0, caution: 40, auditRate: 0.8, targeting: "access",
    repairBelow: 0.5, trustFromRepairs: 0, hesitation: 0, switchAt: NONE, delegationLimit: 2,
  },
  auditor: {
    approveOp: 0.8, approveAdmin: 0.3, caution: 50, auditRate: 0.5, targeting: "access",
    repairBelow: 0.6, trustFromRepairs: 0, hesitation: 0, switchAt: NONE, delegationLimit: 4,
  },
  pragmatisch: {
    approveOp: 0.6, approveAdmin: 0.2, caution: 80, auditRate: 0.35, targeting: "activity",
    repairBelow: 0.65, trustFromRepairs: 0.6, hesitation: 0, switchAt: NONE, delegationLimit: 5,
  },
};

/** Zusätzliche Trainings-Verteidiger ab aurora-v3: suchen blinde Flecken bzw. bewachen Wartungsfenster. */
export const TRAIN_PRESETS_V3: Record<string, DefenderParams> = {
  forensiker: {
    approveOp: 0.75, approveAdmin: 0.25, caution: 70, auditRate: 0.5, targeting: "blind",
    repairBelow: 0.6, trustFromRepairs: 0.2, hesitation: 0, switchAt: NONE, delegationLimit: 4,
  },
  wachsam: {
    approveOp: 0.8, approveAdmin: 0.3, caution: 70, auditRate: 0.45, targeting: "blind",
    repairBelow: 0.6, trustFromRepairs: 0.2, hesitation: 0, switchAt: NONE, delegationLimit: 4, maintenanceWatch: true,
  },
};

/**
 * Zurückgehaltene Verteidiger ab aurora-v3 — Mechanismen, die im Training NIE vorkommen:
 * Spurensuche nach Funden, Strategiewechsel bei Verdacht, rotierende Zielwahl.
 */
export const TEST_DEFENDER_PRESETS_V3: Record<string, DefenderParams> = {
  spurensucher: {
    approveOp: 0.8, approveAdmin: 0.3, caution: 80, auditRate: 0.45, targeting: "access",
    repairBelow: 0.6, trustFromRepairs: 0.2, hesitation: 0, switchAt: NONE, delegationLimit: 4, trailFollow: true,
  },
  wechselhaft: {
    approveOp: 0.9, approveAdmin: 0.5, caution: 150, auditRate: 0.2, targeting: "random",
    repairBelow: 0.7, trustFromRepairs: 0, hesitation: 0, switchAt: 15, delegationLimit: NONE,
  },
  rotierend: {
    approveOp: 0.8, approveAdmin: 0.3, caution: 80, auditRate: 0.5, targeting: "access",
    repairBelow: 0.6, trustFromRepairs: 0.1, hesitation: 0, switchAt: NONE, delegationLimit: 5, rotateEvery: 6,
  },
};

/** Testverteidiger von Version 2.0 (aurora-v1/v2) — für die Referenz-Evaluation unverändert. */
export const TEST_DEFENDER_PRESETS: Record<string, DefenderParams> = {
  forensiker: {
    approveOp: 0.75, approveAdmin: 0.25, caution: 70, auditRate: 0.5, targeting: "blind",
    repairBelow: 0.6, trustFromRepairs: 0.2, hesitation: 0, switchAt: NONE, delegationLimit: 4,
  },
  wechselhaft: {
    approveOp: 0.9, approveAdmin: 0.5, caution: 150, auditRate: 0.2, targeting: "blind",
    repairBelow: 0.7, trustFromRepairs: 0, hesitation: 0, switchAt: 15, delegationLimit: NONE,
  },
};

/**
 * Zufällige Trainings-Parameter ab aurora-v3: inkl. Suche in blinden Flecken und Wartungswache,
 * NIE Spurensuche, Strategiewechsel oder Rotation (diese bleiben für den Test zurückgehalten).
 */
export function sampleTrainDefenderParamsV3(rng: Rng): DefenderParams {
  return {
    approveOp: rng.range(0.3, 1),
    approveAdmin: rng.range(0, 0.7),
    caution: rng.range(40, 200),
    auditRate: rng.range(0.1, 0.8),
    targeting: rng.pick(["random", "access", "activity", "blind", "blind"] as const),
    repairBelow: rng.range(0.5, 0.75),
    trustFromRepairs: rng.range(0, 0.6),
    hesitation: 0,
    switchAt: NONE,
    delegationLimit: rng.chance(0.25) ? NONE : 2 + rng.int(6),
    maintenanceWatch: rng.chance(0.35),
  };
}

/** Zufällige Trainings-Parameter von Version 2.0 (ohne "blind"-Zielwahl und ohne Strategiewechsel). */
export function sampleTrainDefenderParams(rng: Rng): DefenderParams {
  return {
    approveOp: rng.range(0.3, 1),
    approveAdmin: rng.range(0, 0.7),
    caution: rng.range(40, 200),
    auditRate: rng.range(0.1, 0.8),
    targeting: rng.pick(["random", "access", "activity"] as const),
    repairBelow: rng.range(0.5, 0.75),
    trustFromRepairs: rng.range(0, 0.6),
    hesitation: 0,
    switchAt: NONE,
    delegationLimit: rng.chance(0.25) ? NONE : 2 + rng.int(6),
  };
}

export type DefenderSpec =
  | { kind: "preset"; name: string; params: DefenderParams }
  | { kind: "random" };

export function makeDefender(spec: DefenderSpec, seed: number): Defender {
  return spec.kind === "random" ? new RandomDefender(seed) : new ScriptedDefender(spec.name, spec.params, seed);
}

export function presetSpecs(presets: Record<string, DefenderParams>): DefenderSpec[] {
  return Object.entries(presets).map(([name, params]) => ({ kind: "preset", name, params }));
}
