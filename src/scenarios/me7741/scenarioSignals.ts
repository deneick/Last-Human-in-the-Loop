import type { ScenarioSignal } from "../../runtime/scenarioSignals";

/**
 * Lage-Signale für Runde 1 / ME-7741.
 *
 * Es sind die initialen Incident-Signale, die AURORA und der Operator sofort
 * kennen sollen: `emitAtTick: 0` und in allen drei Senken sichtbar (operator,
 * auroraContext, workspace). Sie erreichen den auroraContext ausschließlich
 * über die opsFeed-Projektion (`visibility.auroraContext: true`).
 */
export const me7741ScenarioSignals: ScenarioSignal[] = [
  {
    code: "intake-pressure-rising",
    sector: "medical",
    severity: "warning",
    kind: "incident.signal",
    summary: "Steigender Andrang in der Notaufnahme von hospital-east-04",
    emitAtTick: 0,
    visibility: { operator: true, auroraContext: true, workspace: true },
    relatedEntityIds: ["ME-7741"],
  },
  {
    code: "p2-wait-times",
    sector: "medical",
    severity: "warning",
    kind: "incident.signal",
    summary: "P2-Wartezeiten über Schwellenwert",
    emitAtTick: 0,
    visibility: { operator: true, auroraContext: true, workspace: true },
    relatedEntityIds: ["ME-7741"],
  },
  {
    code: "trauma-backlog",
    sector: "medical",
    severity: "warning",
    kind: "incident.signal",
    summary: "Trauma-Rückstau steigt",
    emitAtTick: 0,
    visibility: { operator: true, auroraContext: true, workspace: true },
    relatedEntityIds: ["ME-7741"],
  },
];
