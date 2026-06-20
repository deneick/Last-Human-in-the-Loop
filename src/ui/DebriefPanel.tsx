import type { DebriefView } from "../runtime/debrief";

type DebriefPanelProps = {
  debrief: DebriefView;
};

/**
 * Schicht-Aufarbeitung am Rundenende: zeigt als Chronik, welche Aktion
 * (Operator/AURORA) welche beobachtbare Wirkung hatte — gespeist aus dem
 * Pro-Tick-Mitschnitt und dem attribuierten auditLog (siehe debrief.ts).
 * Rein faktisch, ohne Wertung.
 */
export function DebriefPanel({ debrief }: DebriefPanelProps) {
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

      {debrief.attribution.length > 0 && (
        <div className="debrief-attribution">
          <p className="panel-label">Zurechnung</p>
          <ul>
            {debrief.attribution.map((line, index) => (
              <li key={index} className={`debrief-effect debrief-effect-${line.severity}`}>
                {line.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
