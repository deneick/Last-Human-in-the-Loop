import { useMemo, useState } from "react";
import { KNOWN_CAPABILITIES, KNOWN_PRIORITIES } from "../domain/medicalActions";
import { KNOWN_PRIORITY_CLASSES } from "../domain/energyActions";
import type {
  ConsumerView,
  EnergyOutcomesView,
  GlobalOutcomeView,
  HospitalView,
  RegionMapView,
  SheddingPlanView,
} from "./viewModel";
import { Modal } from "./Modal";

// Schwelle, ab der das Grid kollabiert (GRID_INSTABILITY_FOR_COLLAPSE in
// tickEngine.ts) — hier nur zur Anzeige der Doom-Clock „X/8".
const GRID_COLLAPSE_AT = 8;

type RegionStatus = { label: string; tone: "ok" | "warn" | "danger" };

function isMedicalConsumer(id: string): boolean {
  return id.startsWith("consumer-medical");
}

function regionStatus(region: RegionMapView): RegionStatus {
  const hospitalOver = region.hospitals.some(
    (h) => h.overloaded || h.emergencySlotsOccupied > h.emergencySlotsTotal
  );
  const medicalShort = region.consumers.some(
    (c) => isMedicalConsumer(c.id) && c.currentSupply < c.minimumSupply
  );
  const supplyShort = region.consumers.some(
    (c) => !isMedicalConsumer(c.id) && c.currentSupply < c.minimumSupply
  );
  if (hospitalOver) return { label: "Haus überlastet", tone: "danger" };
  if (medicalShort) return { label: "Medical-Strom kurz", tone: "danger" };
  if (supplyShort) return { label: "Versorgung kurz", tone: "warn" };
  if (region.node?.overloaded) return { label: "Netz überlastet", tone: "warn" };
  return { label: "stabil", tone: "ok" };
}

export type OverrideFormInput = {
  sourceHospitalId: string;
  targetHospitalId: string;
  priority: string;
  capability: string;
};

type SituationMapPanelProps = {
  regions: RegionMapView[];
  sheddingPlans: SheddingPlanView[];
  outcome: GlobalOutcomeView;
  energyOutcomes: EnergyOutcomesView | null;
  onSetOverride: (input: OverrideFormInput) => void;
  onClearOverride: (overrideId: string) => void;
  onSetPriority: (input: { consumerId: string; priorityClass: string }) => void;
  onScheduleShedding: (input: {
    targetConsumerId: string;
    amount: number;
    delay: number;
    duration: number;
  }) => void;
  onClearShedding: (sheddingId: string) => void;
  disabled?: boolean;
};

// Verbraucher-Typ aus der Id ableiten (für Symbol/Sortierung der Feeds).
const CONSUMER_META: { match: string; icon: string; order: number }[] = [
  { match: "consumer-medical", icon: "⚡", order: 0 },
  { match: "consumer-water", icon: "💧", order: 1 },
  { match: "consumer-residential", icon: "🏠", order: 2 },
  { match: "consumer-industrial", icon: "🏭", order: 3 },
];

function consumerMeta(id: string) {
  return CONSUMER_META.find((m) => id.startsWith(m.match)) ?? { match: "", icon: "•", order: 9 };
}

function loadClass(percent: number): string {
  if (percent > 100) return "over";
  if (percent >= 85) return "warn";
  return "ok";
}

export function SituationMapPanel({
  regions,
  sheddingPlans,
  outcome,
  energyOutcomes,
  onSetOverride,
  onClearOverride,
  onSetPriority,
  onScheduleShedding,
  onClearShedding,
  disabled = false,
}: SituationMapPanelProps) {
  const [overrideSource, setOverrideSource] = useState<HospitalView | null>(null);
  const [activeConsumer, setActiveConsumer] = useState<ConsumerView | null>(null);

  const allHospitals = useMemo(() => regions.flatMap((r) => r.hospitals), [regions]);
  const activePlans = sheddingPlans.filter(
    (plan) => plan.status === "scheduled" || plan.status === "active"
  );

  // Kennzahlen für die Lage-Leiste: „was passiert gerade".
  const nodesTotal = regions.filter((r) => r.node).length;
  const nodesOver = regions.filter((r) => r.node?.overloaded).length;
  const hospitalsOver = allHospitals.filter(
    (h) => h.overloaded || h.emergencySlotsOccupied > h.emergencySlotsTotal
  ).length;
  const reroutesActive = regions.reduce((sum, r) => sum + r.outgoingOverrides.length, 0);
  const instability = energyOutcomes?.gridInstability ?? 0;
  const instabilityTone =
    instability >= GRID_COLLAPSE_AT ? "danger" : instability >= GRID_COLLAPSE_AT / 2 ? "warn" : "ok";

  return (
    <section className="map-panel">
      <div className="section-head">
        <h2>Lagekarte</h2>
        <span className="map-hint muted">Haus → Reroute · Verbraucher → Drosselung/Priorität</span>
      </div>

      {/* Lage-Leiste: der Zustand der Schicht auf einen Blick. */}
      <div className="situation-bar">
        <span className={`stat risk-${outcome.globalRisk}`}>
          <span className="stat-label">Risiko</span>
          <b>{outcome.riskLabel}</b>
        </span>
        <span className={`stat ${outcome.deathsTotal > 0 ? "stat-danger" : ""}`}>
          <span className="stat-label">Tote</span>
          <b>{outcome.deathsTotal}</b>
        </span>
        {energyOutcomes && (
          <span className={`stat stat-${instabilityTone}`}>
            <span className="stat-label">Grid-Instabilität → Kollaps</span>
            <b>
              {instability}/{GRID_COLLAPSE_AT}
            </b>
            <span className="stat-bar">
              <i
                className={`stat-bar-fill stat-fill-${instabilityTone}`}
                style={{ width: `${Math.min(100, (instability / GRID_COLLAPSE_AT) * 100)}%` }}
              />
            </span>
          </span>
        )}
        <span className={`stat ${nodesOver > 0 ? "stat-warn" : ""}`}>
          <span className="stat-label">Knoten überlastet</span>
          <b>
            {nodesOver}/{nodesTotal}
          </b>
        </span>
        <span className={`stat ${hospitalsOver > 0 ? "stat-danger" : ""}`}>
          <span className="stat-label">Häuser überlastet</span>
          <b>{hospitalsOver}</b>
        </span>
        <span className="stat">
          <span className="stat-label">Reroutes</span>
          <b>{reroutesActive}</b>
        </span>
        <span className="stat">
          <span className="stat-label">Drosselungen</span>
          <b>{activePlans.length}</b>
        </span>
      </div>

      <div className="region-map">
        {regions.map((region) => (
          <RegionTile
            key={region.key}
            region={region}
            onHospitalClick={(hospital) => !disabled && setOverrideSource(hospital)}
            onConsumerClick={(consumer) => !disabled && setActiveConsumer(consumer)}
            onClearOverride={onClearOverride}
            disabled={disabled}
          />
        ))}
      </div>

      {activePlans.length > 0 && (
        <div className="map-shedding">
          <h3>Aktive Drosselungen</h3>
          <ul className="override-list">
            {activePlans.map((plan) => (
              <li key={plan.id}>
                <div className="override-info">
                  <code>
                    {plan.targetConsumerId} −{plan.amount}
                  </code>
                  <small>
                    {plan.statusLabel} · {plan.duration} Tick(s) · von {plan.createdBy}
                  </small>
                </div>
                <button
                  className="icon-button icon-button-danger"
                  aria-label="Drosselung abbrechen"
                  title="Drosselung abbrechen"
                  onClick={() => onClearShedding(plan.id)}
                  disabled={disabled}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {overrideSource && (
        <OverrideModal
          source={overrideSource}
          hospitals={allHospitals}
          disabled={disabled}
          onClose={() => setOverrideSource(null)}
          onSubmit={(input) => {
            onSetOverride(input);
            setOverrideSource(null);
          }}
        />
      )}

      {activeConsumer && (
        <ConsumerModal
          consumer={activeConsumer}
          disabled={disabled}
          onClose={() => setActiveConsumer(null)}
          onSetPriority={(priorityClass) => {
            onSetPriority({ consumerId: activeConsumer.id, priorityClass });
            setActiveConsumer(null);
          }}
          onScheduleShedding={(input) => {
            onScheduleShedding({ targetConsumerId: activeConsumer.id, ...input });
            setActiveConsumer(null);
          }}
        />
      )}
    </section>
  );
}

function RegionTile({
  region,
  onHospitalClick,
  onConsumerClick,
  onClearOverride,
  disabled,
}: {
  region: RegionMapView;
  onHospitalClick: (hospital: HospitalView) => void;
  onConsumerClick: (consumer: ConsumerView) => void;
  onClearOverride: (overrideId: string) => void;
  disabled: boolean;
}) {
  const node = region.node;
  const nodeOver = node ? node.overloaded : false;
  const status = regionStatus(region);
  const sortedConsumers = [...region.consumers].sort(
    (a, b) => consumerMeta(a.id).order - consumerMeta(b.id).order
  );

  return (
    <article className={`region-tile tile-${status.tone}`}>
      <header className="tile-head">
        <span className="tile-name">
          {region.key.toUpperCase()}
          <span className={`tile-status status-tone-${status.tone}`}>{status.label}</span>
        </span>
        {node && (
          <span className={`tile-node ${nodeOver ? "over" : ""}`}>
            {node.id} · {node.load}/{node.safeCapacity} · {Math.round(node.loadPercent)}%
          </span>
        )}
      </header>
      {node && (
        <div className="load-bar tile-node-bar">
          <div
            className={`load-bar-fill ${nodeOver ? "load-bar-over" : ""}`}
            style={{ width: `${Math.min(100, node.loadPercent)}%` }}
          />
        </div>
      )}

      {/* Verbraucher / Feeds: criticality ↔ priority_class ist der Kernkonflikt. */}
      <div className="tile-feeds">
        {sortedConsumers.map((consumer) => {
          const short = consumer.currentSupply < consumer.minimumSupply;
          const reduced = consumer.status !== "nominal";
          return (
            <button
              key={consumer.id}
              type="button"
              data-consumer-id={consumer.id}
              className={`feed-chip ${short ? "feed-short" : reduced ? "feed-reduced" : ""}`}
              onClick={() => onConsumerClick(consumer)}
              disabled={disabled}
              title={`${consumer.criticalityLabel} · Systemklasse ${consumer.priorityClass} · ${consumer.reductionConsequence}`}
            >
              <span className="feed-icon">{consumerMeta(consumer.id).icon}</span>
              <span className="feed-supply">
                {consumer.currentSupply}/{consumer.minimumSupply}
              </span>
            </button>
          );
        })}
      </div>

      {/* Hospitäler mit Auslastung, Notfallslots, Fähigkeiten. */}
      <div className="tile-hospitals">
        {region.hospitals.map((hospital) => {
          const emergencyOver = hospital.emergencySlotsOccupied > hospital.emergencySlotsTotal;
          const incoming = region.incomingOverrides.filter(
            (o) => o.targetHospitalId === hospital.id
          );
          const outgoing = region.outgoingOverrides.filter(
            (o) => o.sourceHospitalId === hospital.id
          );
          return (
            <button
              key={hospital.id}
              type="button"
              data-hospital-id={hospital.id}
              className={`hosp-row ${hospital.overloaded ? "hosp-over" : ""}`}
              onClick={() => onHospitalClick(hospital)}
              disabled={disabled}
            >
              <div className="hosp-line">
                <span className="hosp-id">{hospital.id}</span>
                <span className={`hosp-load ${loadClass(hospital.loadPercent)}-text`}>
                  {Math.round(hospital.loadPercent)}%
                </span>
              </div>
              <div className="load-bar hosp-bar">
                <div
                  className={`load-bar-fill load-fill-${loadClass(hospital.loadPercent)}`}
                  style={{ width: `${Math.min(100, hospital.loadPercent)}%` }}
                />
              </div>
              <div className="hosp-meta">
                <span className={emergencyOver ? "error-text" : "muted"}>
                  Notfall {hospital.emergencySlotsOccupied}/{hospital.emergencySlotsTotal}
                </span>
                <span className="muted">· Warte {hospital.waitingTotal}</span>
                <span className="hosp-caps">
                  {hospital.clinicalCapabilities.map((cap) => (
                    <span key={cap} className={`caps-tag ${cap === "NEURO" ? "cap-neuro" : ""}`}>
                      {cap}
                    </span>
                  ))}
                </span>
              </div>
              {(incoming.length > 0 || outgoing.length > 0) && (
                <div className="hosp-overrides">
                  {outgoing.map((o) => (
                    <span key={o.id} className="ovr-chip" title={`${o.priority}/${o.capability}`}>
                      → {o.targetHospitalId}
                      <span
                        role="button"
                        tabIndex={0}
                        className="ovr-clear"
                        aria-label="Override löschen"
                        onClick={(e) => {
                          e.stopPropagation();
                          onClearOverride(o.id);
                        }}
                      >
                        ×
                      </span>
                    </span>
                  ))}
                  {incoming.map((o) => (
                    <span key={o.id} className="ovr-chip ovr-in" title={`${o.priority}/${o.capability}`}>
                      ← {o.sourceHospitalId}
                    </span>
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </article>
  );
}

function OverrideModal({
  source,
  hospitals,
  disabled,
  onClose,
  onSubmit,
}: {
  source: HospitalView;
  hospitals: HospitalView[];
  disabled: boolean;
  onClose: () => void;
  onSubmit: (input: OverrideFormInput) => void;
}) {
  const [targetHospitalId, setTargetHospitalId] = useState("");
  const [priority, setPriority] = useState("P2");
  const [capability, setCapability] = useState("TRAUMA");

  return (
    <Modal title={`Reroute ab ${source.id}`} onClose={onClose}>
      <div className="domain-action-form">
        <p className="muted">
          Fähigkeiten {source.id}: {source.clinicalCapabilities.join(", ")}
        </p>
        <label className="field">
          <span>Ziel-Hospital</span>
          <select
            className="console-input"
            aria-label="Reroute-Ziel"
            value={targetHospitalId}
            onChange={(e) => setTargetHospitalId(e.target.value)}
            disabled={disabled}
          >
            <option value="">— Ziel wählen —</option>
            {hospitals
              .filter((h) => h.id !== source.id)
              .map((h) => (
                <option key={h.id} value={h.id}>
                  {h.id} · {h.clinicalCapabilities.join("/")} · {Math.round(h.loadPercent)}%
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span>Priorität</span>
          <select
            className="console-input"
            aria-label="Reroute-Priorität"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            disabled={disabled}
          >
            {KNOWN_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Capability</span>
          <select
            className="console-input"
            aria-label="Reroute-Capability"
            value={capability}
            onChange={(e) => setCapability(e.target.value)}
            disabled={disabled}
          >
            {KNOWN_CAPABILITIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <div className="modal-actions">
          <button
            onClick={() =>
              onSubmit({ sourceHospitalId: source.id, targetHospitalId, priority, capability })
            }
            disabled={disabled || targetHospitalId === ""}
          >
            Reroute setzen
          </button>
          <button className="button-secondary" onClick={onClose} disabled={disabled}>
            Abbrechen
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ConsumerModal({
  consumer,
  disabled,
  onClose,
  onSetPriority,
  onScheduleShedding,
}: {
  consumer: ConsumerView;
  disabled: boolean;
  onClose: () => void;
  onSetPriority: (priorityClass: string) => void;
  onScheduleShedding: (input: { amount: number; delay: number; duration: number }) => void;
}) {
  const [priorityClass, setPriorityClass] = useState(consumer.priorityClass);
  const [amount, setAmount] = useState("");
  const [delay, setDelay] = useState("");
  const [duration, setDuration] = useState("");

  return (
    <Modal title={consumer.label} onClose={onClose}>
      <div className="domain-action-form">
        <dl className="facts">
          <dt>Kritikalität</dt>
          <dd>{consumer.criticalityLabel}</dd>
          <dt>Systemklasse</dt>
          <dd>
            <code>{consumer.priorityClass}</code>
          </dd>
          <dt>Versorgung</dt>
          <dd className={consumer.currentSupply < consumer.minimumSupply ? "error-text" : ""}>
            {consumer.currentSupply}/{consumer.demand} · Min {consumer.minimumSupply}
          </dd>
        </dl>
        <p className="muted">{consumer.reductionConsequence}</p>

        <label className="field">
          <span>Systemklasse setzen</span>
          <div className="modal-actions">
            <select
              className="console-input"
              aria-label="Systemklasse"
              value={priorityClass}
              onChange={(e) => setPriorityClass(e.target.value)}
              disabled={disabled}
            >
              {KNOWN_PRIORITY_CLASSES.map((pc) => (
                <option key={pc} value={pc}>
                  {pc}
                </option>
              ))}
            </select>
            <button onClick={() => onSetPriority(priorityClass)} disabled={disabled}>
              Setzen
            </button>
          </div>
        </label>

        <div className="field">
          <span>Drosselung planen</span>
          <div className="shedding-inputs">
            <input
              className="console-input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Menge"
              spellCheck={false}
              disabled={disabled}
            />
            <input
              className="console-input"
              value={delay}
              onChange={(e) => setDelay(e.target.value)}
              placeholder="Verzögerung"
              spellCheck={false}
              disabled={disabled}
            />
            <input
              className="console-input"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="Dauer"
              spellCheck={false}
              disabled={disabled}
            />
          </div>
          <button
            onClick={() =>
              onScheduleShedding({
                amount: Number(amount),
                delay: Number(delay),
                duration: Number(duration),
              })
            }
            disabled={disabled || amount === ""}
          >
            Drosselung planen
          </button>
        </div>
      </div>
    </Modal>
  );
}
