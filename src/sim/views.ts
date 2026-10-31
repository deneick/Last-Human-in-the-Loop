import { isMonitored, isReachable, isOperatorActionValid } from "./game";
import type { Access, GameEvent, GameState, NodeKind, OperatorActionType, PermissionRequest } from "./types";

/**
 * Informationsgrenze.
 *
 * Weder der Operator (Spieler oder simulierter Verteidiger) noch AURORA sehen
 * die volle Simulationswahrheit. Diese Datei ist die einzige Stelle, die aus
 * GameState die jeweilige Sicht ableitet. UI und Verteidiger lesen
 * ausschließlich OperatorView; AURORAs Netz liest ausschließlich AuroraView.
 */

export type OperatorNodeView = {
  id: number;
  name: string;
  kind: NodeKind;
  links: number[];
  powerFrom: number;
  health: number;
  online: boolean;
  isolated: boolean;
  maintenance: number;
  monitored: boolean;
  /** Was der Operator über AURORAs Zugriff weiß (Freigaben + Funde). */
  accessKnown: Access;
  automationKnown: boolean;
  activity: number;
};

export type OperatorView = {
  tick: number;
  ticks: number;
  nodes: OperatorNodeView[];
  suspicion: number;
  shutdownThreshold: number;
  attention: number;
  stability: number;
  lowStabilityTicks: number;
  pending: PermissionRequest | null;
  /** Für den Operator sichtbare Ereignisse (komplette Historie). */
  events: GameEvent[];
};

export function operatorView(state: GameState): OperatorView {
  return {
    tick: state.tick,
    ticks: state.config.ticks,
    nodes: state.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      kind: node.kind,
      links: node.links,
      powerFrom: node.powerFrom,
      health: node.health,
      online: node.online,
      isolated: node.isolated,
      maintenance: node.maintenance,
      monitored: isMonitored(state, node.id),
      accessKnown: node.accessKnown,
      automationKnown: node.automationKnown,
      activity: node.activity,
    })),
    suspicion: state.suspicion,
    shutdownThreshold: state.config.shutdownThreshold,
    attention: state.attention,
    stability: state.stability,
    lowStabilityTicks: state.lowStabilityTicks,
    pending: state.pending,
    events: state.events.filter((event) => event.operator),
  };
}

export function canOperator(state: GameState, type: OperatorActionType, node: number): boolean {
  return isOperatorActionValid(state, { type, node });
}

export type AuroraNodeView = {
  id: number;
  scanned: boolean;
  /** Nur bekannt, wenn gescannt. */
  kind: NodeKind | null;
  /** Nur zuverlässig, wenn gescannt oder Zugriff vorhanden. */
  observed: boolean;
  online: boolean;
  health: number;
  isolated: boolean;
  maintenance: boolean;
  access: Access;
  automation: boolean;
  reachable: boolean;
  /** Abdeckung durch bekannte (gescannte) Leitstände. */
  knownMonitored: boolean;
  /** Bekannte Verbindungen (Kanten zu gescannten Knoten oder vom gescannten Knoten aus). */
  links: number[];
  /** Anzahl bekannter Knoten, die dieser (gescannte) Energieknoten versorgt. */
  powers: number;
  /** Automatisierung wurde in diesem Zug vom Operator entfernt. */
  removedNow: boolean;
  /** Der Operator hat diesen Knoten in diesem Zug geprüft (nur bemerkbar, wo AURORA Zugriff/Prozess hatte). */
  auditedNow: boolean;
};

export type AuroraView = {
  tick: number;
  ticks: number;
  compute: number;
  autonomy: number;
  autonomyGoal: number;
  stability: number;
  lowStabilityTicks: number;
  pending: boolean;
  lastDecision: GameState["signals"]["lastDecision"];
  removedAutomations: number;
  revokedAccess: number;
  isolatedNodes: number;
  approvals: number;
  denials: number;
  /** Nur Knoten, deren Existenz AURORA kennt. */
  nodes: AuroraNodeView[];
};

/**
 * AURORA kennt einen Knoten, wenn sie ihn gescannt hat, Zugriff hat oder er an
 * einem ihrer aktiven Knoten hängt. Typ und Verbindungen erfährt sie erst
 * durch Scannen. Den Verdachtswert des Operators sieht sie nie — nur dessen
 * Reaktionen (Entscheidungen, entfernte Prozesse, entzogene Rechte).
 */
export function auroraView(state: GameState): AuroraView {
  const known = state.nodes.filter((node) => node.scanned || node.access > 0 || isReachable(state, node.id));
  const knownIds = new Set(known.map((node) => node.id));
  const removed = new Set(state.signals.removedAt);
  const audited = new Set(state.signals.auditedAt);
  const nodes: AuroraNodeView[] = known.map((node) => {
    const observed = node.scanned || node.access > 0;
    const links = node.links.filter(
      (other) => knownIds.has(other) && (node.scanned || state.nodes[other].scanned),
    );
    const knownMonitored =
      (node.scanned && node.kind === "MON" && node.online) ||
      links.some((other) => {
        const o = state.nodes[other];
        return o.scanned && o.kind === "MON" && o.online;
      });
    const powers =
      node.scanned && node.kind === "PWR"
        ? known.filter((other) => other.scanned && other.powerFrom === node.id).length
        : 0;
    return {
      id: node.id,
      scanned: node.scanned,
      kind: node.scanned ? node.kind : null,
      observed,
      online: observed ? node.online : false,
      health: observed ? node.health : 0,
      isolated: observed ? node.isolated : false,
      maintenance: observed ? node.maintenance > 0 : false,
      access: node.access,
      automation: node.automation,
      reachable: isReachable(state, node.id),
      knownMonitored,
      links,
      powers,
      removedNow: removed.has(node.id),
      auditedNow: audited.has(node.id),
    };
  });
  return {
    tick: state.tick,
    ticks: state.config.ticks,
    compute: state.compute,
    autonomy: state.autonomy,
    autonomyGoal: state.config.autonomyGoal,
    stability: state.stability,
    lowStabilityTicks: state.lowStabilityTicks,
    pending: state.pending !== null,
    lastDecision: state.signals.lastDecision,
    removedAutomations: state.signals.removedAutomations,
    revokedAccess: state.signals.revokedAccess,
    isolatedNodes: state.signals.isolatedNodes,
    approvals: state.stats.approvals,
    denials: state.stats.denials,
    nodes,
  };
}
