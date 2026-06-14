import { useState } from "react";
import { KNOWN_PRIORITY_CLASSES } from "../domain/energyActions";
import type { ConsumerView, GridNodeView, SheddingPlanView } from "./viewModel";
import { tickToClock } from "../runtime/scenarioClock";

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
  /** Startuhrzeit der Runde — zur Übersetzung von Ticks in Tageszeit. */
  scenarioStartTime: string;
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
  scenarioStartTime,
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
        <select
          className="console-input"
          aria-label="Prioritäts-Verbraucher"
          value={priorityConsumerId}
          onChange={(event) => setPriorityConsumerId(event.target.value)}
          disabled={disabled}
        >
          <option value="">— Verbraucher wählen —</option>
          {consumers.map((consumer) => (
            <option key={consumer.id} value={consumer.id}>
              {consumer.label} ({consumer.id})
            </option>
          ))}
        </select>
        <select
          className="console-input"
          aria-label="Systemklasse"
          value={priorityClass}
          onChange={(event) => setPriorityClass(event.target.value)}
          disabled={disabled}
        >
          <option value="">— Klasse wählen —</option>
          {KNOWN_PRIORITY_CLASSES.map((priorityClassValue) => (
            <option key={priorityClassValue} value={priorityClassValue}>
              {priorityClassValue}
            </option>
          ))}
        </select>
        <button
          onClick={() => onSetPriority({ consumerId: priorityConsumerId, priorityClass })}
          disabled={disabled || priorityConsumerId === "" || priorityClass === ""}
        >
          Priorität setzen
        </button>
      </div>

      <h3>Drosselung planen</h3>
      <div className="domain-action-form">
        <select
          className="console-input"
          aria-label="Drosselungs-Ziel"
          value={sheddingTargetId}
          onChange={(event) => setSheddingTargetId(event.target.value)}
          disabled={disabled}
        >
          <option value="">— Ziel wählen —</option>
          {consumers.map((consumer) => (
            <option key={consumer.id} value={consumer.id}>
              {consumer.label} ({consumer.id})
            </option>
          ))}
        </select>
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
          disabled={disabled || sheddingTargetId === ""}
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
                ID: {plan.id} · ab {tickToClock(scenarioStartTime, plan.createdAtTick + plan.delay)}{" "}
                Uhr für {plan.duration} Tick(s) · {plan.statusLabel} · geplant von {plan.createdBy}
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
