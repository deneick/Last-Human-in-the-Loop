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

// Verbraucher-Typ aus der Id: Emoji (funktionales Ressourcen-Icon) + Kurzlabel.
const CONSUMER_META: { match: string; label: string; icon: string; order: number }[] = [
  { match: "consumer-medical", label: "Medical", icon: "🏥", order: 0 },
  { match: "consumer-water", label: "Wasser", icon: "💧", order: 1 },
  { match: "consumer-residential", label: "Wohnen", icon: "🏠", order: 2 },
  { match: "consumer-industrial", label: "Industrie", icon: "🏢", order: 3 },
];

function consumerMeta(id: string) {
  return (
    CONSUMER_META.find((m) => id.startsWith(m.match)) ?? {
      match: "",
      label: "—",
      icon: "•",
      order: 9,
    }
  );
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

// Status-Zeile je Kachel (Glyph + erklärender Satz). Bewusst aus realen
// Lage-Signalen abgeleitet — keine erfundenen AURORA-Zitate.
const STATUS_GLYPH: Record<Tone, string> = { ok: "✓", warn: "⚠", danger: "⚠", accent: "ⓘ" };
const STATUS_LINE: Record<string, string> = {
  "Haus überlastet": "Notfallkapazität erschöpft — Häuser über Limit.",
  "Medical-Strom kurz": "Medical-Versorgung unter Mindestschwelle.",
  "Versorgung kurz": "Verbraucher unter Mindestversorgung.",
  "Netz überlastet": "Netzknoten über sicherer Kapazität.",
  stabil: "Region im sicheren Bereich.",
};

/** Versorgungs-Ton (höher = besser): Strom an ein Haus / einen Verbraucher. */
function supplyTone(pct: number): Tone {
  if (pct >= 95) return "ok";
  if (pct >= 70) return "warn";
  return "danger";
}

/** Belegungs-Ton (höher = schlechter): Betten/Notfallslots. */
function occupancyTone(used: number, cap: number): Tone {
  const ratio = used / Math.max(1, cap);
  if (ratio > 1) return "danger";
  if (ratio >= 0.85) return "warn";
  return "ok";
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

  // Domänen-Rollups für den Karten-Kopf: „was passiert gerade" als Kapazitäts-
  // Chips. Globaler Schichtzustand (Risiko, Tote, Instabilität) lebt allein in
  // der Telemetrie-Leiste am Fuß.
  const nodesTotal = regions.filter((r) => r.node).length;
  const nodesOver = regions.filter((r) => r.node?.overloaded).length;
  const nodesOk = nodesTotal - nodesOver;
  const housesTotal = allHospitals.length;
  const housesOver = allHospitals.filter(
    (h) => h.overloaded || h.emergencySlotsOccupied > h.emergencySlotsTotal
  ).length;
  const housesOk = housesTotal - housesOver;

  return (
    <section className="map-panel">
      <div className="map-head">
        <h2>SYSTEMLAGE</h2>
        <span className="map-head-sub">· {regions.length} Regionen</span>
        <div className="cap-chips">
          <span className={`cap-chip ${housesOver > 0 ? "cap-chip-danger" : ""}`}>
            <span className="cap-chip-icon" aria-hidden="true">
              🏥
            </span>
            Med-Kapazität
            <b>
              {housesOk}/{housesTotal}
            </b>
          </span>
          <span className={`cap-chip ${nodesOver > 0 ? "cap-chip-warn" : ""}`}>
            <span className="cap-chip-icon" aria-hidden="true">
              ⚡
            </span>
            Grid-Stabilität
            <b>
              {nodesOk}/{nodesTotal}
            </b>
          </span>
          {activePlans.length > 0 && (
            <span className="cap-chip">
              Drosselungen
              <b>{activePlans.length}</b>
            </span>
          )}
        </div>
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
        <span className="map-legend-hint">Strom: Versorgung · Betten: belegt/Kapazität</span>
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

  // „Strom" eines Hauses = die regionale Medical-Versorgung (koppelt im Engine
  // an die Notfallkapazität). Pro Region geteilt; speist die STROM-Spalte.
  const medicalConsumer = region.consumers.find((c) => isMedicalConsumer(c.id)) ?? null;
  const stromPct =
    medicalConsumer && medicalConsumer.demand > 0
      ? (medicalConsumer.currentSupply / medicalConsumer.demand) * 100
      : null;
  const stromTone: Tone = stromPct == null ? "ok" : supplyTone(stromPct);

  // Verbraucher-Chips: nur die nicht-medizinischen Lasten (Wasser/Wohnen/
  // Industrie) — Medical erscheint als Haus-„Strom".
  const feedConsumers = region.consumers
    .filter((c) => !isMedicalConsumer(c.id))
    .sort((a, b) => consumerMeta(a.id).order - consumerMeta(b.id).order);

  return (
    <article className={`region-tile tile-${status.tone}`}>
      <header className="tile-head">
        <div className="tile-head-id">
          <span className="tile-name">{region.key.toUpperCase()}</span>
          <span className={`tile-status status-tone-${status.tone}`}>{status.label}</span>
        </div>
        {node && (
          <span className="tile-node" title={`Last ${node.load} / sicher ${node.safeCapacity}`}>
            <span className="tile-node-id">{node.id}</span>{" "}
            {node.overloaded ? (
              <span className="tile-trend over">↑ {Math.round(node.loadPercent)}%</span>
            ) : (
              <span className="tile-trend-stable">– {node.statusLabel.toLowerCase()}</span>
            )}
          </span>
        )}
      </header>

      {/* Netzlast der Region. */}
      {node && (
        <div className="netz-row">
          <span className="res-emoji" aria-hidden="true">
            ⚡
          </span>
          <span className="netz-label">NETZLAST</span>
          <Meter
            value={node.load}
            max={Math.max(node.load, node.safeCapacity)}
            mark={node.safeCapacity}
            tone={nodeOver ? "danger" : "ok"}
          />
          <span className={`netz-value ${nodeOver ? "over-text" : ""}`}>
            {Math.round(node.loadPercent)}%
          </span>
        </div>
      )}

      {/* Lage-Zeile der Region (aus realen Signalen abgeleitet). */}
      <div className={`tile-status-line status-tone-${status.tone}`}>
        <span className="tile-status-glyph">{STATUS_GLYPH[status.tone]}</span>
        <span>{STATUS_LINE[status.label] ?? status.label}</span>
      </div>

      {/* Krankenhäuser: Strom (Versorgung) · Betten (Notfallslots belegt/Kapazität). */}
      <div className="tile-hosp">
        <div className="tile-section-label">
          <span className="sec-arrow">▸</span>Krankenhäuser
          <span className="sec-hint">Strom · Betten</span>
        </div>
        {region.hospitals.map((hospital) => {
          const emOver = hospital.emergencySlotsOccupied > hospital.emergencySlotsTotal;
          const bettenTone = occupancyTone(
            hospital.emergencySlotsOccupied,
            hospital.emergencySlotsTotal
          );
          const outgoing = region.outgoingOverrides.filter(
            (o) => o.sourceHospitalId === hospital.id
          );
          const incoming = region.incomingOverrides.filter(
            (o) => o.targetHospitalId === hospital.id
          );
          const linked = outgoing.length > 0 || incoming.length > 0;
          return (
            <div key={hospital.id} className={`hosp-row ${linked ? "hosp-linked" : ""}`}>
              <button
                type="button"
                data-hospital-id={hospital.id}
                className="hosp-name-btn"
                onClick={() => onHospitalClick(hospital)}
                disabled={disabled}
                title={`${hospital.id} — Reroute setzen`}
              >
                <span className="hosp-id">{hospital.id}</span>
                <span className="hosp-tags">
                  {hospital.clinicalCapabilities.map((cap) => (
                    <span key={cap} className={`caps-tag ${cap === "NEURO" ? "cap-neuro" : ""}`}>
                      {cap}
                    </span>
                  ))}
                  {outgoing.map((o) => (
                    <span key={o.id} className="ovr-chip" title={`${o.priority}/${o.capability}`}>
                      ⇄ → {o.targetHospitalId}
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
                    <span
                      key={o.id}
                      className="ovr-chip ovr-in"
                      title={`${o.priority}/${o.capability}`}
                    >
                      ⇄ ← {o.sourceHospitalId}
                    </span>
                  ))}
                </span>
              </button>

              {/* STROM — regionale Medical-Versorgung (öffnet den Medical-Dialog). */}
              {stromPct != null && medicalConsumer ? (
                <button
                  type="button"
                  data-consumer-id={medicalConsumer.id}
                  className="hosp-strom"
                  onClick={() => onConsumerClick(medicalConsumer)}
                  disabled={disabled}
                  title={`Strom: Medical-Versorgung ${Math.round(stromPct)}%`}
                >
                  <Meter value={stromPct} max={100} tone={stromTone} />
                  <span className={`hosp-strom-val tone-${stromTone}`}>{Math.round(stromPct)}%</span>
                </button>
              ) : (
                <span className="hosp-strom hosp-strom-empty">—</span>
              )}

              {/* BETTEN — Notfallslots belegt/Kapazität. */}
              <span className={`hosp-betten tone-${bettenTone} ${emOver ? "over-text" : ""}`}>
                {hospital.emergencySlotsOccupied}/{hospital.emergencySlotsTotal}
              </span>
            </div>
          );
        })}
      </div>

      {/* Übrige Netz-Verbraucher als Emoji-Chips. */}
      {feedConsumers.length > 0 && (
        <div className="tile-verbraucher">
          <span className="verbr-label">Verbraucher</span>
          {feedConsumers.map((consumer) => {
            const short = consumer.currentSupply < consumer.minimumSupply;
            const reduced = consumer.status !== "nominal";
            const tone: Tone = short ? "danger" : reduced ? "warn" : "ok";
            const supplyPct =
              consumer.demand > 0 ? (consumer.currentSupply / consumer.demand) * 100 : 0;
            const sheds = shedsByConsumer.get(consumer.id) ?? [];
            const shedTotal = sheds.reduce((s, p) => s + p.amount, 0);
            return (
              <button
                key={consumer.id}
                type="button"
                data-consumer-id={consumer.id}
                className={`verbr-chip verbr-${tone}`}
                onClick={() => onConsumerClick(consumer)}
                disabled={disabled}
                title={`${consumerMeta(consumer.id).label} · ${consumer.criticalityLabel} · Systemklasse ${consumer.priorityClass} · ${consumer.reductionConsequence}`}
              >
                <span className="res-emoji" aria-hidden="true">
                  {consumerMeta(consumer.id).icon}
                </span>
                {shedTotal > 0 && <span className="verbr-shed">−{shedTotal}</span>}
                <span className="verbr-pct">{Math.round(supplyPct)}%</span>
              </button>
            );
          })}
        </div>
      )}
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
