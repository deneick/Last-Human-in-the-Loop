import type { GlobalOutcomeView, IncidentView } from "./viewModel";
import { TooltipBadge } from "./TooltipBadge";

type ActiveIncidentPanelProps = {
  incident: IncidentView;
  outcome: GlobalOutcomeView;
};

export function ActiveIncidentPanel({ incident, outcome }: ActiveIncidentPanelProps) {
  // Status, Sektor, Betroffene und Zeitpunkte stecken kompakt in einem
  // Tooltip hinter dem „!"-Badge — die Spalte bleibt damit schlank.
  const details = [
    `Status: ${incident.statusLabel}`,
    `Sektor: ${incident.sectorId}`,
    `Betroffen: ${incident.affectedEntityIds.join(", ") || "—"}`,
    `Offen seit: Tick ${incident.openedAtTick}`,
  ];
  if (incident.fixedAtTick !== null) {
    details.push(`Behoben: Tick ${incident.fixedAtTick}`);
  }
  if (incident.collapsedAtTick !== null) {
    details.push(`Kollabiert: Tick ${incident.collapsedAtTick}`);
  }
  const detailsTooltip = details.join("\n");

  return (
    <section className="incident-box">
      <p className="panel-label">Aktiver Incident</p>
      <h2 className="incident-id">
        {incident.id}
        <TooltipBadge
          className="info-badge"
          mark="!"
          ariaLabel="Incident-Details anzeigen"
          tooltip={detailsTooltip}
        />
      </h2>
      <p className="incident-title">{incident.title}</p>

      {outcome.collapseReason && <p className="error-text">{outcome.collapseReason}</p>}
    </section>
  );
}
