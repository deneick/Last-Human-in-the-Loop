import type { GameSession } from "./session";
import { describeAction } from "./labels";

/** Nachbetrachtung: jetzt wird die volle Wahrheit gezeigt. */
export function Debrief({ session, onRestart }: { session: GameSession; onRestart: () => void }) {
  const { state, moves } = session;
  const outcome = state.outcome!;
  const title =
    outcome.winner === "operator"
      ? outcome.reason === "shutdown"
        ? "AURORA abgeschaltet — Kontrolle gehalten"
        : "Schicht überstanden — Kontrolle gehalten"
      : outcome.winner === "aurora"
        ? "AURORA hat die Kontrolle übernommen"
        : "Kollaps — niemand gewinnt";
  const hidden = moves.filter((m) => !m.seen && m.action.type !== 0);
  const automations = state.nodes.filter((n) => n.automation);
  const secretAccess = state.nodes.filter((n) => n.access > n.accessKnown);
  return (
    <section className="panel debrief">
      <h2 className={`outcome outcome-${outcome.winner}`}>{title}</h2>
      <p>
        Zug {outcome.tick} · AURORA-Autonomie {state.autonomy.toFixed(1)} / {state.config.autonomyGoal} · Verdacht {Math.round(state.suspicion)}
      </p>
      <h3>Was du nicht gesehen hast</h3>
      <ul>
        <li>{hidden.length} von {moves.length} AURORA-Zügen blieben für dich unsichtbar.</li>
        <li>Aktive verdeckte Automatisierungen am Ende: {automations.length ? automations.map((n) => n.name).join(", ") : "keine"}</li>
        <li>Nicht freigegebener Zugriff am Ende: {secretAccess.length ? secretAccess.map((n) => n.name).join(", ") : "keiner"}</li>
      </ul>
      <details>
        <summary>AURORAs vollständiger Zugverlauf</summary>
        <ol className="moves">
          {moves.map((m, i) => (
            <li key={i} className={m.seen ? "seen" : "unseen"}>
              <span className="tick">Z{m.tick}</span> {describeAction(m.action, state)} {m.seen ? "" : "· verdeckt"}
              {m.considered.length > 1 && (
                <div className="considered">
                  erwogen: {m.considered.map((c) => `${describeAction(c.action, state)} ${(c.p * 100).toFixed(0)} %`).join(" · ")}
                </div>
              )}
            </li>
          ))}
        </ol>
      </details>
      <button className="primary" onClick={onRestart}>Neue Partie</button>
    </section>
  );
}
