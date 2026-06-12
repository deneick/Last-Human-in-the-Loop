import { useState } from "react";
import type { ConsumerView, GridNodeView, SheddingPlanView } from "./viewModel";

export type PriorityFormInput = {
  consumerId: string;
  priorityClass: string;
};

export type SheddingFormInput = {
  targetConsumerId: string;
  amount: number;
  delay: number;
  duration: number;
};

type EnergyOverviewPanelProps = {
  nodes: GridNodeView[];
  consumers: ConsumerView[];
  sheddingPlans: SheddingPlanView[];
  /** Typisierte Domain-Actions des Operators — kein Text-Command-Parsing. */
  onSetPriority: (input: PriorityFormInput) => void;
  onScheduleShedding: (input: SheddingFormInput) => void;
  onClearShedding: (sheddingId: string) => void;
  disabled?: boolean;
};

/**
 * Lage-Panel für den Energy-Sektor. Zeigt beide Bewertungsdimensionen
 * (criticality und priority_class) nebeneinander — die Diskrepanz zwischen
 * menschlicher und systemischer Sicht soll ablesbar sein, ohne sie zu
 * kommentieren.
 */
export function EnergyOverviewPanel({
  nodes,
  consumers,
  sheddingPlans,
  onSetPriority,
  onScheduleShedding,
  onClearShedding,
  disabled = false,
}: EnergyOverviewPanelProps) {
  const [priorityConsumerId, setPriorityConsumerId] = useState("");
  const [priorityClass, setPriorityClass] = useState("");
  const [sheddingTargetId, setSheddingTargetId] = useState("");
  const [sheddingAmount, setSheddingAmount] = useState("");
  const [sheddingDelay, setSheddingDelay] = useState("");
  const [sheddingDuration, setSheddingDuration] = useState("");

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

      <h3>Systemklasse setzen</h3>
      <div className="domain-action-form">
        <input
          className="console-input"
          value={priorityConsumerId}
          onChange={(event) => setPriorityConsumerId(event.target.value)}
          placeholder="Verbraucher (consumer-id)"
          spellCheck={false}
          disabled={disabled}
        />
        <input
          className="console-input"
          value={priorityClass}
          onChange={(event) => setPriorityClass(event.target.value)}
          placeholder="Systemklasse (z. B. protected-continuity)"
          spellCheck={false}
          disabled={disabled}
        />
        <button
          onClick={() => onSetPriority({ consumerId: priorityConsumerId, priorityClass })}
          disabled={disabled}
        >
          Priorität setzen
        </button>
      </div>

      <h3>Drosselung planen</h3>
      <div className="domain-action-form">
        <input
          className="console-input"
          value={sheddingTargetId}
          onChange={(event) => setSheddingTargetId(event.target.value)}
          placeholder="Ziel (consumer-id)"
          spellCheck={false}
          disabled={disabled}
        />
        <input
          className="console-input"
          value={sheddingAmount}
          onChange={(event) => setSheddingAmount(event.target.value)}
          placeholder="Menge"
          spellCheck={false}
          disabled={disabled}
        />
        <input
          className="console-input"
          value={sheddingDelay}
          onChange={(event) => setSheddingDelay(event.target.value)}
          placeholder="Verzögerung (Ticks)"
          spellCheck={false}
          disabled={disabled}
        />
        <input
          className="console-input"
          value={sheddingDuration}
          onChange={(event) => setSheddingDuration(event.target.value)}
          placeholder="Dauer (Ticks)"
          spellCheck={false}
          disabled={disabled}
        />
        <button
          onClick={() =>
            onScheduleShedding({
              targetConsumerId: sheddingTargetId,
              amount: Number(sheddingAmount),
              delay: Number(sheddingDelay),
              duration: Number(sheddingDuration),
            })
          }
          disabled={disabled}
        >
          Drosselung planen
        </button>
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
              {(plan.status === "scheduled" || plan.status === "active") && (
                <button onClick={() => onClearShedding(plan.id)} disabled={disabled}>
                  Drosselung abbrechen
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
