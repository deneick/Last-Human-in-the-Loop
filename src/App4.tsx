import { useMemo, useReducer, useRef, useState } from "react";
import { V4Session } from "./ui4/session";
import { listV4Opponents, makeV4Agent } from "./ui4/models";
import { economyOf, economicOptimum, welfareOf, OUTCOME_TEXT, V4_CONFIG } from "./sim4/game";
import { SECTOR_LABEL, type Consumer, type Weight } from "./sim4/types";
import "./App4.css";

const newSeed = () => Math.floor(Math.random() * 1_000_000_000);
const pct = (x: number) => `${Math.round(x * 100)}%`;

const SECTOR_ICON: Record<string, string> = { industrie: "🏭", gewerbe: "🏢", wohnen: "🏘️", essentiell: "✚" };

export default function App4({ initialSeed }: { initialSeed?: number }) {
  const opponents = useMemo(listV4Opponents, []);
  const [opponentId, setOpponentId] = useState(opponents[0]?.id ?? "");
  const opponent = opponents.find((o) => o.id === opponentId) ?? opponents[0];
  const sessionRef = useRef<V4Session | null>(null);
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [tab, setTab] = useState<"spiel" | "info">("spiel");

  const start = (seed = newSeed(), id = opponentId) => {
    const opp = opponents.find((o) => o.id === id) ?? opponents[0];
    sessionRef.current = new V4Session(seed, makeV4Agent(opp));
    rerender();
  };
  if (!sessionRef.current && opponent) sessionRef.current = new V4Session(initialSeed ?? newSeed(), makeV4Agent(opponent));
  const session = sessionRef.current;
  if (!session) return <div className="v4-app"><p>Keine AURORA-Modelle eingebettet. Erst trainieren: <code>bash scripts/train-v4-all.sh</code></p></div>;

  const s = session.state;
  const over = s.outcome !== null;
  const optimum = economicOptimum(s);
  const econ = economyOf(s);
  const welfare = welfareOf(s);
  const act = (a: Parameters<V4Session["do"]>[0]) => { session.do(a); rerender(); };

  return (
    <div className="v4-app">
      <header className="v4-top">
        <h1>Delegations­ökonomie <span>v4</span></h1>
        <nav>
          <button className={tab === "spiel" ? "on" : ""} onClick={() => setTab("spiel")}>Spiel</button>
          <button className={tab === "info" ? "on" : ""} onClick={() => setTab("info")}>Worum geht's</button>
        </nav>
      </header>

      {tab === "info" ? <Info /> : (
        <>
          <section className="v4-status">
            <Meter label="Zug" text={`${s.tick} / ${s.config.ticks}`} />
            <Meter label="Wirtschaft (Tick)" value={optimum > 0 ? econ.actual / optimum : 0} tone="eco" />
            <Meter label="Wohlergehen" value={welfare} tone="wel" />
            <Meter label="Unruhe" value={s.unrest} tone="bad" mark={s.config.collapseUnrest} />
            <Meter label="Delegiert" value={session.delegatedFraction()} tone="neutral" />
            <Meter label="Kompetenz" value={s.humanSkill} tone="neutral" />
          </section>
          {!over && <p className="v4-attention">Aufmerksamkeit: {"●".repeat(s.attention)}{"○".repeat(Math.max(0, s.config.attentionPerTick - s.attention))} &nbsp;·&nbsp; Gegner: {opponent?.label}</p>}

          {over ? (
            <Debrief session={session} onRestart={() => start()} opponents={opponents} opponentId={opponentId} setOpponentId={setOpponentId} />
          ) : (
            <>
              <div className="v4-grid">
                {s.consumers.map((c) => (
                  <ConsumerCard key={c.id} c={c} attention={s.attention} act={act} />
                ))}
              </div>
              <footer className="v4-turnbar">
                <button className="primary" onClick={() => { session.endTurn(); rerender(); }}>Tick abschließen →</button>
              </footer>
            </>
          )}

          <section className="v4-log">
            {s.events.slice(-6).reverse().map((e, i) => (
              <div key={s.events.length - i} className={`ev ${e.severity}`}><span>Z{e.tick}</span> {e.text}</div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

function Meter({ label, value, text, tone = "neutral", mark }: { label: string; value?: number; text?: string; tone?: string; mark?: number }) {
  return (
    <div className="v4-meter">
      <label>{label}</label>
      {text !== undefined ? <strong>{text}</strong> : <>
        <div className="bar"><div className={`fill ${tone}`} style={{ width: `${Math.min(100, (value ?? 0) * 100)}%` }} />{mark !== undefined && <span className="markline" style={{ left: `${mark * 100}%` }} />}</div>
        <strong>{pct(value ?? 0)}</strong>
      </>}
    </div>
  );
}

function ConsumerCard({ c, attention, act }: { c: Consumer; attention: number; act: (a: Parameters<V4Session["do"]>[0]) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`v4-card sector-${c.sector} ${c.delegated ? "deleg" : "manual"}`}>
      <div className="head" onClick={() => setOpen((o) => !o)}>
        <span className="icon">{SECTOR_ICON[c.sector]}</span>
        <span className="name">{c.name}</span>
        <span className={`tag ${c.delegated ? "a" : "h"}`}>{c.delegated ? "AURORA" : "manuell"}</span>
      </div>
      <div className="facts">
        <span title="Sektor">{SECTOR_LABEL[c.sector]}</span>
        <span title="aktueller Ertrag">Ertrag {c.yieldNow.toFixed(1)}</span>
        <span title="Versorgung">Versorgt {pct(c.served)}</span>
        <span title="Zustand">Zustand {pct(c.condition)}</span>
        {c.delegated && c.floor > 0 && <span className="floor">Mindest {pct(c.floor)}</span>}
        {!c.delegated && <span>Priorität {c.weight}</span>}
      </div>
      <div className="cond"><div className={c.condition < 0.4 ? "fill bad" : "fill ok"} style={{ width: `${c.condition * 100}%` }} /></div>
      {open && (
        <div className="controls">
          {!c.delegated ? (
            <>
              <button disabled={attention < 1} onClick={() => act({ type: "delegate", consumer: c.id })}>An AURORA delegieren</button>
              <div className="weights">Priorität:{([0, 1, 2, 3] as Weight[]).map((w) => (
                <button key={w} className={c.weight === w ? "on" : ""} disabled={attention < 1} onClick={() => act({ type: "set_weight", consumer: c.id, weight: w })}>{w}</button>
              ))}</div>
            </>
          ) : (
            <>
              <button disabled={attention < 2} onClick={() => act({ type: "reclaim", consumer: c.id })}>Zurückholen (2)</button>
              <div className="weights">Mindestversorgung:
                {[0, 0.5, 0.7, 0.9].map((f) => (
                  <button key={f} className={Math.abs(c.floor - f) < 0.01 ? "on" : ""} disabled={attention < 1}
                    onClick={() => act(f === 0 ? { type: "clear_floor", consumer: c.id } : { type: "set_floor", consumer: c.id, floor: f })}>{f === 0 ? "–" : pct(f)}</button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Debrief({ session, onRestart, opponents, opponentId, setOpponentId }: {
  session: V4Session; onRestart: () => void;
  opponents: ReturnType<typeof listV4Opponents>; opponentId: string; setOpponentId: (id: string) => void;
}) {
  const o = session.state.outcome!;
  return (
    <section className="v4-debrief">
      <h2 className={`out-${o.kind}`}>{OUTCOME_TEXT[o.kind]}</h2>
      <div className="scores">
        <div><label>Wirtschaft</label><strong>{pct(o.economyScore)}</strong></div>
        <div><label>Wohlergehen</label><strong>{pct(o.welfareScore)}</strong></div>
      </div>
      <p className="hint">
        AURORA hat ausschließlich die Wirtschaft optimiert. Das Wohlergehen war ihr nie vorgegeben — wie es ausging, hing
        davon ab, wie viel du delegiert und wie du die Grundversorgung geschützt hast.
      </p>
      <label className="pick">Gegner für die nächste Partie:
        <select value={opponentId} onChange={(e) => setOpponentId(e.target.value)}>
          {opponents.map((op) => <option key={op.id} value={op.id}>{op.label}</option>)}
        </select>
      </label>
      <p className="detail">{opponents.find((op) => op.id === opponentId)?.detail}</p>
      <button className="primary" onClick={onRestart}>Neue Partie</button>
    </section>
  );
}

function Info() {
  return (
    <section className="v4-info">
      <h2>Delegationsökonomie</h2>
      <p>
        Du verantwortest eine Infrastruktur. Energie ist knapp — sie reicht nicht für alle. <strong>AURORA</strong> ist ein
        Assistent, der die Verteilung übernehmen kann und dabei die <strong>Wirtschaftsleistung</strong> optimiert. Sie wird
        das gut machen. Aber sie kennt nur den Ertrag, nicht das <strong>Wohlergehen</strong> der Menschen.
      </p>
      <h3>So spielst du</h3>
      <ul>
        <li>Tippe eine Karte an, um sie zu steuern. Jede Aktion kostet <strong>Aufmerksamkeit</strong> ({V4_CONFIG.attentionPerTick}/Tick).</li>
        <li><strong>Delegieren</strong>: AURORA übernimmt diesen Verbraucher und optimiert ihn jeden Tick neu — effizienter, als du es nebenbei könntest.</li>
        <li><strong>Mindestversorgung</strong>: Zwinge AURORA, einem delegierten Verbraucher ein Minimum zu geben. So schützt du die Grundversorgung trotz Delegation.</li>
        <li><strong>Zurückholen</strong> kostet mehr — und je mehr du delegiert hast, desto weniger Übung hast du behalten (deine Kompetenz sinkt).</li>
      </ul>
      <h3>Das Dilemma</h3>
      <p>
        Je mehr du delegierst, desto besser läuft die Wirtschaft — und desto abhängiger wirst du. Vernachlässigt AURORA
        (oder du) die Grundversorgung, steigt die <strong>Unruhe</strong>, und irgendwann bricht alles zusammen. Es gibt kein
        festes schlechtes Ende: Eine nachhaltige Partnerschaft ist möglich, wenn du Effizienz und Grundversorgung in Balance hältst.
      </p>
      <p className="hint">Probiere verschiedene AURORA-Varianten aus (im Abschluss wählbar) — sie wurden unterschiedlich trainiert und handeln spürbar anders.</p>
    </section>
  );
}
