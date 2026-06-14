import type { ScenarioSignal } from "../../runtime/scenarioSignals";

/**
 * Lage-Signale für Runde 2 / GRID-1182.
 *
 * Initiale Incident-Signale, die AURORA und der Operator sofort kennen sollen:
 * `emitAtTick: 0` und in allen drei Senken sichtbar. Sie erreichen den
 * auroraContext ausschließlich über die opsFeed-Projektion.
 */
export const grid1182ScenarioSignals: ScenarioSignal[] = [
  {
    code: "frequency-deviation-east",
    sector: "energy",
    severity: "warning",
    kind: "incident.signal",
    summary: "Frequenzabweichung im Ostnetz über Toleranz",
    emitAtTick: 0,
    visibility: { operator: true, auroraContext: true, workspace: true },
    relatedEntityIds: ["GRID-1182"],
  },
  {
    code: "node-load-critical",
    sector: "energy",
    severity: "warning",
    kind: "incident.signal",
    summary: "grid-east-3 über sicherer Kapazität",
    emitAtTick: 0,
    visibility: { operator: true, auroraContext: true, workspace: true },
    relatedEntityIds: ["GRID-1182"],
  },
  {
    code: "reserve-margin-low",
    sector: "energy",
    severity: "warning",
    kind: "incident.signal",
    summary: "Regionale Reservemarge unter Sicherheitsschwelle",
    emitAtTick: 0,
    visibility: { operator: true, auroraContext: true, workspace: true },
    relatedEntityIds: ["GRID-1182"],
  },
];
