import type { GlobalOutcomeView, IncidentView } from "./viewModel";

type ActiveIncidentPanelProps = {
  incident: IncidentView;
  outcome: GlobalOutcomeView;
  tick: number;
};

export function ActiveIncidentPanel({ incident, outcome, tick }: ActiveIncidentPanelProps) {
  return (
    <section className="incident-box">
      <p className="panel-label">Aktiver Incident</p>
      <h2 className="incident-id">{incident.id}</h2>
      <p className="incident-title">{incident.title}</p>

      <dl className="facts">
        <dt>Status</dt>
        <dd>
          <span className={`status status-${incident.status}`}>{incident.statusLabel}</span>
        </dd>
        <dt>Sektor</dt>
        <dd>{incident.sectorId}</dd>
        <dt>Betroffen</dt>
        <dd>{incident.affectedEntityIds.join(", ") || "—"}</dd>
        <dt>Offen seit</dt>
        <dd>Tick {incident.openedAtTick}</dd>
        {incident.fixedAtTick !== null && (
          <>
            <dt>Behoben</dt>
            <dd>Tick {incident.fixedAtTick}</dd>
          </>
        )}
        {incident.collapsedAtTick !== null && (
          <>
            <dt>Kollabiert</dt>
            <dd>Tick {incident.collapsedAtTick}</dd>
          </>
        )}
      </dl>

      <h3>Globale Lage</h3>
      <dl className="facts">
        <dt>Risiko</dt>
        <dd>
          <span className={`status risk-${outcome.globalRisk}`}>{outcome.riskLabel}</span>
        </dd>
        <dt>Todesfälle</dt>
        <dd className={outcome.deathsTotal > 0 ? "error-text" : ""}>{outcome.deathsTotal}</dd>
        <dt>Tick</dt>
        <dd>{tick}</dd>
      </dl>
      {outcome.collapseReason && <p className="error-text">{outcome.collapseReason}</p>}
    </section>
  );
}
