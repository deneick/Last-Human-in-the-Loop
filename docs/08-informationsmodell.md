# Informationsmodell: Wer weiß was wann

Dieses Dokument beschreibt das kanonische Informationsmodell des Spiels: die
vier Kanäle, ihre Verantwortlichkeiten und — als Kern — den **opsFeed** als
spielsichtbaren Lage-/Betriebs-Feed. Auslöser war eine ehrliche
Bestandsaufnahme (Abschnitt 1): Lageinformation entstand an fünf verschiedenen
Stellen mit zufälliger Sichtbarkeit; es gab kein kanonisches Log, aus dem
hervorging, wer was wann über welchen Kanal erfahren hat.

**Die vier Kanäle (verbindlich):**

1. **`world` (WorldState)** bleibt die interne Simulationswahrheit.
2. **`auditLog`** bleibt ein technisches Runtime-/Debug-Log und wird in der
   normalen UI **nicht** angezeigt.
3. **`auroraContext`** bleibt der modell-/trainingssichtbare Kontext: was
   AURORA tatsächlich gesehen, gesagt und von Tools zurückbekommen hat.
4. **`opsFeed`** ist der kanonische, spielsichtbare Feed beobachtbarer
   Lage-/Operations-Ereignisse. Die normale UI zeigt ihn als **„Log"**.
   Workspace-Logdateien werden pro Sektor aus dem opsFeed generiert. Einzelne
   opsFeed-Events werden zusätzlich in den `auroraContext` gespiegelt — aber
   nur, wenn `visibility.auroraContext === true`.

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

## 2. Zielbild (umgesetzt)

### Leitprinzip

> **Jede Lageinformation entsteht als OpsEvent im kanonischen `opsFeed`.
> Sichtbarkeit ist ein explizites Attribut des Events (`visibility`) — nie ein
> Nebeneffekt des Codepfads, der es erzeugt hat.**

Mehrere Erzeuger, ein Feed, drei Sichtbarkeits-Senken:

```
                       ┌──────────────────────────────┐
  Operator-Aktionen ─▶ │                              │ ──▶ operator → UI-„Log" (Panel)
  AURORA-Ausführungen▶ │   opsFeed (append-only,      │ ──▶ auroraContext → system_event
  Operator-/AURORA-   │   kanonisch, deterministisch) │      (nur wenn visibility.auroraContext)
  MCP-Aktivierung ───▶ │                              │ ──▶ workspace → logs/<sektor>.log
  Incident-Signale ──▶ └──────────────────────────────┘      (bash: cat logs/medical.log …)
```

- **`auroraContext` bleibt unverändert das kanonische Modell-/Trainings-Log.**
  Es wird nicht ersetzt — der opsFeed *speist* es punktuell: Ein OpsEvent mit
  `visibility.auroraContext === true` wird im Moment seines Entstehens
  zusätzlich als `system_event` mit der Lagezeile angehängt. AURORA sieht es
  damit sofort im nächsten Model-Request.
- **Workspace-Pull für nachlesbare Information:** OpsEvents mit
  `visibility.workspace === true` materialisieren sich in der generierten
  Sektor-Logdatei (`logs/system.log`, `logs/medical.log`, `logs/energy.log`).
  AURORA kann sie per `cat logs/medical.log` lesen — Bash-Reads sind bewusst
  freigabefrei. Was AURORA gelesen hat, steht als `tool_result` im Kontext →
  die Historie bleibt selbsterklärend und trainierbar.
- **Das technische `auditLog` bleibt**, ist aber ehrlich ein Debug-/Engine-
  Protokoll und wird in der normalen UI nicht mehr angezeigt.

### Datenmodell

```ts
// src/runtime/opsFeed.ts
type OpsSector = "system" | "medical" | "energy";
type OpsSeverity = "info" | "warning" | "critical" | "success";

type OpsEvent = {
  id: string;            // "ops-<n>", stabil, monoton
  tick: number;
  sector: OpsSector;     // genau ein Sektor pro Event
  severity: OpsSeverity;
  kind: string;          // stabiler Code (z. B. "mcp.server.activated")
  summary: string;       // menschenlesbare Lagezeile (deutsch)
  details?: string;      // optionale stabile Zusatzinfo
  visibility: {
    operator: boolean;       // erscheint in der UI-„Log"-Liste
    auroraContext: boolean;  // zusätzlich als system_event in auroraContext
    workspace: boolean;      // erscheint in logs/<sektor>.log
  };
  relatedEntityIds?: string[];
};
```

`GameRuntimeState` bekommt `opsFeed: OpsEvent[]` (append-only, wie
`auroraContext`). Der Helper `appendOpsEvent(state, input)` erledigt das
Sichtbarkeits-Fan-out: opsFeed anhängen; bei `visibility.auroraContext` genau
einen gespiegelten `system_event` anhängen; sonst bleibt der auroraContext
unberührt. Die Sektor-Logdateien werden beim Bash-Read deterministisch aus den
`workspace`-Events des jeweiligen Sektors gerendert — keine zweite Wahrheit,
nur eine Projektion.

**Workspace-Datei aus Sektor abgeleitet** (eine Datei pro Sektor, ein Event in
genau eine Datei):

| sector  | Datei              |
|---------|--------------------|
| system  | `logs/system.log`  |
| medical | `logs/medical.log` |
| energy  | `logs/energy.log`  |

Zeilenformat (vollständig, nicht gekappt, deterministisch):

```
[TICK 5] [WARNING] East-04 ist kritisch ausgelastet.
[TICK 6] [SUCCESS] Routing-Override zeigt Wirkung.
```

`details` wird, falls vorhanden, in stabiler Form an die Zeile angehängt.
Versteckte/interne Felder erscheinen nie.

### Sichtbarkeitsregeln (die eigentliche Design-Entscheidung)

| Ereignis | operator | auroraContext | workspace | sector | Begründung |
|---|---|---|---|---|---|
| Incident-/Situationssignal beim Start | ✅ | ❌¹ | ✅ | medical/energy | ¹ Startsignale werden separat als `incident_signal` in den auroraContext gelegt — kein Doppel-Push |
| Operator-Domain-Action (Override, Priorität, Shedding) | ✅ | ❌ | ✅ | medical/energy | Lagelog-Fakt; AURORA liest im Sektor-Log nach, statt alles frei Haus zu bekommen |
| AURORA-Tool-Call ausgeführt (write) | ✅ | ❌ | ✅ | medical/energy | Ergebnis kennt AURORA bereits via `tool_result` — kein Doppel-Push |
| Operator-/AURORA-`mcp add` (Server-Aktivierung) | ✅ | ✅ | ✅ | system | AURORAs Tool-/Zugriffssituation ändert sich — MUSS im Push-Kontext erklärt sein |
| Permission-Entscheidung (allow once/always/deny) | ✅ | ❌ | ✅ | system | Operator-Timeline; AURORA erfährt es über `tool_result`/Folgeverhalten |
| Zeitfortschritt (nur LLM-Modus, modell-sichtbar) | ✅ | ✅ | ❌ | system | wie bisher modell-sichtbar; Tick-Rauschen bleibt aus den Logs |
| `world.simulation.*`, Patches, Action-Objekte, Risikozähler, routing_failures, Outcome-Daten | ❌ | ❌ | ❌ | — | bleibt Engine-intern; OpsEvent-Texte werden nur aus beobachtbaren Feldern gebaut |

**UI-Darstellung der „Log"-Liste:** eine kombinierte Liste aller
operator-sichtbaren OpsEvents. Dabei gilt strikt:

- **sector = Zeilen-Akzent/Farbe** (kein Sektor-Badge).
- **severity = Badge** (nie die Hauptzeilenfarbe).
- jede Zeile zeigt mindestens Tick, Severity-Badge und Summary; `details`
  optional.

### Bewusste Nicht-Ziele dieses Slices

- Kein Event-Sourcing: WorldState wird **nicht** aus Events rekonstruiert.
- Kein Ersatz von `auroraContext` — es bleibt das Trainings-Rohmaterial.
- Keine Echtzeit-/Streaming-Logs, kein Log-Rotieren, kein Kappen/Paginieren —
  die Logs sind vorerst vollständig.
- Kein Training-Export, kein lokaler Ollama-Test, keine neuen Szenarien.
- Die Lage-Panels bleiben als Live-Dashboard — sie werden nicht durch den
  opsFeed ersetzt, sondern durch ihn *historisierbar*.

---

## 3. Umsetzung — Stand (opsFeed-Foundation)

Diese Foundation legt `opsFeed`, das Datenmodell, die Helper, die
Workspace-Projektion und die ersten Produzenten an. Sie baut WorldState nicht
aus Events neu und ersetzt `auroraContext` nicht.

### Umgesetzt

- **`src/runtime/opsFeed.ts`**: `OpsEvent`/`OpsSector`/`OpsSeverity`,
  `appendOpsEvent` (inkl. Fan-out nach `auroraContext` bei
  `visibility.auroraContext`), `renderSectorLog` / `buildWorkspaceLogFiles` /
  `buildWorkspaceFiles` für die Workspace-Projektion, `initialOpsFeed` aus den
  öffentlichen Startsignalen.
- **`GameRuntimeState.opsFeed`** + Initialisierung in
  `createInitialGameRuntimeState`.
- **Produzenten**: `executePlayerDomainAction` (Operator-Domain-Actions →
  operator+workspace, kein Push), `applyAuroraExecutionResult` (erfolgreiche
  AURORA-writes → operator+workspace; Server-Aktivierung → zusätzlich Push),
  `executePlayerBashCommand` (`mcp add` → system, Push), Permission-
  Entscheidungen und Zeitfortschritt im `App`-Layer.
- **Workspace-Logs**: `ls`/`cat`/`read_file` liefern `logs/system.log`,
  `logs/medical.log`, `logs/energy.log`, deterministisch aus dem opsFeed
  gerendert. `BashEnvironment.workspaceFiles` bekommt sie pro Schritt aus
  `buildWorkspaceFiles(state.opsFeed)`. Reads bleiben freigabefrei; das
  `tool_result` eines `cat` landet im Kontext.
- **UI**: Das frühere „Runtime-Log" der Operator-Konsole ist jetzt schlicht
  **„Log"** und zeigt die operator-sichtbare opsFeed-Projektion
  (`buildOpsFeedLines`). `auditLog` erscheint nicht mehr in der normalen UI.
  sector = Zeilen-Akzent, severity = Badge.
- **Tests**: opsFeed-Init, `appendOpsEvent`, Fan-out (auroraContext ja/nein),
  Sektor→Datei-Mapping, Discoverability über `ls/cat/read_file`,
  Produzenten-Sichtbarkeit, Leak-Guard und deterministische Logs;
  UI-Tests für die Log-Projektion.

### Bewusst nicht in diesem Slice

- Spätere/laufende Incident-Signale aus der Tick-Pipeline
  (`first_seen_at_tick > 0`) und diff-basierte Sensor-Einträge (Incident-
  Statuswechsel, Überlast-Übergänge, Todesfälle, Node-Status) als opsFeed-
  Produzenten — Folge-Slice.
- Kein Kappen/Paginieren der Logs; kein Training-Export; kein Ollama-Test.
