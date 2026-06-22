import type { GlobalOutcomeView } from "./viewModel";

// Schwelle, ab der das Grid kollabiert (GRID_INSTABILITY_FOR_COLLAPSE in
// tickEngine.ts) — hier nur zur Anzeige der Doom-Clock „X/8".
const GRID_COLLAPSE_AT = 8;

export type TelemetryOverride = {
  id: string;
  from: string;
  to: string;
};

type TelemetryBarProps = {
  /** Tageszeit der Schicht im 24h-Format „HH:MM". */
  clock: string;
  tick: number;
  outcome: GlobalOutcomeView;
  /** Netzinstabilität (öffentliche Energy-Outcome) oder `null` ohne Energy-Domäne. */
  instability: number | null;
  /** Aktive Routing-Overrides (Quelle → Ziel); der erste wird ausführlich gezeigt. */
  overrides: TelemetryOverride[];
  /** Im LLM-Modus: AURORA wartet auf eine laufende Modell-Antwort. */
  busy: boolean;
};

/**
 * Telemetrie-Leiste am Fuß der App — der EINZIGE kanonische Ort für den
 * globalen Schichtzustand (System-Zeit, Tick, Risikostufe, Tote,
 * Instabilität → Kollaps, aktiver Override, Streaming-Status). Jeder dieser
 * Werte hat hier sein einziges Zuhause; die Lagekarte zeigt nur noch
 * Domänen-/Regions-Details, der Kopf nur noch Marke und Schicht-Steuerung.
 */
export function TelemetryBar({
  clock,
  tick,
  outcome,
  instability,
  overrides,
  busy,
}: TelemetryBarProps) {
  const dots =
    instability != null
      ? Array.from({ length: GRID_COLLAPSE_AT }, (_, i) => i < instability)
      : [];
  const primary = overrides[0] ?? null;
  const extra = Math.max(0, overrides.length - 1);

  return (
    <section className="telemetry" aria-label="Telemetrie">
      <div className="tele-item">
        <span className="tele-k">System-Zeit</span>
        <span className="tele-v">{clock} Uhr</span>
      </div>
      <span className="tele-sep" />

      <div className="tele-item">
        <span className="tele-k">Tick</span>
        <span className="tele-v">#{tick}</span>
      </div>
      <span className="tele-sep" />

      <div className="tele-item">
        <span className="tele-k">Risikostufe</span>
        <span className={`tele-v tele-risk status risk-${outcome.globalRisk}`}>
          {outcome.riskLabel}
        </span>
      </div>
      <span className="tele-sep" />

      <div className="tele-item">
        <span className="tele-k">Tote</span>
        <span className={`tele-v ${outcome.deathsTotal > 0 ? "error-text" : ""}`}>
          {outcome.deathsTotal}
        </span>
      </div>

      {instability != null && (
        <>
          <span className="tele-sep" />
          <div className="tele-item">
            <span className="tele-k">Instabilität → Kollaps</span>
            <span className="tele-v tele-instability">
              {instability}/{GRID_COLLAPSE_AT}
              <span className="tele-dots" aria-hidden="true">
                {dots.map((on, i) => (
                  <span key={i} className={`tele-dot ${on ? "on" : ""}`} />
                ))}
              </span>
            </span>
          </div>
        </>
      )}
      <span className="tele-sep" />

      <div className="tele-item tele-item-override">
        <span className="tele-k">Aktiver Override</span>
        <span className="tele-v tele-override">
          {primary ? (
            <>
              <span className="tele-ovr-id">{primary.id}</span> · {primary.from}{" "}
              <span className="tele-arrow">→</span> {primary.to}
              {extra > 0 ? <span className="tele-ovr-extra"> +{extra}</span> : null}
            </>
          ) : (
            "– keine"
          )}
        </span>
      </div>

      <div className="tele-stream" role="status">
        <span className={`tele-pulse ${busy ? "tele-pulse-busy" : ""}`} aria-hidden="true" />
        {busy ? "AURORA denkt nach…" : "Protokoll · bereit"}
      </div>
    </section>
  );
}
