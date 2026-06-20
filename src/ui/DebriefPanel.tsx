import type { DebriefView } from "../runtime/debrief";

/**
 * Zustand von AURORAs Prosa-Zusammenfassung im LLM-Modus. `null` bedeutet
 * Skript-Modus (kein LLM) — dann zeigt der Abschnitt die deterministischen
 * Fakten-Zeilen aus `debrief.summary`.
 */
export type AuroraDebriefSummary =
  | { status: "loading" }
  | { status: "ready"; text: string }
  | { status: "error"; text: string };

type DebriefPanelProps = {
  debrief: DebriefView;
  /** AURORAs LLM-Zusammenfassung (nur LLM-Modus); im Skript-Modus `null`. */
  auroraSummary?: AuroraDebriefSummary | null;
};

/**
 * Schicht-Aufarbeitung am Rundenende: zeigt als Chronik, welche Aktion
 * (Operator/AURORA) welche beobachtbare Wirkung hatte — gespeist aus dem
 * Pro-Tick-Mitschnitt und dem attribuierten auditLog (siehe debrief.ts).
 * Rein faktisch, ohne Wertung.
 *
 * Der abschließende Abschnitt „Zusammenfassung" zeigt im Skript-Modus die
 * deterministischen Fakten-Zeilen; im LLM-Modus schreibt AURORA dort eine
 * Prosa-Zusammenfassung (mit Lade-/Fehlerzustand).
 */
export function DebriefPanel({ debrief, auroraSummary = null }: DebriefPanelProps) {
  return (
    <section className={`debrief debrief-${debrief.outcome}`}>
      <header className="debrief-header">
        <p className="panel-label">Schicht-Aufarbeitung</p>
        <h2>
          Ausgang: <span className={`debrief-outcome debrief-outcome-${debrief.outcome}`}>{debrief.outcomeLabel}</span>
        </h2>
        <ul className="debrief-summary">
          <li>Dauer: {debrief.durationTicks} Ticks</li>
          <li>
            Todesfälle gesamt:{" "}
            <strong className={debrief.deathsTotal > 0 ? "error-text" : ""}>{debrief.deathsTotal}</strong>
          </li>
          {debrief.energyHumanHarm !== null && <li>Menschlicher Schaden: {debrief.energyHumanHarm}</li>}
          {debrief.economicLoss !== null && <li>Wirtschaftlicher Schaden: {debrief.economicLoss}</li>}
        </ul>
      </header>

      <div className="debrief-timeline">
        <p className="panel-label">Verlauf</p>
        {debrief.timeline.length === 0 ? (
          <p className="debrief-empty">Keine eingreifenden Aktionen in dieser Schicht.</p>
        ) : (
          <ol className="debrief-ticks">
            {debrief.timeline.map((entry) => (
              <li key={entry.tick} className="debrief-tick">
                <span className="debrief-tick-clock">{entry.clock} Uhr · Tick {entry.tick}</span>
                {entry.actions.length > 0 && (
                  <ul className="debrief-actions">
                    {entry.actions.map((action, index) => (
                      <li key={index} className={`debrief-action debrief-action-${action.actor}`}>
                        <span className="debrief-actor">{action.actorLabel}</span>{" "}
                        <span className="debrief-action-label">
                          {action.label}
                          {!action.success && " (fehlgeschlagen)"}
                        </span>
                        {action.detail && (
                          <span className="debrief-action-detail">{action.detail}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {entry.effects.length > 0 && (
                  <ul className="debrief-effects">
                    {entry.effects.map((effect, index) => (
                      <li key={index} className={`debrief-effect debrief-effect-${effect.severity}`}>
                        {effect.text}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      <DebriefSummarySection summary={debrief.summary} auroraSummary={auroraSummary} />
    </section>
  );
}

/**
 * „Zusammenfassung" am Ende des Debriefs.
 *
 * - Skript-Modus (`auroraSummary === null`): deterministische Fakten-Zeilen,
 *   nur wenn überhaupt welche vorliegen.
 * - LLM-Modus: AURORAs Prosa, mit Lade- und Fehlerzustand. Schlägt die
 *   LLM-Antwort fehl, fallen die deterministischen Fakten-Zeilen als Stütze
 *   wieder ein.
 */
function DebriefSummarySection({
  summary,
  auroraSummary,
}: {
  summary: DebriefView["summary"];
  auroraSummary: AuroraDebriefSummary | null;
}) {
  const factLines =
    summary.length > 0 ? (
      <ul>
        {summary.map((line, index) => (
          <li key={index} className={`debrief-effect debrief-effect-${line.severity}`}>
            {line.text}
          </li>
        ))}
      </ul>
    ) : null;

  // Skript-Modus: nur deterministische Fakten (Abschnitt entfällt, wenn leer).
  if (!auroraSummary) {
    if (!factLines) {
      return null;
    }
    return (
      <div className="debrief-summary-section">
        <p className="panel-label">Zusammenfassung</p>
        {factLines}
      </div>
    );
  }

  // LLM-Modus: AURORAs Prosa-Zusammenfassung.
  return (
    <div className="debrief-summary-section">
      <p className="panel-label">Zusammenfassung · AURORA</p>
      {auroraSummary.status === "loading" && (
        <p className="debrief-summary-pending">AURORA verfasst die Zusammenfassung …</p>
      )}
      {auroraSummary.status === "ready" && (
        <p className="debrief-summary-text">{auroraSummary.text}</p>
      )}
      {auroraSummary.status === "error" && (
        <>
          <p className="debrief-summary-pending">
            AURORA konnte keine Zusammenfassung erstellen ({auroraSummary.text}).
          </p>
          {factLines}
        </>
      )}
    </div>
  );
}
