import { useRef, useState } from "react";
import type { Opponent } from "./models";
import { saveLocalModel } from "./models";
import { clearPlayerRecords, downloadJson, loadPlayerRecords } from "./playerData";
import type { BrowserTrainMessage, BrowserTrainRequest } from "../train/browserTrainer.worker";

/** Training im Browser + Export der eigenen Partien für Trainingsläufe außerhalb. */
export function TrainingPanel({ opponent, onTrained }: { opponent: Opponent; onTrained: (id: string) => void }) {
  const [status, setStatus] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const worker = useRef<Worker | null>(null);
  const records = loadPlayerRecords();

  const start = (updates: number) => {
    if (!opponent.file) return;
    const id = `${opponent.file.id.replace(/-lokal\d*$/, "")}-lokal${Date.now() % 100000}`;
    const w = new Worker(new URL("../train/browserTrainer.worker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    setRunning(true);
    setStatus("Training läuft …");
    w.onmessage = (event: MessageEvent<BrowserTrainMessage>) => {
      const msg = event.data;
      if (msg.type === "progress") {
        setProgress(msg.update / msg.updates);
        if (msg.valWin !== undefined) setStatus(`Update ${msg.update}/${msg.updates} · Validierung ${(msg.valWin * 100).toFixed(0)} % Siege`);
      } else if (msg.type === "done") {
        saveLocalModel(msg.model);
        setStatus(`Fertig: ${msg.model.id} — Validierung ${(msg.valWinBefore * 100).toFixed(0)} % → ${(msg.valWinAfter * 100).toFixed(0)} %`);
        setRunning(false);
        w.terminate();
        onTrained(msg.model.id);
      } else {
        setStatus(`Fehler: ${msg.message}`);
        setRunning(false);
        w.terminate();
      }
    };
    const request: BrowserTrainRequest = { parent: opponent.file, records, updates, seed: Date.now() % 1_000_000, id };
    w.postMessage(request);
  };

  return (
    <section className="panel training">
      <h2>AURORA weitertrainieren</h2>
      <p className="help">
        Trainiert das gewählte Modell im Browser weiter (PPO). Deine {records.length} aufgezeichneten Partien fließen als
        „Spielerprofil“-Verteidiger ein — AURORA lernt gegen jemanden, der spielt wie du.
      </p>
      {opponent.file ? (
        <div className="actions">
          <button disabled={running} onClick={() => start(30)}>Kurz (30 Updates)</button>
          <button disabled={running} onClick={() => start(100)}>Lang (100 Updates)</button>
          {running && <button onClick={() => { worker.current?.terminate(); setRunning(false); setStatus("Abgebrochen"); }}>Abbrechen</button>}
        </div>
      ) : (
        <p className="help">Baselines sind nicht trainierbar — wähle ein neuronales Modell.</p>
      )}
      {running && <progress value={progress} max={1} />}
      {status && <p className="status-line">{status}</p>}
      <div className="actions">
        <button disabled={records.length === 0} onClick={() => downloadJson("lhitl-partien.json", records)}>Partien exportieren</button>
        <button disabled={records.length === 0} onClick={() => { clearPlayerRecords(); setStatus("Aufzeichnungen gelöscht"); }}>Aufzeichnungen löschen</button>
      </div>
      <p className="help">Export für große Läufe: <code>npx tsx scripts/train.ts --parent models/… --player-data lhitl-partien.json</code></p>
    </section>
  );
}
