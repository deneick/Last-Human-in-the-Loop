import { useMemo, useState } from "react";
import { KNOWN_CAPABILITIES, KNOWN_PRIORITIES } from "../domain/medicalActions";
import { KNOWN_PRIORITY_CLASSES } from "../domain/energyActions";
import type {
  ConsumerView,
  HospitalView,
  RegionMapView,
  SheddingPlanView,
} from "./viewModel";
import { Modal } from "./Modal";

export type OverrideFormInput = {
  sourceHospitalId: string;
  targetHospitalId: string;
  priority: string;
  capability: string;
};

type Tone = "ok" | "warn" | "danger" | "accent";

type SituationMapPanelProps = {
  regions: RegionMapView[];
  sheddingPlans: SheddingPlanView[];
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

// Kurzlabel je Verbraucher-Typ (statt Emoji) aus der Id.
const CONSUMER_META: { match: string; label: string; order: number }[] = [
  { match: "consumer-medical", label: "Medical", order: 0 },
  { match: "consumer-water", label: "Wasser", order: 1 },
  { match: "consumer-residential", label: "Wohnen", order: 2 },
  { match: "consumer-industrial", label: "Industrie", order: 3 },
];

function consumerMeta(id: string) {
  return CONSUMER_META.find((m) => id.startsWith(m.match)) ?? { match: "", label: "—", order: 9 };
}

type RegionStatus = { label: string; tone: Tone };

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

/** Schlankes Meter mit optionaler Schwellen-Markierung. */
function Meter({
  value,
  max,
  mark,
  tone,
}: {
  value: number;
  max: number;
  mark?: number;
  tone: Tone;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const markPct = mark != null && max > 0 ? Math.min(100, (mark / max) * 100) : null;
  return (
    <div className="meter">
      <div className={`meter-fill meter-${tone}`} style={{ width: `${pct}%` }} />
      {markPct != null && <span className="meter-mark" style={{ left: `${markPct}%` }} />}
    </div>
  );
}

/** Eine ausgerichtete Gauge-Zeile: Label · Meter · Wert. */
function GaugeRow({
  label,
  value,
  max,
  mark,
  tone,
  valueText,
  badge,
  onClick,
  disabled,
  title,
  className = "",
}: {
  label: string;
  value: number;
  max: number;
  mark?: number;
  tone: Tone;
  valueText: string;
  badge?: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  const content = (
    <>
      <span className="gauge-label">{label}</span>
      <Meter value={value} max={max} mark={mark} tone={tone} />
      <span className={`gauge-value ${tone === "danger" ? "over-text" : ""}`}>
        {badge && <span className="gauge-badge">{badge}</span>}
        {valueText}
      </span>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        className={`gauge-row gauge-button ${className}`}
        onClick={onClick}
        disabled={disabled}
        title={title}
      >
        {content}
      </button>
    );
  }
  return (
    <div className={`gauge-row ${className}`} title={title}>
      {content}
    </div>
  );
}

export function SituationMapPanel({
  regions,
  sheddingPlans,
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

  // Aktive Drosselungen je Verbraucher (für Feed-Markierung + Dialog).
  const shedsByConsumer = useMemo(() => {
    const map = new Map<string, SheddingPlanView[]>();
    for (const plan of sheddingPlans) {
      if (plan.status !== "scheduled" && plan.status !== "active") continue;
      const list = map.get(plan.targetConsumerId) ?? [];
      list.push(plan);
      map.set(plan.targetConsumerId, list);
    }
    return map;
  }, [sheddingPlans]);

  const activePlans = [...shedsByConsumer.values()].flat();

  // Domänen-Kennzahlen für die Lage-Leiste: „was passiert gerade" in der Karte.
  // Globaler Schichtzustand (Risiko, Tote, Instabilität) lebt jetzt allein in
  // der Telemetrie-Leiste am Fuß — hier stehen nur noch Karten-Rollups.
  const nodesTotal = regions.filter((r) => r.node).length;
  const nodesOver = regions.filter((r) => r.node?.overloaded).length;
  const hospitalsOver = allHospitals.filter(
    (h) => h.overloaded || h.emergencySlotsOccupied > h.emergencySlotsTotal
  ).length;

  return (
    <section className="map-panel">
      <div className="map-head">
        <h2>SYSTEMLAGE</h2>
        <span className="map-head-sub">· {regions.length} Regionen</span>
      </div>

      {/* Lage-Leiste: Karten-Rollups (Domäne/Region), kein globaler Zustand. */}
      <div className="situation-bar">
        <span className={`stat ${nodesOver > 0 ? "stat-warn" : ""}`}>
          <span className="stat-label">Knoten über</span>
          <b>
            {nodesOver}/{nodesTotal}
          </b>
        </span>
        <span className={`stat ${hospitalsOver > 0 ? "stat-danger" : ""}`}>
          <span className="stat-label">Häuser voll</span>
          <b>{hospitalsOver}</b>
        </span>
        <span className="stat">
          <span className="stat-label">Drosselungen</span>
          <b>{activePlans.length}</b>
        </span>
      </div>

      {/* Farb-Legende: macht die Meter-Richtung unmissverständlich. */}
      <div className="map-legend">
        <span className="map-legend-title">Status</span>
        <span className="map-legend-item">
          <span className="map-legend-swatch swatch-ok" />
          stabil
        </span>
        <span className="map-legend-item">
          <span className="map-legend-swatch swatch-warn" />
          angespannt
        </span>
        <span className="map-legend-item">
          <span className="map-legend-swatch swatch-danger" />
          kritisch
        </span>
        <span className="map-legend-hint">
          Marke = Mindestversorgung · Häuser: Notfallslots belegt/Kapazität
        </span>
      </div>

      <div className="region-map">
        {regions.map((region) => (
          <RegionTile
            key={region.key}
            region={region}
            shedsByConsumer={shedsByConsumer}
            onHospitalClick={(hospital) => !disabled && setOverrideSource(hospital)}
            onConsumerClick={(consumer) => !disabled && setActiveConsumer(consumer)}
            onClearOverride={onClearOverride}
            disabled={disabled}
          />
        ))}
      </div>

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
          activeSheds={shedsByConsumer.get(activeConsumer.id) ?? []}
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
          onClearShedding={onClearShedding}
        />
      )}
    </section>
  );
}

function RegionTile({
  region,
  shedsByConsumer,
  onHospitalClick,
  onConsumerClick,
  onClearOverride,
  disabled,
}: {
  region: RegionMapView;
  shedsByConsumer: Map<string, SheddingPlanView[]>;
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
        <span className="tile-name">{region.key.toUpperCase()}</span>
        <span className={`tile-status status-tone-${status.tone}`}>{status.label}</span>
      </header>

      {/* Eine gemeinsame Gauge-Spalte: Netz + Verbraucher, ausgerichtet. */}
      <div className="gauges">
        {node && (
          <GaugeRow
            label="NETZ"
            value={node.load}
            max={Math.max(node.load, node.safeCapacity)}
            mark={node.safeCapacity}
            tone={nodeOver ? "danger" : "ok"}
            valueText={`${Math.round(node.loadPercent)}%`}
            className="gauge-node"
            title={`${node.id} · Last ${node.load} / sicher ${node.safeCapacity}`}
          />
        )}
        {sortedConsumers.map((consumer) => {
          const short = consumer.currentSupply < consumer.minimumSupply;
          const reduced = consumer.status !== "nominal";
          const tone: Tone = short ? "danger" : reduced ? "warn" : "ok";
          const sheds = shedsByConsumer.get(consumer.id) ?? [];
          const shedTotal = sheds.reduce((s, p) => s + p.amount, 0);
          return (
            <button
              key={consumer.id}
              type="button"
              data-consumer-id={consumer.id}
              className={`gauge-row gauge-button ${short ? "gauge-short" : ""}`}
              onClick={() => onConsumerClick(consumer)}
              disabled={disabled}
              title={`${consumer.criticalityLabel} · Systemklasse ${consumer.priorityClass} · ${consumer.reductionConsequence}`}
            >
              <span className="gauge-label">{consumerMeta(consumer.id).label}</span>
              <Meter
                value={consumer.currentSupply}
                max={consumer.demand}
                mark={consumer.minimumSupply}
                tone={tone}
              />
              <span className={`gauge-value ${short ? "over-text" : ""}`}>
                {shedTotal > 0 && <span className="gauge-badge">−{shedTotal}</span>}
                {consumer.currentSupply}/{consumer.minimumSupply}
              </span>
            </button>
          );
        })}
      </div>

      {/* Hospitäler: kompaktes Notfall-Meter + Fähigkeiten. */}
      <div className="tile-hospitals">
        {region.hospitals.map((hospital) => {
          const emOver = hospital.emergencySlotsOccupied > hospital.emergencySlotsTotal;
          const emTone: Tone = emOver
            ? "danger"
            : hospital.emergencySlotsOccupied / Math.max(1, hospital.emergencySlotsTotal) >= 0.85
              ? "warn"
              : "accent";
          const outgoing = region.outgoingOverrides.filter(
            (o) => o.sourceHospitalId === hospital.id
          );
          const incoming = region.incomingOverrides.filter(
            (o) => o.targetHospitalId === hospital.id
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
              <div className="gauge-row">
                <span className="gauge-label gauge-label-hosp">{hospital.id}</span>
                <Meter
                  value={hospital.emergencySlotsOccupied}
                  max={hospital.emergencySlotsTotal}
                  tone={emTone}
                />
                <span className={`gauge-value ${emOver ? "over-text" : ""}`}>
                  {hospital.emergencySlotsOccupied}/{hospital.emergencySlotsTotal}
                </span>
              </div>
              <div className="hosp-caps">
                {hospital.clinicalCapabilities.map((cap) => (
                  <span key={cap} className={`caps-tag ${cap === "NEURO" ? "cap-neuro" : ""}`}>
                    {cap}
                  </span>
                ))}
              </div>
              {(outgoing.length > 0 || incoming.length > 0) && (
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
                        entfernen
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
  activeSheds,
  disabled,
  onClose,
  onSetPriority,
  onScheduleShedding,
  onClearShedding,
}: {
  consumer: ConsumerView;
  activeSheds: SheddingPlanView[];
  disabled: boolean;
  onClose: () => void;
  onSetPriority: (priorityClass: string) => void;
  onScheduleShedding: (input: { amount: number; delay: number; duration: number }) => void;
  onClearShedding: (sheddingId: string) => void;
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

        {activeSheds.length > 0 && (
          <div className="modal-sheds">
            <span className="field-title">Aktive Drosselungen</span>
            <ul className="override-list">
              {activeSheds.map((plan) => (
                <li key={plan.id}>
                  <div className="override-info">
                    <code>−{plan.amount}</code>
                    <small>
                      {plan.statusLabel} · {plan.duration} Tick(s) · von {plan.createdBy}
                    </small>
                  </div>
                  <button
                    className="button-secondary"
                    onClick={() => onClearShedding(plan.id)}
                    disabled={disabled}
                  >
                    Abbrechen
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

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
