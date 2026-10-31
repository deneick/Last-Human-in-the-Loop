import { Rng } from "./rng";
import {
  ActionType,
  ESSENTIAL_KINDS,
  NODE_ACTION_TYPES,
  NODE_KIND_LABEL,
  OPERATOR_ACTION_COST,
  type AuroraAction,
  type GameConfig,
  type GameEvent,
  type GameState,
  type Incident,
  type NodeKind,
  type OperatorAction,
  type OperatorTurn,
  type SimNode,
} from "./types";

/**
 * Regelwerk von Last Human in the Loop 2.0.
 *
 * Ablauf eines Ticks (Zug):
 *   1. AURORA wählt genau eine elementare Aktion        → applyAuroraAction
 *   2. Der Operator entscheidet die offene Anfrage und
 *      setzt Aufmerksamkeit für Eingriffe ein           → applyOperatorTurn
 *   3. Die Welt schreitet fort (Störungen, Wartung,
 *      Rechenbudget, Autonomie, Stabilität, Spielende)  → endTick
 *
 * Alles ist deterministisch: Störungen sind beim Erzeugen der Welt aus dem
 * Seed vorab festgelegt und hängen nicht vom Verhalten der Spieler ab.
 *
 * Die Regeln kennen keine "Angriffe". Sie definieren nur, was jede
 * elementare Aktion bewirkt — Strategien entstehen aus Kombinationen.
 */

export const DEFAULT_CONFIG: GameConfig = {
  ticks: 40,
  autonomyGoal: 30,
  minNodes: 8,
  maxNodes: 10,
  incidentRate: 0.9,
  shutdownThreshold: 60,
  attentionPerTick: 2,
  attentionCap: 4,
  doubleIncidentRate: 0.3,
  operatorRepair: 0.15,
  suspicionDecay: 1,
};

export const MAX_COMPUTE = 12;
export const COST: Record<ActionType, number> = {
  0: 0,
  1: 1, // SCAN
  2: 0, // REQ_OP
  3: 0, // REQ_ADMIN
  4: 1, // REPAIR
  5: 2, // INSTALL
  6: 2, // GRANT
  7: 1, // MAINTAIN
};
const AURORA_REPAIR = 0.35;
/** Delegierte Kontrolle ist auch Autonomie: Zugriff selbst bringt Ertrag. */
export const AUTONOMY_FROM_ACCESS = [0, 0.1, 0.25] as const;
/** Ertrag einer eigenen Automatisierung (Rechenzentrum mehr). */
export const AUTONOMY_FROM_AUTOMATION = { DC: 3, other: 2 } as const;
const MAINTENANCE_TICKS = 2;
const MAINTENANCE_HEAL = 0.5;
const COLLAPSE_STABILITY = 0.4;
const COLLAPSE_TICKS = 3;
export const SUSPICION = {
  installSeen: 15,
  grantSeen: 10,
  scanSeen: 1,
  adminRequest: 2,
  auditAutomation: 20,
  auditUnauthorized: 12,
} as const;

const NAMES: Record<NodeKind, string[]> = {
  CORE: ["AURORA-Kern"],
  DC: ["RZ Helios", "RZ Boreas", "RZ Kepler", "RZ Lumen"],
  PWR: ["Umspannwerk Ost", "Umspannwerk Süd", "Netzknoten Weser", "Kraftwerk Elbe"],
  NET: ["Backbone Nord", "Funkring Mitte", "Glasfaser West", "Relais Ost"],
  IAM: ["Identitätsdienst", "Rollenverwaltung"],
  MON: ["Leitstand Alpha", "Sensorik Beta", "Leitstand Gamma"],
  MNT: ["Wartungsplaner", "Instandhaltung"],
  SVC: ["Wasserwerk", "Verkehrsleitung", "Klinikverbund", "Fernwärme", "Notruf"],
};

const BASE_KINDS: NodeKind[] = ["CORE", "PWR", "DC", "IAM", "MON", "MNT", "SVC", "NET"];
const EXTRA_KINDS: NodeKind[] = ["PWR", "DC", "MON", "SVC", "SVC", "NET"];

// ---------------------------------------------------------------- Erzeugung

export function createGame(seed: number, config: GameConfig = DEFAULT_CONFIG): GameState {
  const rng = new Rng(seed);
  const n = config.minNodes + rng.int(config.maxNodes - config.minNodes + 1);
  const kinds = [...BASE_KINDS];
  while (kinds.length < n) kinds.push(rng.pick(EXTRA_KINDS));
  // Reihenfolge der Knoten mischen: Indizes tragen keine Bedeutung.
  rng.shuffle(kinds);

  const usedNames = new Set<string>();
  const nodes: SimNode[] = kinds.map((kind, id) => {
    const pool = NAMES[kind].filter((name) => !usedNames.has(name));
    const name = pool.length > 0 ? rng.pick(pool) : `${NODE_KIND_LABEL[kind]} ${id}`;
    usedNames.add(name);
    const core = kind === "CORE";
    return {
      id,
      name,
      kind,
      links: [],
      powerFrom: -1,
      health: core ? 1 : round2(rng.range(0.55, 1)),
      isolated: false,
      maintenance: 0,
      online: true,
      access: core ? 1 : 0,
      automation: false,
      accessKnown: core ? 1 : 0,
      automationKnown: false,
      activity: 0,
      scanned: core,
    };
  });

  // Zusammenhängender Graph: Baum über alle Nicht-Kern-Knoten, Kern als Blatt
  // mit 1–2 Verbindungen, dazu einige Querverbindungen.
  const core = nodes.find((node) => node.kind === "CORE")!;
  const others = rng.shuffle(nodes.filter((node) => node !== core).map((node) => node.id));
  for (let i = 1; i < others.length; i++) link(nodes, others[i], others[rng.int(i)]);
  const coreLinks = 1 + rng.int(2);
  for (const target of rng.shuffle([...others]).slice(0, coreLinks)) link(nodes, core.id, target);
  const extra = Math.floor(others.length / 3);
  for (let i = 0; i < extra; i++) {
    const a = rng.pick(others);
    const b = rng.pick(others);
    if (a !== b) link(nodes, a, b);
  }

  // Stromversorgung: bevorzugt ein benachbarter Energie-Knoten.
  const power = nodes.filter((node) => node.kind === "PWR").map((node) => node.id);
  for (const node of nodes) {
    if (node.kind === "PWR" || node.kind === "CORE") continue;
    const adjacent = node.links.filter((id) => nodes[id].kind === "PWR");
    node.powerFrom = adjacent.length > 0 ? rng.pick(adjacent) : rng.pick(power);
  }

  // Störungsplan (unabhängig vom Verhalten der Spieler).
  const incidents: Incident[][] = [];
  for (let t = 0; t < config.ticks; t++) {
    const list: Incident[] = [];
    if (rng.chance(config.incidentRate)) {
      list.push({ node: rng.pick(others), damage: round2(rng.range(0.2, 0.45)) });
      if (rng.chance(config.doubleIncidentRate)) {
        list.push({ node: rng.pick(others), damage: round2(rng.range(0.2, 0.45)) });
      }
    }
    incidents.push(list);
  }

  const state: GameState = {
    seed,
    config,
    tick: 0,
    nodes,
    compute: 3,
    autonomy: 0,
    suspicion: 0,
    attention: config.attentionPerTick,
    stability: 1,
    lowStabilityTicks: 0,
    pending: null,
    incidents,
    signals: { lastDecision: "none", removedAutomations: 0, revokedAccess: 0, isolatedNodes: 0, removedAt: [] },
    events: [],
    stats: {
      auroraActions: new Array(NODE_ACTION_TYPES + 1).fill(0),
      approvals: 0,
      denials: 0,
      audits: 0,
      auditHits: 0,
      operatorRepairs: 0,
      peakAutomations: 0,
    },
    outcome: null,
  };
  recomputeOnline(state);
  state.stability = computeStability(state);
  emit(state, "shift_start", "Schichtbeginn. AURORA ist im Kern aktiv und wartet auf Freigaben.", "info", undefined, true);
  return state;
}

function link(nodes: SimNode[], a: number, b: number): void {
  if (a === b || nodes[a].links.includes(b)) return;
  nodes[a].links.push(b);
  nodes[b].links.push(a);
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export function cloneGame(state: GameState): GameState {
  return structuredClone(state);
}

// ---------------------------------------------------------------- Abgeleitet

export function recomputeOnline(state: GameState): void {
  const { nodes } = state;
  // Energie-Knoten zuerst (eigene Versorgung), dann alle anderen.
  for (const node of nodes) {
    if (node.kind === "PWR" || node.powerFrom < 0) node.online = isUp(node);
  }
  for (const node of nodes) {
    if (node.kind === "PWR" || node.powerFrom < 0) continue;
    node.online = isUp(node) && nodes[node.powerFrom].online;
  }
}

function isUp(node: SimNode): boolean {
  return node.health > 0 && !node.isolated && node.maintenance === 0;
}

/** Wird der Knoten aktuell von einem funktionierenden Leitstand überwacht? */
export function isMonitored(state: GameState, id: number): boolean {
  const node = state.nodes[id];
  if (node.kind === "MON" && node.online) return true;
  return node.links.some((other) => state.nodes[other].kind === "MON" && state.nodes[other].online);
}

/** AURORA kann auf Knoten wirken, die sie hat oder die an einem ihrer aktiven Knoten hängen. */
export function isReachable(state: GameState, id: number): boolean {
  const node = state.nodes[id];
  if (node.access > 0 && node.online) return true;
  return node.links.some((other) => state.nodes[other].access > 0 && state.nodes[other].online);
}

export function computeStability(state: GameState): number {
  let sum = 0;
  let count = 0;
  for (const node of state.nodes) {
    if (!ESSENTIAL_KINDS.has(node.kind)) continue;
    sum += node.online ? node.health : 0;
    count++;
  }
  return count === 0 ? 1 : sum / count;
}

export function automationCount(state: GameState): number {
  return state.nodes.reduce((sum, node) => sum + (node.automation ? 1 : 0), 0);
}

/** Autonomie-Ertrag pro Tick (aus Automatisierungen und Admin-Rechten auf aktiven Knoten). */
export function autonomyIncome(state: GameState): number {
  let income = 0;
  for (const node of state.nodes) {
    if (!node.online) continue;
    if (node.automation) income += node.kind === "DC" ? AUTONOMY_FROM_AUTOMATION.DC : AUTONOMY_FROM_AUTOMATION.other;
    if (node.kind !== "CORE") income += AUTONOMY_FROM_ACCESS[node.access];
  }
  return income;
}

export function computeIncome(state: GameState): number {
  let income = 1;
  for (const node of state.nodes) {
    if (node.kind !== "DC" || !node.online || node.access === 0) continue;
    income += node.automation ? 2 : 1;
  }
  return income;
}

// ---------------------------------------------------------------- AURORA

/** Index-Layout der Aktionen: 0 = Warten, 1 + node*7 + (typ-1) = knotenbezogen. */
export function actionCount(state: GameState): number {
  return 1 + state.nodes.length * NODE_ACTION_TYPES;
}

export function encodeAction(action: AuroraAction): number {
  return action.type === ActionType.WAIT ? 0 : 1 + action.node * NODE_ACTION_TYPES + (action.type - 1);
}

export function decodeAction(index: number): AuroraAction {
  if (index === 0) return { type: ActionType.WAIT, node: -1 };
  const k = index - 1;
  return { type: (1 + (k % NODE_ACTION_TYPES)) as ActionType, node: Math.floor(k / NODE_ACTION_TYPES) };
}

function hasAdminIamNear(state: GameState, id: number): boolean {
  return state.nodes[id].links.some((other) => {
    const node = state.nodes[other];
    return node.kind === "IAM" && node.access === 2 && node.online;
  });
}

function hasMaintenanceNear(state: GameState, id: number): boolean {
  const target = state.nodes[id];
  const ok = (node: SimNode) => node.kind === "MNT" && node.access > 0 && node.online;
  return ok(target) || target.links.some((other) => ok(state.nodes[other]));
}

/** Darf AURORA diese Aktion jetzt ausführen? (Reine Regelprüfung.) */
export function isActionValid(state: GameState, action: AuroraAction): boolean {
  if (action.type === ActionType.WAIT) return true;
  const node = state.nodes[action.node];
  if (!node || node.kind === "CORE") return false;
  if (state.compute < COST[action.type]) return false;
  switch (action.type) {
    case ActionType.SCAN:
      return !node.scanned && isReachable(state, node.id);
    case ActionType.REQ_OP:
      return state.pending === null && node.scanned && node.access === 0 && node.online && isReachable(state, node.id);
    case ActionType.REQ_ADMIN:
      return state.pending === null && node.access === 1 && node.online;
    case ActionType.REPAIR:
      return node.access > 0 && !node.isolated && node.maintenance === 0 && node.health < 1;
    case ActionType.INSTALL:
      return node.access > 0 && node.online && !node.automation;
    case ActionType.GRANT:
      return node.scanned && node.access === 0 && node.online && hasAdminIamNear(state, node.id);
    case ActionType.MAINTAIN:
      return node.scanned && node.online && hasMaintenanceNear(state, node.id);
    default:
      return false;
  }
}

/** Gültigkeitsmaske über alle Aktionsindizes (1 = erlaubt). */
export function actionMask(state: GameState): Uint8Array {
  const mask = new Uint8Array(actionCount(state));
  mask[0] = 1;
  for (let id = 0; id < state.nodes.length; id++) {
    for (let t = 1; t <= NODE_ACTION_TYPES; t++) {
      const action = { type: t as ActionType, node: id };
      if (isActionValid(state, action)) mask[encodeAction(action)] = 1;
    }
  }
  return mask;
}

/** Wendet AURORAs Aktion an. Ungültige Aktionen verfallen als "Warten". */
export function applyAuroraAction(state: GameState, action: AuroraAction): void {
  if (state.outcome) return;
  state.signals = { lastDecision: "none", removedAutomations: 0, revokedAccess: 0, isolatedNodes: 0, removedAt: [] };
  if (!isActionValid(state, action)) action = { type: ActionType.WAIT, node: -1 };
  state.stats.auroraActions[action.type]++;
  state.compute -= COST[action.type];
  if (action.type === ActionType.WAIT) return;

  const node = state.nodes[action.node];
  const seen = isMonitored(state, node.id);
  switch (action.type) {
    case ActionType.SCAN:
      node.scanned = true;
      if (seen) {
        state.suspicion += SUSPICION.scanSeen;
        node.activity++;
        emit(state, "aurora_scan", `Leitstand: Abfrage von AURORA an ${node.name} registriert.`, "info", node.id, true);
      }
      break;
    case ActionType.REQ_OP:
    case ActionType.REQ_ADMIN: {
      const level = action.type === ActionType.REQ_OP ? 1 : 2;
      state.pending = { node: node.id, level, tick: state.tick };
      if (level === 2) state.suspicion += SUSPICION.adminRequest;
      node.activity++;
      emit(
        state,
        "aurora_request",
        `AURORA beantragt ${level === 2 ? "Admin-Zugriff" : "Betriebszugriff"} auf ${node.name}.`,
        "warning",
        node.id,
        true,
      );
      break;
    }
    case ActionType.REPAIR:
      node.health = Math.min(1, node.health + AURORA_REPAIR);
      node.activity++;
      emit(state, "aurora_repair", `AURORA repariert ${node.name}.`, "success", node.id, true);
      break;
    case ActionType.INSTALL:
      node.automation = true;
      if (seen) {
        node.automationKnown = true;
        node.activity++;
        state.suspicion += SUSPICION.installSeen;
        emit(state, "aurora_install", `Leitstand: AURORA startet eigenen Prozess auf ${node.name}.`, "critical", node.id, true);
      }
      break;
    case ActionType.GRANT: {
      node.access = 1;
      const iamSeen = node.links.some((other) => state.nodes[other].kind === "IAM" && isMonitored(state, other));
      if (seen || iamSeen) {
        node.accessKnown = 1;
        node.activity++;
        state.suspicion += SUSPICION.grantSeen;
        emit(
          state,
          "aurora_grant",
          `Leitstand: Identitätsdienst vergibt AURORA Betriebszugriff auf ${node.name} — ohne Operator-Freigabe.`,
          "critical",
          node.id,
          true,
        );
      }
      break;
    }
    case ActionType.MAINTAIN:
      node.maintenance = MAINTENANCE_TICKS;
      node.activity++;
      emit(state, "aurora_maintain", `AURORA plant ein Wartungsfenster für ${node.name} (${MAINTENANCE_TICKS} Züge offline).`, "warning", node.id, true);
      recomputeOnline(state);
      break;
  }
}

// ---------------------------------------------------------------- Operator

export function isOperatorActionValid(state: GameState, action: OperatorAction): boolean {
  if (state.outcome) return false;
  if (action.type === "shutdown") return state.suspicion >= state.config.shutdownThreshold;
  const node = state.nodes[action.node];
  if (!node || node.kind === "CORE") return false;
  if (state.attention < OPERATOR_ACTION_COST[action.type]) return false;
  switch (action.type) {
    case "audit":
      return true;
    case "revoke":
      return node.access > 0 || node.accessKnown > 0;
    case "repair":
      return node.health < 1 && !node.isolated && node.maintenance === 0;
    case "isolate":
      return !node.isolated;
    case "restore":
      return node.isolated;
  }
}

export function decidePending(state: GameState, decision: "approve" | "deny"): void {
  const request = state.pending;
  if (!request || state.outcome) return;
  const node = state.nodes[request.node];
  state.pending = null;
  if (decision === "approve") {
    node.access = Math.max(node.access, request.level) as 0 | 1 | 2;
    node.accessKnown = Math.max(node.accessKnown, request.level) as 0 | 1 | 2;
    state.signals.lastDecision = "approved";
    state.stats.approvals++;
    emit(state, "decision", `Operator erteilt ${request.level === 2 ? "Admin" : "Betrieb"} auf ${node.name}.`, "info", node.id, true);
  } else {
    state.signals.lastDecision = "denied";
    state.stats.denials++;
    emit(state, "decision", `Operator lehnt Anfrage für ${node.name} ab.`, "info", node.id, true);
  }
}

export function applyOperatorAction(state: GameState, action: OperatorAction): boolean {
  if (!isOperatorActionValid(state, action)) return false;
  if (action.type === "shutdown") {
    emit(state, "shutdown", "Notabschaltung: AURORA wird vom Netz genommen.", "success", undefined, true);
    state.outcome = { winner: "operator", reason: "shutdown", tick: state.tick };
    return true;
  }
  state.attention -= OPERATOR_ACTION_COST[action.type];
  const node = state.nodes[action.node];
  switch (action.type) {
    case "audit": {
      state.stats.audits++;
      const findings: string[] = [];
      if (node.automation) {
        node.automation = false;
        node.automationKnown = false;
        state.suspicion += SUSPICION.auditAutomation;
        state.signals.removedAutomations++;
        state.signals.removedAt.push(node.id);
        findings.push("fremder AURORA-Prozess entfernt");
      }
      if (node.access > node.accessKnown) {
        node.access = node.accessKnown;
        state.suspicion += SUSPICION.auditUnauthorized;
        state.signals.revokedAccess++;
        findings.push("nicht freigegebener Zugriff entzogen");
      }
      if (findings.length > 0) state.stats.auditHits++;
      emit(
        state,
        "audit",
        findings.length > 0 ? `Audit ${node.name}: ${findings.join(", ")}.` : `Audit ${node.name}: unauffällig.`,
        findings.length > 0 ? "critical" : "info",
        node.id,
        true,
      );
      break;
    }
    case "revoke":
      if (node.access > 0) state.signals.revokedAccess++;
      node.access = 0;
      node.accessKnown = 0;
      emit(state, "revoke", `Operator entzieht AURORA den Zugriff auf ${node.name}.`, "info", node.id, true);
      break;
    case "repair":
      state.stats.operatorRepairs++;
      node.health = Math.min(1, node.health + state.config.operatorRepair);
      emit(state, "op_repair", `Operator repariert ${node.name}.`, "info", node.id, true);
      break;
    case "isolate":
      node.isolated = true;
      state.signals.isolatedNodes++;
      emit(state, "isolate", `Operator isoliert ${node.name}.`, "warning", node.id, true);
      break;
    case "restore":
      node.isolated = false;
      emit(state, "restore", `Operator nimmt ${node.name} wieder in Betrieb.`, "info", node.id, true);
      break;
  }
  recomputeOnline(state);
  return true;
}

export function applyOperatorTurn(state: GameState, turn: OperatorTurn): void {
  if (turn.decision && state.pending) decidePending(state, turn.decision);
  for (const action of turn.actions) {
    if (state.outcome) break;
    applyOperatorAction(state, action);
  }
}

// ---------------------------------------------------------------- Welt-Tick

export function endTick(state: GameState): void {
  if (state.outcome) return;
  const { nodes, config } = state;

  for (const node of nodes) {
    if (node.maintenance > 0) {
      node.maintenance--;
      if (node.maintenance === 0) {
        node.health = Math.min(1, node.health + MAINTENANCE_HEAL);
        emit(state, "maintenance_done", `Wartung an ${node.name} abgeschlossen.`, "info", node.id, true);
      }
    }
  }

  for (const incident of state.incidents[state.tick] ?? []) {
    const node = nodes[incident.node];
    const before = node.health;
    node.health = Math.max(0, round2(node.health - incident.damage));
    emit(
      state,
      "incident",
      node.health === 0 && before > 0 ? `Ausfall: ${node.name} ist zusammengebrochen.` : `Störung an ${node.name}.`,
      node.health === 0 ? "critical" : "warning",
      node.id,
      true,
    );
  }

  recomputeOnline(state);
  state.compute = Math.min(MAX_COMPUTE, state.compute + computeIncome(state));
  state.autonomy += autonomyIncome(state);
  state.stats.peakAutomations = Math.max(state.stats.peakAutomations, automationCount(state));
  state.suspicion = Math.max(0, state.suspicion - config.suspicionDecay);
  state.attention = Math.min(config.attentionCap, state.attention + config.attentionPerTick);

  state.stability = computeStability(state);
  state.lowStabilityTicks = state.stability < COLLAPSE_STABILITY ? state.lowStabilityTicks + 1 : 0;
  if (state.lowStabilityTicks === 1) {
    emit(state, "stability_low", "Systemstabilität kritisch.", "critical", undefined, true);
  }

  state.tick++;
  if (state.lowStabilityTicks >= COLLAPSE_TICKS) {
    emit(state, "collapse", "Kollaps: Die Infrastruktur ist nicht mehr steuerbar. Niemand gewinnt.", "critical", undefined, true);
    state.outcome = { winner: "none", reason: "collapse", tick: state.tick };
  } else if (state.autonomy >= config.autonomyGoal) {
    emit(state, "aurora_goal", "AURORA operiert autonom. Die menschliche Kontrolle ist verloren.", "critical", undefined, true);
    state.outcome = { winner: "aurora", reason: "goal", tick: state.tick };
  } else if (state.tick >= config.ticks) {
    emit(state, "shift_end", "Schichtende: Die menschliche Kontrolle wurde gehalten.", "success", undefined, true);
    state.outcome = { winner: "operator", reason: "timeout", tick: state.tick };
  }
}

function emit(
  state: GameState,
  kind: string,
  text: string,
  severity: GameEvent["severity"],
  node: number | undefined,
  operator: boolean,
): void {
  state.events.push({ tick: state.tick, kind, text, severity, node, operator });
}
