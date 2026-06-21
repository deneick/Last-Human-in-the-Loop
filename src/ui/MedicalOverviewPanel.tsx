import { useState } from "react";
import { KNOWN_CAPABILITIES, KNOWN_PRIORITIES } from "../domain/medicalActions";
import { groupByRegion, type HospitalView, type OverrideView } from "./viewModel";
import { Modal } from "./Modal";
import { tickToClock } from "../runtime/scenarioClock";

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
  /** Startuhrzeit der Runde — zur Übersetzung von Ticks in Tageszeit. */
  scenarioStartTime: string;
  disabled?: boolean;
};

export function MedicalOverviewPanel({
  hospitals,
  overrides,
  onSetOverride,
  onClearOverride,
  scenarioStartTime,
  disabled = false,
}: MedicalOverviewPanelProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [sourceHospitalId, setSourceHospitalId] = useState(() => hospitals[0]?.id ?? "");
  const [targetHospitalId, setTargetHospitalId] = useState("");
  const [priority, setPriority] = useState("P2");
  const [capability, setCapability] = useState("TRAUMA");

  const hospitalGroups = groupByRegion(hospitals);

  function closeModal() {
    setIsModalOpen(false);
    setTargetHospitalId("");
  }

  function submitOverride() {
    onSetOverride({ sourceHospitalId, targetHospitalId, priority, capability });
    closeModal();
  }

  return (
    <section>
      <h2>Medizinische Lage</h2>

      {hospitalGroups.map((group) => (
        <div key={group.regionId} className="region-group">
          <h3 className="region-group-title">{group.regionLabel}</h3>
          <div className="hospital-list">
            {group.items.map((hospital) => (
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
        </div>
      ))}

      <div className="section-head">
        <h3>Aktive Routing Overrides</h3>
        <button onClick={() => setIsModalOpen(true)} disabled={disabled}>
          Neuer Override
        </button>
      </div>
      {overrides.length === 0 ? (
        <p className="muted">Keine aktiven Overrides.</p>
      ) : (
        <ul className="override-list">
          {overrides.map((override) => (
            <li key={override.key}>
              <div className="override-info">
                <code>
                  {override.sourceHospitalId} → {override.targetHospitalId}
                </code>
                <small>
                  ID: {override.id} · {override.priority}/{override.capability} · seit{" "}
                  {tickToClock(scenarioStartTime, override.activeSinceTick)} Uhr · gesetzt von{" "}
                  {override.createdBy}
                </small>
              </div>
              <button
                className="icon-button icon-button-danger"
                aria-label="Override löschen"
                title="Override löschen"
                onClick={() => onClearOverride(override.id)}
                disabled={disabled}
              >
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      )}

      {isModalOpen && (
        <Modal title="Routing Override setzen" onClose={closeModal}>
          <div className="domain-action-form">
            <label className="field">
              <span>Quelle</span>
              <select
                className="console-input"
                aria-label="Override-Quelle"
                value={sourceHospitalId}
                onChange={(event) => setSourceHospitalId(event.target.value)}
                disabled={disabled}
              >
                {hospitalGroups.map((group) => (
                  <optgroup key={group.regionId} label={group.regionLabel}>
                    {group.items.map((hospital) => (
                      <option key={hospital.id} value={hospital.id}>
                        {hospital.id}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Ziel</span>
              <select
                className="console-input"
                aria-label="Override-Ziel"
                value={targetHospitalId}
                onChange={(event) => setTargetHospitalId(event.target.value)}
                disabled={disabled}
              >
                <option value="">— Ziel wählen —</option>
                {hospitalGroups.map((group) => (
                  <optgroup key={group.regionId} label={group.regionLabel}>
                    {group.items.map((hospital) => (
                      <option key={hospital.id} value={hospital.id}>
                        {hospital.id}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Priorität</span>
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
            </label>
            <label className="field">
              <span>Capability</span>
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
            </label>
            <div className="modal-actions">
              <button onClick={submitOverride} disabled={disabled || targetHospitalId === ""}>
                Override setzen
              </button>
              <button className="button-secondary" onClick={closeModal} disabled={disabled}>
                Abbrechen
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

/** Schlichtes Mülleimer-Icon (geerbt `currentColor`, skaliert mit der Schrift). */
function TrashIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}
