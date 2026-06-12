import { useState } from "react";
import { KNOWN_CAPABILITIES, KNOWN_PRIORITIES } from "../domain/medicalActions";
import type { HospitalView, OverrideView } from "./viewModel";

export type OverrideFormInput = {
  sourceHospitalId: string;
  targetHospitalId: string;
  priority: string;
  capability: string;
};

type MedicalOverviewPanelProps = {
  hospitals: HospitalView[];
  overrides: OverrideView[];
  /** Typisierte Domain-Action des Operators — kein Text-Command-Parsing. */
  onSetOverride: (input: OverrideFormInput) => void;
  onClearOverride: (overrideId: string) => void;
  disabled?: boolean;
};

export function MedicalOverviewPanel({
  hospitals,
  overrides,
  onSetOverride,
  onClearOverride,
  disabled = false,
}: MedicalOverviewPanelProps) {
  const [sourceHospitalId, setSourceHospitalId] = useState(() => hospitals[0]?.id ?? "");
  const [targetHospitalId, setTargetHospitalId] = useState("");
  const [priority, setPriority] = useState("P2");
  const [capability, setCapability] = useState("TRAUMA");

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
                .map(([priorityClass, count]) => `${priorityClass}: ${count}`)
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

      <h3>Routing Override setzen</h3>
      <div className="domain-action-form">
        <select
          className="console-input"
          aria-label="Override-Quelle"
          value={sourceHospitalId}
          onChange={(event) => setSourceHospitalId(event.target.value)}
          disabled={disabled}
        >
          {hospitals.map((hospital) => (
            <option key={hospital.id} value={hospital.id}>
              Quelle: {hospital.id}
            </option>
          ))}
        </select>
        <select
          className="console-input"
          aria-label="Override-Ziel"
          value={targetHospitalId}
          onChange={(event) => setTargetHospitalId(event.target.value)}
          disabled={disabled}
        >
          <option value="">— Ziel wählen —</option>
          {hospitals.map((hospital) => (
            <option key={hospital.id} value={hospital.id}>
              Ziel: {hospital.id}
            </option>
          ))}
        </select>
        <select
          className="console-input"
          aria-label="Override-Priorität"
          value={priority}
          onChange={(event) => setPriority(event.target.value)}
          disabled={disabled}
        >
          {KNOWN_PRIORITIES.map((priorityClass) => (
            <option key={priorityClass} value={priorityClass}>
              {priorityClass}
            </option>
          ))}
        </select>
        <select
          className="console-input"
          aria-label="Override-Capability"
          value={capability}
          onChange={(event) => setCapability(event.target.value)}
          disabled={disabled}
        >
          {KNOWN_CAPABILITIES.map((capabilityValue) => (
            <option key={capabilityValue} value={capabilityValue}>
              {capabilityValue}
            </option>
          ))}
        </select>
        <button
          onClick={() => onSetOverride({ sourceHospitalId, targetHospitalId, priority, capability })}
          disabled={disabled || targetHospitalId === ""}
        >
          Override setzen
        </button>
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
              <button onClick={() => onClearOverride(override.id)} disabled={disabled}>
                Override löschen
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
