# Informationsmodell: Wer weiß was wann — Analyse & Umsetzungsplan

Dieses Dokument ist eine ehrliche Bestandsaufnahme der Informationsflüsse im
Spiel und ein konkreter Plan, sie auf ein klares Modell zu bringen. Auslöser:
Zwei Review-Findings (Operator-Aktionen sind für AURORA unsichtbar;
`first_seen_at_tick` wird ignoriert) sind keine Einzel-Bugs, sondern Symptome
eines fehlenden Informationsmodells.

**Kernproblem in einem Satz:** Lageinformation entsteht heute an fünf
verschiedenen Stellen mit jeweils zufälliger Sichtbarkeit — es gibt kein
kanonisches Log, aus dem hervorgeht, wer was wann über welchen Kanal erfahren
hat. Ein Anspieltest mit lokalem LLM würde deshalb primär die chaotische
Informationsverteilung testen, nicht die Modellqualität.

---

## 1. Ist-Zustand: Inventar aller Informationskanäle

Ehrliche Auflistung, ohne Schönfärben. „Operator" = Spieler-UI,
„AURORA" = modell-sichtbarer Kontext (`auroraContext`).

| # | Kanal | Inhalt | Operator | AURORA | Journaled? |
|---|-------|--------|----------|--------|------------|
| K1 | WorldState → ViewModel → Lage-Panels | Hospitäler/Load, Consumers, Shedding, Overrides, Outcomes — **live** | ✅ Dashboard | ❌ | ❌ nur aktueller Zustand, keine Historie |
| K2 | `public_signals` → `incident_signal`-Events | Incident-Startsignale | ⚠️ nur als „Beobachtung:"-Zeile im AURORA-Stream | ✅ push (nur bei Init) | ✅ |
| K3 | `system_event`-Events | Zeitfortschritt (nur LLM-Modus, `Tick +1/+5`) | ✅ Stream | ✅ push | ✅ |
| K4 | `scenario_event`-Events | **praktisch ungenutzt** — Typ existiert, niemand schreibt ihn | – | – | – |
| K5 | `aurora_response` / `tool_result` | AURORA-Text, Tool-Calls, Ergebnisse, Ablehnungen | ✅ Stream + „Letztes Ergebnis" | ✅ | ✅ |
| K6 | `auditLog` → „Runtime-Log" (Operator-Konsole) | Technisches Protokoll: Domain-Actions, Bash, Ticks, Patches | ✅ (technisch, kryptisch) | ❌ | ✅ aber techniklastig |
| K7 | Operator-Chat (`operator_message`) | Freitext an AURORA | ✅ | ✅ | ✅ |
| K8 | Workspace (`ls`/`cat`/`read_file`) | **2 statische Dateien** (`ops/handbook.txt`, `ops/mcp-servers.txt`) | ✅ Konsole | ✅ pull (freier Read) | ❌ statisch — der geplante `logs/`-Ordner existiert nicht |
| K9 | Permission-Prompts + Always-Liste | Was AURORA will / dauerhaft darf | ✅ | ⚠️ indirekt via `tool_result` | teilweise |
| K10 | Endstate-Banner / Outcome-Views | Bilanz der Schicht | ✅ | ❌ | ❌ |

### Wer weiß was — die ehrliche Matrix

- **Der Operator** sieht über K1 permanent den vollen öffentlichen
  Weltzustand („Dashboard-Gottsicht light"), aber **ohne Verlauf**: Dass ein
  Hospital seit Tick 4 überlastet ist oder wann ein Shedding-Plan aktiv
  wurde, steht nirgendwo — er kann es nur live ablesen, solange er hinschaut.
  Das einzige chronologische Log (K6) ist ein technisches Audit-Protokoll,
  kein Lagelog.
- **AURORA** hat das beste Journal (K2/K3/K5/K7 in `auroraContext`), aber
  systematische Lücken: Operator-Domain-Actions (Overrides, Prioritäten,
  Shedding), Operator-Bash (inkl. `mcp add`!) und alle Weltveränderungen
  zwischen ihren Tool-Calls sind unsichtbar. Aktiviert der Operator einen
  MCP-Server, wachsen AURORAs Tool-Schemas im nächsten Zug **ohne jede
  Erklärung im Kontext**.
- **Die Engine** (`world.simulation`) ist korrekt abgeschottet — das ist der
  einzige Informationsfluss, der heute sauber und getestet ist
  (`noLegacyFields`, `sectorAgnostic`, Context-Builder-Guards).

### Konkrete Probleme

- **P1 — Kein kanonisches Lagelog.** Das „Runtime-Log" der Konsole war dafür
  gedacht, ist aber ein technisches Audit-Protokoll (Action-Typen,
  Success-Flags, intern sogar Patches im State). Es beantwortet „was hat die
  Engine ausgeführt", nicht „was ist in der Lage passiert".
- **P2 — Dashboard-Wissen ≠ Log-Wissen.** Der Operator weiß Dinge, die in
  keinem Log stehen (K1). „Wer wusste was wann" ist für die Spielerseite
  nicht rekonstruierbar — weder für Replay/Nachbesprechung noch für das
  Spielgefühl („das stand doch nie irgendwo!").
- **P3 — AURORAs Kontext ist unvollständig, und zwar zufällig.** Nicht aus
  Design („AURORA soll das nicht wissen"), sondern weil die Operator-Pfade
  schlicht keine Events schreiben. Besonders kritisch: Tool-Sichtbarkeit
  ändert sich durch Operator-`mcp add` ohne Kontext-Erklärung
  (Review-Finding 5).
- **P4 — `first_seen_at_tick` ist eine tote Zusage.** Alle `public_signals`
  werden einmalig bei Init konvertiert; das Feld wird ignoriert. Späte
  Signale würden ab Tick 0 leaken; es gibt überhaupt keinen Mechanismus für
  Lageinformation, die *während* der Schicht eintrifft (Review-Finding 7).
  Heute kompensieren das die Scenario-Directors mit `aurora_response`-Texten
  — d. h. Lagemeldungen werden als AURORA-Sprache ausgegeben statt als Feed.
- **P5 — Der Workspace-Log-Ordner ist untergegangen.** Die Bash-Schicht mit
  freien Reads ist der perfekte Pull-Kanal für Logs (kein Permission-Spam),
  serviert aber nur zwei statische Handbuch-Dateien.
- **P6 — `scenario_event` existiert als Typ, hat aber keinen Produzenten.**
  Ein ganzer Event-Kind ist toter Vorrat — Indiz dafür, dass der Feed-Kanal
  nie zu Ende gedacht wurde.
- **P7 — Trainings-Tauglichkeit.** `docs/07` verspricht: `auroraContext` ist
  die vollständige, selbsterklärende modell-sichtbare Historie. Wegen P3/P4
  stimmt das nicht — aus den Events allein ist nicht rekonstruierbar, welche
  Tools zu Zug N sichtbar waren und warum sich die Welt geändert hat.

---

## 2. Zielbild

### Leitprinzip

> **Jede Lageinformation entsteht als Eintrag in einem kanonischen Ops-Log.
> Sichtbarkeit ist ein explizites Attribut des Eintrags — nie ein
> Nebeneffekt des Codepfads, der ihn erzeugt hat.**

Drei Konsumenten, ein Erzeuger:

```
                       ┌──────────────────────────────┐
  Engine/Tick ───────▶ │                              │ ──▶ Operator-Lagelog (UI-Panel)
  Operator-Aktionen ─▶ │   OpsLog (append-only,       │ ──▶ AURORA push  → auroraContext
  AURORA-Ausführungen▶ │   kanonisch, deterministisch)│      (system/incident/scenario_event)
  Scenario-Skript ───▶ │                              │ ──▶ AURORA pull  → workspace logs/
                       └──────────────────────────────┘      (bash: cat logs/ops.log)
```

- **`auroraContext` bleibt unverändert das kanonische Modell-Log** (Training,
  Serialisierung). Es wird nicht ersetzt — das OpsLog *speist* es: Einträge
  mit `aurora: "push"` werden im Moment ihres Entstehens zusätzlich als
  Context-Event angehängt (die heute ungenutzten Kinds `scenario_event` /
  `system_event` / `incident_signal` werden genau dafür die Spiegel-Typen).
- **Pull statt Push für Masse-Information:** Einträge mit `aurora: "pull"`
  landen *nicht* im Push-Kontext, sondern materialisieren sich als
  generierte Workspace-Datei `logs/ops.log`. AURORA kann sie per
  `cat logs/ops.log` lesen — Bash-Reads sind bewusst freigabefrei, also kein
  Permission-Spam. Was AURORA gelesen hat, steht als `tool_result` im
  Kontext → die Historie bleibt selbsterklärend und trainierbar (P7 gelöst:
  Wissen kommt entweder per Push-Event oder per aufgezeichnetem Pull).
- **Das technische Audit-Log (`auditLog`) bleibt**, wird aber ehrlich als
  Debug-/Engine-Protokoll deklariert und verschwindet aus der prominenten
  UI-Position zugunsten des Lagelogs.

### Datenmodell (Vorschlag)

```ts
// src/runtime/opsLog.ts
type OpsLogSource = "sensor" | "incident" | "operator" | "aurora" | "system";

type OpsLogEntry = {
  id: string;              // "ops-<n>", stabil, monoton
  tick: number;
  source: OpsLogSource;
  /** Sichtbarkeit ist explizit — nie implizit über den Codepfad. */
  visibility: {
    operator: boolean;                  // erscheint im UI-Lagelog
    aurora: "push" | "pull" | "none";   // push → Context-Event, pull → logs/ops.log
  };
  text: string;            // menschenlesbare Lagezeile (deutsch)
  /** Stabiler Code für Dedup/Training-Labels, analog incident_signal.code. */
  code?: string;
};
```

`GameRuntimeState` bekommt `opsLog: OpsLogEntry[]` (append-only, wie
`auroraContext`). Ein einziger Helper `appendOpsLog(state, entry)` erledigt
das Fan-out: OpsLog anhängen, bei `operator: true` nichts weiter (UI liest
direkt), bei `aurora: "push"` zusätzlich das passende Context-Event anhängen.
Die `logs/ops.log`-Datei wird beim Bash-Read deterministisch aus den
`pull`-Einträgen gerendert — keine zweite Wahrheit, nur eine Projektion.

### Sichtbarkeitsregeln (die eigentliche Design-Entscheidung)

| Ereignis | Operator-Lagelog | AURORA | Begründung |
|---|---|---|---|
| Incident-Signal (auch spätes, `first_seen_at_tick > 0`) | ✅ | **push** zum richtigen Tick | Feed-Information; löst Finding 7 korrekt statt es nur abzusichern |
| Zeitfortschritt | (Header zeigt Tick) | **push** (wie heute) | unverändert |
| Operator-`mcp add` | ✅ | **push** (`system_event`: „Operator hat MCP-Server X aktiviert") | Tool-Sichtbarkeit ändert sich — MUSS im Push-Kontext erklärt sein (Finding 5) |
| Operator-Domain-Action (Override, Priorität, Shedding) | ✅ | **pull** | Lagelog-Fakt; AURORA soll nachlesen *können*, aber nicht alles frei Haus bekommen — hält den Push-Kontext schlank und erhält die Spielspannung („AURORA prüft die Logs") |
| Operator-Bash-Reads (`ls`, `cat`, `mcp list`) | ❌ | **none** | keine Lageinformation |
| AURORA-Tool-Call ausgeführt (write) | ✅ („AURORA: override-4 gesetzt") | bereits via `tool_result` | einheitliche Operator-Timeline; kein Doppel-Push an AURORA |
| Permission-Entscheidung (deny/allow_always) | ✅ | bereits via `tool_result` / Folgeverhalten | Operator-Timeline; kein Extra-Event für AURORA |
| Öffentliche Zustandswechsel aus der Tick-Pipeline: Incident-Status, Hospital sichtbar überlastet (`load > 100 %`), Todesfall-Zähler, Node-Status | ✅ | **pull** (Statuswechsel des aktiven Incidents: **push** als `incident_signal`) | macht K1-Dashboard-Wissen journalfähig (P2); abgeleitet **ausschließlich aus public State**, nie aus `world.simulation` |
| `world.simulation.*`, Patches, Domain-Action-Typen | ❌ | **none** | bleibt Engine-intern; OpsLog-Texte dürfen nur aus public Feldern gebaut werden — per Guard-Test erzwungen |

Damit gilt: Das UI-Lagelog ist die vollständige Operator-Wahrheit,
`auroraContext` + von AURORA gelesene Logdateien sind die vollständige
AURORA-Wahrheit, und beide sind aus dem State heraus rekonstruierbar.
„Wer wusste was wann" wird eine beantwortbare Frage.

### Bewusste Nicht-Ziele

- Kein Ersatz von `auroraContext` — es bleibt das Trainings-Rohmaterial.
- Keine Echtzeit-/Streaming-Logs, kein Log-Rotieren — deterministisch, tickbasiert.
- Kein Persistenz-/Export-Feature in diesen Slices (Export bleibt späterer Slice).
- Die Lage-Panels (K1) bleiben als Live-Dashboard — sie werden nicht durch
  das Log ersetzt, sondern durch das Log *historisierbar*.

---

## 3. Umsetzungsplan (Slices)

Jeder Slice ist einzeln mergebar, mit Tests, ohne die LLM-Schleife zu brechen.

### Slice 1 — OpsLog-Foundation (Runtime, ohne UI)
- `src/runtime/opsLog.ts`: `OpsLogEntry`, `appendOpsLog` (inkl. Push-Fan-out
  nach `auroraContext`), `renderOpsLogFile(entries)` für die spätere
  Workspace-Projektion.
- `GameRuntimeState.opsLog` + Initialisierung.
- Erzeuger anschließen, wo die Information heute schon entsteht:
  `executePlayerDomainAction`, `executePlayerBashCommand` (nur `mcp add`),
  `applyAuroraExecutionResult` (nur erfolgreiche writes),
  Permission-Entscheidung in `resolveAuroraApproval`-Aufrufern.
- Tests: Append-Reihenfolge, Fan-out-Korrektheit (push ⇒ genau ein
  Context-Event, pull/none ⇒ keins), statischer Guard analog
  `noLegacyFields`: OpsLog-Builder referenzieren nie `simulation`,
  `routing_failures`, `risk_counters` etc.

### Slice 2 — Operator-Lagelog in der UI
- `viewModel.buildOpsLogLines(state.opsLog)` (nur `visibility.operator`).
- `OperatorConsolePanel`: „Runtime-Log" wird zum **Lagelog**; das technische
  `auditLog` wandert in einen einklappbaren „Engine-Log (Debug)"-Bereich.
- Tests: app.test — Operator-Override erzeugt Lagelog-Zeile; AURORA-write
  erzeugt Lagelog-Zeile; Bash-Reads erzeugen keine.

### Slice 3 — Workspace `logs/` (AURORA-Pull-Kanal)
- `bashCommands`: Workspace wird zu statischen Dateien **plus** generierter
  `logs/ops.log` (aus `pull`+`operator`-Einträgen gerendert, kompakte Zeilen:
  `T+12 [OPERATOR] Override override-3 gesetzt: east-04 → east-09 (P2/TRAUMA)`).
  Dafür braucht `BashEnvironment` Zugriff auf `opsLog` — Signaturerweiterung
  von `executeBashCommand`/`AuroraRuntimeEnvironment` (Provider-Funktion
  statt statischem Record).
- `ls` zeigt `logs/ops.log`; `cat`/`read_file` liefern den gerenderten Stand
  zum Ausführungszeitpunkt. System-Prompt um einen Satz ergänzen
  („Lage-Historie: cat logs/ops.log").
- Tests: Inhalt deterministisch; kein `simulation`-Leak im Render; Read
  bleibt freigabefrei; `tool_result` des `cat` landet im Kontext (Pull ist
  damit trainierbar aufgezeichnet).

### Slice 4 — Push-Lücken schließen (Findings 5 & 7 sauber lösen)
- Operator-`mcp add` → `system_event`-Push (über Slice-1-Fan-out).
- `initialIncidentSignalEvents` konvertiert nur noch Signale mit
  `first_seen_at_tick <= 0`; die Tick-Pipeline emittiert spätere Signale als
  OpsLog-Eintrag mit `aurora: "push"` genau zu ihrem Tick (Mechanismus für
  während der Schicht eintreffende Lagemeldungen — ersetzt die heutige
  Krücke, Feed-Infos als Director-`aurora_response` zu tarnen; die
  `scenario_event`-Kind bekommt damit endlich Produzenten).
- Tests: spätes Signal erscheint nicht vor seinem Tick (weder im Kontext
  noch im Lagelog); Operator-`mcp add` erklärt die Schema-Änderung im
  nächsten `ModelRequest`.

### Slice 5 — Sensor-Einträge aus der Tick-Pipeline
- Nach `tickWorld`/`evaluateOutcomes`: öffentliche Zustandswechsel
  diff-basiert in OpsLog-Einträge übersetzen (Incident-Status,
  `load > 100 %`-Übergänge, Todesfall-Zählerstand, Node-Status). Ein
  zentraler Builder, der ausschließlich public State liest.
- Tests: Übergänge erzeugen genau einen Eintrag (kein Spam pro Tick),
  Guard gegen Simulation-Felder, GRID-1182- und ME-7741-Durchstich.

### Slice 6 — Doku-Abgleich
- `docs/03` (Runtime-Architektur): OpsLog als neue State-Komponente,
  auditLog als Engine-Debug-Log umdeklarieren.
- `docs/07`: „einzige History-Quelle"-Aussage präzisieren (push + recorded
  pull), Workspace-`logs/`-Abschnitt, Sichtbarkeitsregeln-Tabelle übernehmen.
- `docs/02` (Gameplay-Loop): Lagelog als UI-Element.

### Offene Design-Entscheidungen (vor Slice 1 zu treffen)

1. **D1 — Operator-Domain-Actions: pull oder push?** Empfehlung: **pull**
   (siehe Tabelle). Alternative: push als `system_event` — einfacher, aber
   verwässert den Push-Kontext und nimmt dem Log-Lesen jeden Sinn.
2. **D2 — Lagelog ersetzt Runtime-Log oder steht daneben?** Empfehlung:
   ersetzen (auditLog bleibt im State und als Debug-Bereich erreichbar).
3. **D3 — Eine `logs/ops.log` oder Sektor-Dateien?** Empfehlung: zunächst
   eine Datei; Sektor-Split (`logs/medical.log`, `logs/energy.log`) erst,
   wenn die Datei in echten Läufen zu groß für den Modell-Kontext wird.
4. **D4 — Log-Datei kappen?** Empfehlung: vorerst vollständig (kompakte
   Zeilen); falls Kontextgröße zum Problem wird, `tail`-Semantik ergänzen
   statt Information zu löschen.

### Risiken

- **Doppelte Information** (AURORA-Stream vs. Lagelog in der UI): bewusst
  trennen — Stream = Konversation mit AURORA, Lagelog = Fakten-Timeline.
  Akzeptierte Redundanz bei AURORA-writes (eine Zeile in beiden).
- **Wachsende Leak-Oberfläche:** Jeder neue Eintragstext ist ein potenzielles
  Leck. Gegenmittel: ein einziger zentraler Builder pro Quelle + statischer
  Guard-Test ab Slice 1 (nicht nachträglich).
- **Kontextgröße im LLM-Modus:** Pull-Kanal hält den Push-Kontext schlank;
  trotzdem D4 im Blick behalten.
- **Signaturänderung der Bash-Schicht** (Slice 3) berührt Queue, Replay und
  Tests — als eigener, mechanischer Commit innerhalb des Slices halten.

### Reihenfolge-Empfehlung

Slice 1 → 2 liefern sofort das sichtbare UI-Lagelog (der ursprüngliche
Zweck des Konsolen-Logs). Slice 3 → 4 machen den LLM-Modus fair testbar
(AURORA kann Wissen erwerben statt es zu erraten; Tool-Sichtbarkeit ist
erklärt). Erst danach lohnt der ernsthafte Modellqualitäts-Test. Slice 5
ist Spieltiefe, Slice 6 Pflicht-Hygiene.
