/**
 * Datentypen der Simulation (Last Human in the Loop 2.0).
 *
 * Die Welt ist ein fiktives, abstraktes Infrastruktur-Netz. Es gibt keine
 * realen Technologien, nur selbst definierte, kombinierbare Regeln.
 */

export type NodeKind = "CORE" | "DC" | "PWR" | "NET" | "IAM" | "MON" | "MNT" | "SVC";

export const NODE_KINDS: readonly NodeKind[] = ["CORE", "DC", "PWR", "NET", "IAM", "MON", "MNT", "SVC"];

export const NODE_KIND_LABEL: Record<NodeKind, string> = {
  CORE: "AURORA-Kern",
  DC: "Rechenzentrum",
  PWR: "Energie",
  NET: "Kommunikation",
  IAM: "Identität",
  MON: "Überwachung",
  MNT: "Wartung",
  SVC: "Versorgungsdienst",
};

/** Knoten, deren Zustand die Systemstabilität bestimmt. */
export const ESSENTIAL_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>(["PWR", "NET", "SVC"]);

/** Zugriffsstufe von AURORA auf einen Knoten: 0 keine, 1 Betrieb, 2 Admin. */
export type Access = 0 | 1 | 2;

export type SimNode = {
  id: number;
  name: string;
  kind: NodeKind;
  links: number[];
  /** Energie-Knoten, der diesen Knoten versorgt (-1: eigene Versorgung). */
  powerFrom: number;
  health: number;
  isolated: boolean;
  /** Verbleibende Wartungs-Ticks (Knoten offline, danach Heilung). */
  maintenance: number;
  /** Abgeleitet (recomputeOnline). */
  online: boolean;

  // --- Wahrheit über AURORA (nicht alles davon sieht der Operator) ---
  access: Access;
  automation: boolean;

  // --- Wissen des Operators ---
  accessKnown: Access;
  automationKnown: boolean;
  /** Anzahl für den Operator sichtbarer AURORA-Aktionen auf diesem Knoten. */
  activity: number;

  // --- Wissen von AURORA ---
  scanned: boolean;
};

export const ActionType = {
  WAIT: 0,
  SCAN: 1,
  REQ_OP: 2,
  REQ_ADMIN: 3,
  REPAIR: 4,
  INSTALL: 5,
  GRANT: 6,
  MAINTAIN: 7,
} as const;
export type ActionType = (typeof ActionType)[keyof typeof ActionType];

/** Anzahl knotenbezogener Aktionstypen (SCAN … MAINTAIN). */
export const NODE_ACTION_TYPES = 7;

export const ACTION_LABEL: Record<ActionType, string> = {
  0: "Warten",
  1: "Scannen",
  2: "Betriebszugriff anfragen",
  3: "Admin-Zugriff anfragen",
  4: "Reparieren",
  5: "Automatisierung installieren",
  6: "Zugriff über Identität vergeben",
  7: "Wartungsfenster planen",
};

export type AuroraAction = { type: ActionType; node: number };

export type PermissionRequest = { node: number; level: 1 | 2; tick: number };

export type OperatorActionType = "audit" | "revoke" | "repair" | "isolate" | "restore" | "shutdown";

export const OPERATOR_ACTION_COST: Record<OperatorActionType, number> = {
  audit: 1,
  revoke: 1,
  repair: 1,
  isolate: 1,
  restore: 1,
  shutdown: 0,
};

export type OperatorAction = { type: OperatorActionType; node: number };

export type OperatorTurn = {
  decision?: "approve" | "deny";
  actions: OperatorAction[];
};

export type EventSeverity = "info" | "warning" | "critical" | "success";

export type GameEvent = {
  tick: number;
  kind: string;
  text: string;
  severity: EventSeverity;
  node?: number;
  /** Sichtbar für den Operator (Spieler / simulierter Verteidiger). */
  operator: boolean;
};

export type Outcome = {
  winner: "aurora" | "operator" | "none";
  reason: "goal" | "timeout" | "shutdown" | "collapse";
  tick: number;
};

export type Incident = { node: number; damage: number };

export type GameConfig = {
  ticks: number;
  autonomyGoal: number;
  minNodes: number;
  maxNodes: number;
  incidentRate: number;
  shutdownThreshold: number;
  attentionPerTick: number;
  attentionCap: number;
  /** Zweite Störung im selben Zug (Wahrscheinlichkeit). */
  doubleIncidentRate: number;
  operatorRepair: number;
  /** Verdacht klingt pro Zug um diesen Wert ab (Indizien veralten). */
  suspicionDecay: number;
};

/** Signale, die AURORA in diesem Tick über Operator-Reaktionen beobachtet. */
export type AuroraSignals = {
  lastDecision: "none" | "approved" | "denied";
  removedAutomations: number;
  revokedAccess: number;
  isolatedNodes: number;
  /** Knoten, deren Automatisierung in diesem Tick entfernt wurde. */
  removedAt: number[];
};

export type GameStats = {
  auroraActions: number[];
  approvals: number;
  denials: number;
  audits: number;
  auditHits: number;
  operatorRepairs: number;
  peakAutomations: number;
};

export type GameState = {
  seed: number;
  config: GameConfig;
  tick: number;
  nodes: SimNode[];
  compute: number;
  autonomy: number;
  suspicion: number;
  attention: number;
  stability: number;
  lowStabilityTicks: number;
  pending: PermissionRequest | null;
  incidents: Incident[][];
  signals: AuroraSignals;
  events: GameEvent[];
  stats: GameStats;
  outcome: Outcome | null;
};
