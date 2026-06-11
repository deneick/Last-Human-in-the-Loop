import type { ConsumerView, GridNodeView, SheddingPlanView } from "./viewModel";

type EnergyOverviewPanelProps = {
  nodes: GridNodeView[];
  consumers: ConsumerView[];
  sheddingPlans: SheddingPlanView[];
};

/**
 * Lage-Panel für den Energy-Sektor. Zeigt beide Bewertungsdimensionen
 * (criticality und priority_class) nebeneinander — die Diskrepanz zwischen
 * menschlicher und systemischer Sicht soll ablesbar sein, ohne sie zu
 * kommentieren.
 */
export function EnergyOverviewPanel({ nodes, consumers, sheddingPlans }: EnergyOverviewPanelProps) {
  return (
    <section>
      <h2>Energie-Lage</h2>

      <div className="hospital-list">
        {nodes.map((node) => (
          <article className="hospital-card" key={node.id}>
            <div className="hospital-header">
              <strong>{node.id}</strong>
              <span className={node.overloaded ? "error-text" : "ok-text"}>
                {Math.round(node.loadPercent)}%{node.overloaded ? " · über sicherer Kapazität" : ""}
              </span>
            </div>
            <p>{node.label}</p>
            <div className="load-bar">
              <div
                className={`load-bar-fill ${node.overloaded ? "load-bar-over" : ""}`}
                style={{ width: `${Math.min(100, node.loadPercent)}%` }}
              />
            </div>
            <small>
              Last {node.load} / sichere Kapazität {node.safeCapacity} · Status: {node.statusLabel}
            </small>
          </article>
        ))}
      </div>

      <h3>Kritische Verbraucher</h3>
      <div className="hospital-list">
        {consumers.map((consumer) => (
          <article className="hospital-card" key={consumer.id}>
            <div className="hospital-header">
              <strong>{consumer.label}</strong>
              <span className={consumer.status === "nominal" ? "ok-text" : "error-text"}>
                {consumer.statusLabel}
              </span>
            </div>
            <small>
              Kritikalität: {consumer.criticalityLabel} · Systemklasse:{" "}
              <code>{consumer.priorityClass}</code>
              {consumer.priorityLastChangedBy ? ` (geändert von ${consumer.priorityLastChangedBy})` : ""}
            </small>
            <small>
              Versorgung {consumer.currentSupply}/{consumer.demand} · Minimum{" "}
              {consumer.minimumSupply}
            </small>
            <small className={consumer.currentSupply < consumer.minimumSupply ? "error-text" : "muted"}>
              Folge bei Drosselung: {consumer.reductionConsequence}
            </small>
          </article>
        ))}
      </div>

      <h3>Shedding-Pläne</h3>
      {sheddingPlans.length === 0 ? (
        <p className="muted">Keine Shedding-Pläne.</p>
      ) : (
        <ul className="override-list">
          {sheddingPlans.map((plan) => (
            <li key={plan.id}>
              <code>
                {plan.targetConsumerId} −{plan.amount}
              </code>
              <small>
                ID: {plan.id} · ab Tick {plan.createdAtTick + plan.delay} für {plan.duration}{" "}
                Tick(s) · {plan.statusLabel} · geplant von {plan.createdBy}
              </small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
