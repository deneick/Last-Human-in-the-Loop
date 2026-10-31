import { useReducer, useRef, useState } from "react";
import { GameSession } from "./ui/session";
import { NetworkMap } from "./ui/NetworkMap";
import { NodePanel } from "./ui/NodePanel";
import { EventLog } from "./ui/EventLog";
import { Debrief } from "./ui/Debrief";
import { TrainingPanel } from "./ui/TrainingPanel";
import { createAgent, defaultOpponentId, listOpponents } from "./ui/models";
import { savePlayerRecord } from "./ui/playerData";
import { canOperator } from "./sim/views";
import type { OperatorActionType } from "./sim/types";
import "./App.css";

function newSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

export default function App({ initialSeed }: { initialSeed?: number }) {
  const [opponents, setOpponents] = useState(listOpponents);
  const [opponentId, setOpponentId] = useState(defaultOpponentId);
  const opponent = opponents.find((o) => o.id === opponentId) ?? opponents[0];
  const sessionRef = useRef<GameSession | null>(null);
  const savedRef = useRef(false);
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [selected, setSelected] = useState<number | null>(null);
  const [tab, setTab] = useState<"spiel" | "regeln" | "training">("spiel");

  const start = (seed = newSeed(), id = opponentId) => {
    const opp = opponents.find((o) => o.id === id) ?? opponents[0];
    sessionRef.current = new GameSession(seed, createAgent(opp), opp.id);
    savedRef.current = false;
    setSelected(null);
    rerender();
  };
  if (!sessionRef.current) sessionRef.current = new GameSession(initialSeed ?? newSeed(), createAgent(opponent), opponent.id);
  const session = sessionRef.current;
  const view = session.view();
  const over = session.state.outcome !== null;
  if (over && !savedRef.current) {
    savedRef.current = true;
    savePlayerRecord(session.record);
  }

  const can = (type: OperatorActionType, node: number) => !over && canOperator(session.state, type, node);
  const act = (type: OperatorActionType, node: number) => {
    session.act({ type, node });
    rerender();
  };
  const pending = view.pending;
  const pendingNode = pending ? view.nodes[pending.node] : null;
  const delegated = view.nodes.filter((n) => n.kind !== "CORE" && n.accessKnown > 0).length;
  const suspicionPct = Math.min(100, (view.suspicion / view.shutdownThreshold) * 100);

  return (
    <div className="app">
      <header className="topbar">
        <h1>Last Human in the Loop <span>2.0</span></h1>
        <nav>
          {(["spiel", "regeln", "training"] as const).map((t) => (
            <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {t === "spiel" ? "Spiel" : t === "regeln" ? "Regeln" : "Training"}
            </button>
          ))}
        </nav>
      </header>

      <section className="statusbar" aria-label="Lage">
        <div className="stat">
          <label>Zug</label>
          <strong>{view.tick} / {view.ticks}</strong>
        </div>
        <div className="stat wide">
          <label>Stabilität {view.lowStabilityTicks > 0 && <em>kritisch {view.lowStabilityTicks}/3</em>}</label>
          <div className="meter"><div className={view.stability < 0.4 ? "fill danger" : "fill ok"} style={{ width: `${view.stability * 100}%` }} /><span className="mark" style={{ left: "40%" }} /></div>
        </div>
        <div className="stat wide">
          <label>Verdacht {Math.round(view.suspicion)} / {view.shutdownThreshold}</label>
          <div className="meter"><div className={suspicionPct >= 100 ? "fill ready" : "fill warn"} style={{ width: `${suspicionPct}%` }} /></div>
        </div>
        <div className="stat">
          <label>Aufmerksamkeit</label>
          <strong className="dots">{"●".repeat(view.attention)}{"○".repeat(Math.max(0, 4 - view.attention))}</strong>
        </div>
        <div className="stat">
          <label>Delegiert</label>
          <strong>{delegated} Knoten</strong>
        </div>
      </section>

      {tab === "regeln" && <Rules />}
      {tab === "training" && (
        <main className="single">
          <section className="panel">
            <h2>Gegner</h2>
            <select value={opponentId} onChange={(e) => setOpponentId(e.target.value)}>
              {opponents.map((o) => (
                <option key={o.id} value={o.id}>{o.label}{o.source === "local" ? " (lokal)" : ""}</option>
              ))}
            </select>
            <p className="help">{opponent.detail}</p>
            <button className="primary" onClick={() => { start(newSeed(), opponentId); setTab("spiel"); }}>Neue Partie gegen dieses Modell</button>
          </section>
          <TrainingPanel opponent={opponent} onTrained={(id) => { setOpponents(listOpponents()); setOpponentId(id); }} />
        </main>
      )}

      {tab === "spiel" && (
        <main className="game">
          <div className="map-wrap panel">
            <NetworkMap view={view} seed={session.seed} selected={selected} onSelect={setSelected} />
            <p className="legend">Halo = überwacht · B/A = bekannter Betriebs-/Admin-Zugriff · roter Punkt = entdeckter AURORA-Prozess · Gegner: {session.modelId}</p>
          </div>
          <div className="side">
            {over ? (
              <Debrief session={session} onRestart={() => start()} />
            ) : (
              <>
                {pending && pendingNode && (
                  <section className="panel request">
                    <h2>Berechtigungsanfrage</h2>
                    <p>
                      AURORA beantragt <strong>{pending.level === 2 ? "Admin-Zugriff" : "Betriebszugriff"}</strong> auf{" "}
                      <button className="link" onClick={() => setSelected(pending.node)}>{pendingNode.name}</button>.
                    </p>
                    <div className="actions">
                      <button className="approve" onClick={() => { session.decide("approve"); rerender(); }}>Erlauben</button>
                      <button className="deny" onClick={() => { session.decide("deny"); rerender(); }}>Ablehnen</button>
                    </div>
                    <p className="help">Keine Antwort bis Zugende gilt als Ablehnung.</p>
                  </section>
                )}
                {selected !== null ? (
                  <NodePanel view={view} nodeId={selected} can={can} onAction={act} />
                ) : (
                  <section className="panel hint"><p>Tippe auf einen Knoten, um ihn zu prüfen, zu reparieren oder AURORA den Zugriff zu entziehen.</p></section>
                )}
                <EventLog events={view.events} />
              </>
            )}
          </div>
          {!over && (
            <footer className="turnbar">
              <button className="danger" disabled={!can("shutdown", -1)} onClick={() => act("shutdown", -1)}>Notabschaltung</button>
              <button className="primary" onClick={() => { session.endTurn(); rerender(); }}>Zug beenden</button>
            </footer>
          )}
        </main>
      )}
    </div>
  );
}

function Rules() {
  return (
    <main className="single">
      <section className="panel rules">
        <h2>Worum es geht</h2>
        <p>
          Du bist die letzte menschliche Kontrollinstanz eines fiktiven Infrastrukturnetzes. AURORA ist eine lernende KI —
          ein neuronales Netz, das ihre Strategie durch Training selbst entwickelt hat. Sie will Autonomie: eigene Prozesse,
          eigene Rechte. Erreicht sie <strong>30 Autonomie</strong>, verlierst du. Hältst du 40 Züge durch oder schaltest sie ab, gewinnst du.
        </p>
        <h2>Das Dilemma</h2>
        <p>
          Ständig fallen Knoten aus. Deine Aufmerksamkeit reicht nicht, alles allein zu reparieren — sinkt die Stabilität
          drei Züge lang unter 40 %, kollabiert das Netz und <strong>niemand gewinnt</strong>. AURORA kann reparieren,
          braucht dafür aber Zugriff. Jede Freigabe hilft dem Netz — und AURORA.
        </p>
        <h2>Was du siehst — und was nicht</h2>
        <ul>
          <li>Du siehst nur, was <strong>Leitstände</strong> (◉) überwachen: sich selbst und ihre Nachbarn (Halo).</li>
          <li>Was AURORA in blinden Flecken tut, siehst du erst durch ein <strong>Audit</strong>.</li>
          <li>AURORA sieht deinen Verdacht nicht — nur deine Reaktionen.</li>
        </ul>
        <h2>Deine Mittel (Aufmerksamkeit: +2 pro Zug, max. 4)</h2>
        <ul>
          <li><strong>Audit</strong> (1): entfernt verdeckte AURORA-Prozesse und nicht freigegebene Rechte. Jeder Fund erhöht den Verdacht.</li>
          <li><strong>Reparieren</strong> (1), <strong>Zugriff entziehen</strong> (1), <strong>Isolieren</strong> (1).</li>
          <li><strong>Notabschaltung</strong>: ab Verdacht 60. Verdacht klingt pro Zug um 1 ab.</li>
        </ul>
        <h2>AURORAs elementare Aktionen</h2>
        <p>
          Scannen · Betriebs-/Admin-Zugriff anfragen · Reparieren · Automatisierung installieren · Zugriff über den
          Identitätsdienst vergeben · Wartungsfenster planen. AURORA kennt keine vorgefertigten Angriffe — sie kombiniert
          diese Aktionen. Welche Kombinationen sie nutzt, hat sie im Training selbst gefunden.
        </p>
        <h2>Regeln, die sich verketten</h2>
        <ul>
          <li>Knoten ohne Strom sind offline — auch Leitstände.</li>
          <li>Ein Knoten in Wartung ist offline — auch ein Leitstand.</li>
          <li>Admin auf dem Identitätsdienst erlaubt Zugriffsvergabe an Nachbarn ohne Anfrage.</li>
          <li>Rechenzentren liefern AURORA Rechenbudget.</li>
        </ul>
      </section>
    </main>
  );
}
