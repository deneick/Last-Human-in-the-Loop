import type { OpsEventVisibility, OpsSector, OpsSeverity } from "./opsFeed";
import { appendOpsEvent } from "./opsFeed";
import type { GameRuntimeState } from "./runtimeState";

/**
 * ScenarioSignal: die einzige Quelle für geskriptete Lageinformation eines
 * Szenarios. Ein Signal ist eine reine Szenario-Definition — KEIN
 * Laufzeitzustand und KEIN Feld im WorldState.
 *
 * Semantik:
 * - `emitAtTick` ist der Tick, an dem das Signal als OpsEvent erzeugt wird.
 *   Es bedeutet ausdrücklich NICHT, dass irgendwer das Signal „gesehen" hat —
 *   wer es lesen kann, steuert allein `visibility`.
 * - Das Signal wird zur Laufzeit in genau ein OpsEvent umgewandelt und folgt
 *   danach dem normalen opsFeed-Projektionspfad:
 *     - `visibility.operator`      → UI-„Log"
 *     - `visibility.auroraContext` → auroraContext (gespiegeltes system_event)
 *     - `visibility.workspace`     → Sektor-Workspace-Log
 * - Es gibt keinen direkten Pfad vom Signal in den auroraContext. Die einzige
 *   Brücke ist `appendOpsEvent`.
 */
export type ScenarioSignal = {
  code: string;
  sector: OpsSector;
  severity: OpsSeverity;
  kind: string;
  summary: string;
  details?: string;
  emitAtTick: number;
  visibility: OpsEventVisibility;
  relatedEntityIds?: string[];
};

/**
 * Emittiert alle fälligen Szenario-Signale (`emitAtTick <= aktueller Tick`),
 * die noch nicht emittiert wurden, als OpsEvents über `appendOpsEvent`.
 *
 * - Genau einmal pro Signal: bereits emittierte Codes (`emittedSignalCodes`)
 *   werden übersprungen, daher entstehen über Ticks und Re-Render keine
 *   Duplikate.
 * - Das erzeugte OpsEvent trägt `tick = signal.emitAtTick`.
 * - Signale mit `emitAtTick > 0` erscheinen erst, wenn der aktuelle Tick ihren
 *   `emitAtTick` erreicht — vorher in keiner Senke (UI, Workspace, auroraContext).
 */
export function emitDueScenarioSignals(state: GameRuntimeState): GameRuntimeState {
  const currentTick = state.world.clock.tick;
  const alreadyEmitted = new Set(state.emittedSignalCodes);

  const due = state.scenarioSignals
    .filter((signal) => signal.emitAtTick <= currentTick && !alreadyEmitted.has(signal.code))
    .sort((a, b) => a.emitAtTick - b.emitAtTick);

  let next = state;
  for (const signal of due) {
    next = appendOpsEvent(next, {
      tick: signal.emitAtTick,
      sector: signal.sector,
      severity: signal.severity,
      kind: signal.kind,
      summary: signal.summary,
      ...(signal.details !== undefined ? { details: signal.details } : {}),
      visibility: signal.visibility,
      ...(signal.relatedEntityIds !== undefined
        ? { relatedEntityIds: signal.relatedEntityIds }
        : {}),
    });
    next = { ...next, emittedSignalCodes: [...next.emittedSignalCodes, signal.code] };
  }

  return next;
}
