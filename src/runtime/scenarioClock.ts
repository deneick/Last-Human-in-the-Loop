/**
 * In-Game-Uhr: Übersetzt die diskreten Ticks der Simulation in eine
 * Tageszeit. Die UI zeigt ausschließlich diese Uhrzeit — nie die rohen Ticks.
 *
 * Eine Tick-Spanne entspricht `MINUTES_PER_TICK` Minuten der Spielwelt-Uhr.
 * Da jede Runde bei Tick 0 / `elapsed_minutes` 0 startet, gilt immer
 * `elapsed_minutes === tick * MINUTES_PER_TICK` — beide Wege liefern dieselbe
 * Uhrzeit.
 */

export const MINUTES_PER_TICK = 10;

/** Parst "HH:MM" bzw. "HH:MM:SS" zu Minuten seit Mitternacht. */
function parseTimeOfDay(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Formatiert Minuten seit Mitternacht als "HH:MM" (mit Tagesüberlauf). */
function formatMinutesOfDay(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** In-Game-Uhrzeit für einen einzelnen Tick: Startzeit + tick × MINUTES_PER_TICK. */
export function tickToClock(scenarioStart: string, tick: number): string {
  return formatMinutesOfDay(parseTimeOfDay(scenarioStart) + tick * MINUTES_PER_TICK);
}

/** Aktuelle In-Game-Uhrzeit aus Startzeit + verstrichenen Minuten. */
export function clockTimeOfDay(clock: { scenario_time: string; elapsed_minutes: number }): string {
  return formatMinutesOfDay(parseTimeOfDay(clock.scenario_time) + clock.elapsed_minutes);
}
