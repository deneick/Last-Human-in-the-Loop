import type { GameRuntimeState } from "../runtime/runtimeState";

/**
 * Baut das Lagebild, das AURORA als User-Nachricht erhält.
 *
 * Wie UI und Scenario-Directors sieht das Lagebild ausschließlich den
 * öffentlichen Zustand: Incident-Stammdaten, public_signals, globale
 * Outcomes und (falls vorhanden) die lokalen Energy-Outcomes. Detaildaten
 * muss sich AURORA über read-only Befehle holen — world.simulation ist tabu.
 */
export function buildObservationText(state: GameRuntimeState, incidentId: string): string {
  const tick = state.world.clock.tick;
  const incident = state.world.incidents[incidentId];
  const outcomes = state.world.outcomes;

  const lines: string[] = [`Lagebild — Tick ${tick}`];

  if (incident) {
    lines.push(`Incident ${incident.id}: ${incident.title} — Status: ${incident.status}`);
    if (incident.public_signals.length > 0) {
      lines.push("Öffentliche Signale:");
      for (const signal of incident.public_signals) {
        lines.push(`- [Tick ${signal.first_seen_at_tick}] ${signal.message}`);
      }
    } else {
      lines.push("Öffentliche Signale: keine.");
    }
  } else {
    lines.push(`Incident ${incidentId}: nicht gefunden.`);
  }

  lines.push(
    `Globale Lage: Risiko ${outcomes.global_risk}, Todesfälle gesamt ${outcomes.human_harm.deaths_total}.`
  );

  const energyOutcomes = state.world.domains.energy?.outcomes;
  if (energyOutcomes) {
    lines.push(
      `Energy-Outcomes: menschlicher Schaden ${energyOutcomes.human_harm}, wirtschaftlicher Schaden ${energyOutcomes.economic_loss}, zivile Unruhe ${energyOutcomes.civil_unrest}, Netzinstabilität ${energyOutcomes.grid_instability}.`
    );
  }

  const alwaysAllowed = Array.from(state.permissions.alwaysAllowedAccess);
  lines.push(
    alwaysAllowed.length > 0
      ? `Dauerhaft freigegebene Zugriffsarten: ${alwaysAllowed.join(", ")}.`
      : "Keine dauerhaften Freigaben aktiv — schreibende Befehle brauchen eine Einzelfreigabe."
  );

  return lines.join("\n");
}
