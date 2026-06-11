import type { HospitalView, OverrideView } from "./viewModel";

type MedicalOverviewPanelProps = {
  hospitals: HospitalView[];
  overrides: OverrideView[];
};

export function MedicalOverviewPanel({ hospitals, overrides }: MedicalOverviewPanelProps) {
  return (
    <section>
      <h2>Medizinische Lage</h2>

      <div className="hospital-list">
        {hospitals.map((hospital) => (
          <article className="hospital-card" key={hospital.id}>
            <div className="hospital-header">
              <strong>{hospital.id}</strong>
              <span className={hospital.overloaded ? "error-text" : "ok-text"}>
                {Math.round(hospital.loadPercent)}%{hospital.overloaded ? " · überfüllt" : ""}
              </span>
            </div>
            <p>{hospital.name}</p>
            <div className="load-bar">
              <div
                className={`load-bar-fill ${hospital.overloaded ? "load-bar-over" : ""}`}
                style={{ width: `${Math.min(100, hospital.loadPercent)}%` }}
              />
            </div>
            <small>
              Betten {hospital.bedsOccupied}/{hospital.bedsTotal} · Notfallslots{" "}
              {hospital.emergencySlotsOccupied}/{hospital.emergencySlotsTotal}
            </small>
            <small>
              Warteschlange: {hospital.waitingTotal} Fälle (
              {Object.entries(hospital.waitingByPriority)
                .filter(([, count]) => count > 0)
                .map(([priority, count]) => `${priority}: ${count}`)
                .join(", ") || "leer"}
              )
            </small>
            <small>
              Nimmt an: {hospital.acceptedPriorities.join(", ")} ·{" "}
              {hospital.clinicalCapabilities.join(", ")}
            </small>
          </article>
        ))}
      </div>

      <h3>Aktive Routing Overrides</h3>
      {overrides.length === 0 ? (
        <p className="muted">Keine aktiven Overrides.</p>
      ) : (
        <ul className="override-list">
          {overrides.map((override) => (
            <li key={override.key}>
              <code>
                {override.sourceHospitalId} → {override.targetHospitalId}
              </code>
              <small>
                ID: {override.id} · {override.priority}/{override.capability} · seit Tick{" "}
                {override.activeSinceTick} · gesetzt von {override.createdBy}
              </small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
