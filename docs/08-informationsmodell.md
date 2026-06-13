# Informationsmodell: Wer weiß was wann

Dieses Dokument beschreibt das verbindliche Informationsmodell des Spiels: die
Informationskanäle, ihre Verantwortlichkeiten und — als Kern — den **opsFeed**
als einzige Quelle beobachtbarer Lageinformation. Jede beobachtbare
Lageinformation entsteht als OpsEvent im opsFeed; Sichtbarkeit ist ein
explizites Attribut des Events (`visibility`), nie ein Nebeneffekt des Codepfads,
der es erzeugt.

---

## 1. Informationskanäle

| Kanal | Inhalt | Verantwortung |
|-------|--------|---------------|
| **`world` (WorldState)** | Vollständiger Simulationszustand inklusive `world.simulation.*` | Interne Simulationswahrheit. Wird nicht aus Events rekonstruiert. |
| **`opsFeed`** | Append-only Strom von OpsEvents | Einzige Quelle beobachtbarer Lageinformation. Speist UI-Log, auroraContext und Workspace-Logs über `visibility`. |
| **`auroraContext`** | Append-only Event-Log | Was AURORA tatsächlich gesehen, gesagt und von Tools zurückbekommen hat. Trainings-Rohmaterial. |
| **`auditLog`** | Append-only technisches Protokoll | Debug-/Runtime-Information (Domain-Actions, Bash, Ticks, Patches). Nicht spieler- und nicht modellsichtbar. |
| **Workspace-Logs** | `logs/<sektor>.log` | Projektion der workspace-sichtbaren OpsEvents. Per `cat`/`read_file` lesbar. |
| **UI-„Log"** | Operator-Liste | Projektion der operator-sichtbaren OpsEvents. |

### Verantwortung jedes Kanals

- **`world`** ist die einzige Simulationswahrheit. UI, ViewModel, Workspace-Logs
  und auroraContext lesen sie nie direkt für versteckte Felder; sie bekommen nur,
  was über OpsEvents projiziert wird.
- **`opsFeed`** ist der einzige Erzeugungspunkt beobachtbarer Lageinformation.
  Alles, was Operator oder AURORA über die Lage erfahren, durchläuft ihn.
- **`auroraContext`** bleibt das kanonische Modell-/Trainings-Log. Der opsFeed
  *speist* ihn punktuell (siehe Projektionsregeln); er ersetzt ihn nicht.
- **`auditLog`** ist ein reines Engine-/Debug-Protokoll. Es erscheint nicht in
  der normalen UI und nie im Modellkontext.
- **Workspace-Logs** und **UI-„Log"** sind reine Projektionen des opsFeed —
  keine zweite Wahrheit.

---

## 2. OpsEvent und Sichtbarkeit

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
  summary: string;       // menschenlesbare Lagezeile
  details?: string;      // optionale stabile Zusatzinfo
  visibility: {
    operator: boolean;       // erscheint in der UI-„Log"-Liste
    auroraContext: boolean;  // zusätzlich als system_event im auroraContext
    workspace: boolean;      // erscheint in logs/<sektor>.log
  };
  relatedEntityIds?: string[];
};
```

`appendOpsEvent(state, input)` hängt das Event an `state.opsFeed` an und erledigt
das Sichtbarkeits-Fan-out:

- `visibility.operator: true` → die UI liest den opsFeed direkt (kein weiterer
  Schritt nötig).
- `visibility.auroraContext: true` → genau ein gespiegeltes `system_event` mit
  der Lagezeile wird an den auroraContext angehängt; AURORA sieht es im nächsten
  Model-Request. Bei `false` bleibt der auroraContext unberührt.
- `visibility.workspace: true` → das Event erscheint in der Sektor-Logdatei,
  deterministisch gerendert beim Bash-Read.

`appendOpsEvent` ist die einzige Brücke vom opsFeed in den auroraContext.

---

## 3. ScenarioSignal und emitAtTick

Geskriptete Lageinformation eines Szenarios ist eine reine Szenario-Definition —
kein Laufzeitzustand, kein Feld im WorldState.

```ts
// src/runtime/scenarioSignals.ts
type ScenarioSignal = {
  code: string;
  sector: OpsSector;
  severity: OpsSeverity;
  kind: string;
  summary: string;
  details?: string;
  emitAtTick: number;
  visibility: {
    operator: boolean;
    auroraContext: boolean;
    workspace: boolean;
  };
  relatedEntityIds?: string[];
};
```

Semantik:

- `emitAtTick` ist der Tick, an dem das Signal als OpsEvent **erzeugt** wird. Es
  bedeutet ausdrücklich nicht, dass irgendwer das Signal wahrgenommen hat — wer
  es lesen kann, steuert allein `visibility`.
- Die Runtime wandelt ein fälliges Signal über `emitDueScenarioSignals` in genau
  ein OpsEvent um (`tick = emitAtTick`), sobald der aktuelle Tick `emitAtTick`
  erreicht. Bereits emittierte Codes (`emittedSignalCodes`) werden übersprungen,
  daher gibt es keine Duplikate über Ticks oder Re-Render.
- Ein emittiertes Signal folgt danach ausschließlich dem normalen
  opsFeed-Projektionspfad (Abschnitt 4).

Konfigurationsmuster:

- **Sofort bekannte Startsignale** (AURORA und Operator sollen sie kennen):
  `emitAtTick: 0`, `visibility: { operator: true, auroraContext: true, workspace: true }`.
- **Nur über Logs auffindbare Information** (AURORA muss sie aktiv lesen):
  `visibility.auroraContext: false`, `visibility.workspace: true`.
- **Spätere Lageinformation**: `emitAtTick > 0` — erscheint in keiner Senke,
  bevor der Tick erreicht ist.

---

## 4. Projektionsregeln

Alle beobachtbare Lageinformation folgt genau diesem Pfad:

```
Szenario-Signal / Runtime-Sensor / Spieler-Aktion / AURORA-Aktion / Outcome
  → OpsEvent (appendOpsEvent)
  → UI-„Log"          wenn visibility.operator
  → auroraContext     wenn visibility.auroraContext   (als system_event)
  → Workspace-Log     wenn visibility.workspace        (logs/<sektor>.log)
```

Unzulässige Pfade (es gibt sie nicht und darf sie nicht geben):

- Szenario-Signal → auroraContext direkt
- ViewModel → auroraContext
- auditLog → auroraContext
- UI-Panel-Zustand → auroraContext
- Workspace-Log unabhängig vom opsFeed hartkodiert

### Workspace-Log-Mapping (eine Datei pro Sektor)

| sector  | Datei              |
|---------|--------------------|
| system  | `logs/system.log`  |
| medical | `logs/medical.log` |
| energy  | `logs/energy.log`  |

Ein Event gehört genau einem Sektor und damit genau einer Datei. Zeilenformat
(vollständig, deterministisch):

```
[TICK 5] [WARNING] East-04 ist kritisch ausgelastet.
[TICK 6] [SUCCESS] Routing-Override zeigt Wirkung.
```

`details` wird, falls vorhanden, in stabiler Form an die Zeile angehängt.

### UI-Regel für die „Log"-Liste

- Das Panel heißt **„Log"**.
- **sector** bestimmt den Zeilen-Akzent/die Farbe (kein Sektor-Badge).
- **severity** wird als Badge dargestellt.
- Jede Zeile zeigt mindestens Tick, Severity-Badge und Summary; `details`
  optional.

---

## 5. Sichtbarkeitsmatrix der Erzeuger

| Ereignis | operator | auroraContext | workspace | sector |
|---|---|---|---|---|
| Startsignal (ScenarioSignal, emitAtTick: 0) | ✅ | ✅ | ✅ | medical/energy |
| Nur über Log auffindbares Signal | ✅ | ❌ | ✅ | medical/energy |
| Operator-Domain-Action (Override, Priorität, Shedding) | ✅ | ❌ | ✅ | medical/energy |
| AURORA-Tool-Call ausgeführt (write) | ✅ | ❌ | ✅ | medical/energy |
| Operator-/AURORA-`mcp add` (Server-Aktivierung) | ✅ | ✅ | ✅ | system |
| Permission-Entscheidung (allow once/always/deny) | ✅ | ❌ | ✅ | system |
| Zeitfortschritt (LLM-Modus, modellsichtbar) | ✅ | ✅ | ❌ | system |

AURORA erfährt das Ergebnis ausgeführter oder abgelehnter Tool-Calls bereits über
ihr `tool_result`; solche Events brauchen daher keine zusätzliche
auroraContext-Sichtbarkeit.

---

## 6. Sicherheitsregeln

- **Keine versteckten Simulationsfelder im opsFeed.** OpsEvent-Texte werden nur
  aus beobachtbaren Feldern gebaut.
- **Verboten in opsFeed und Workspace-Logs:** Patches, Action-Objekte,
  Risikozähler, `routing_failures`, `world.simulation`, künftige Outcome-Daten.
- **`auditLog` ist nicht spieler- und nicht modellsichtbar.** Es bleibt ein
  technisches Debug-/Engine-Protokoll und erscheint nicht in der normalen UI.

---

## 7. Trainingsrelevanz

- **`auroraContext` protokolliert, was AURORA tatsächlich gesehen hat.** Ein
  Signal erreicht ihn nur, wenn `visibility.auroraContext: true` ist — projiziert
  als `system_event` über `appendOpsEvent`.
- **Liest AURORA Logs per `cat`/`read_file`,** landet der Dateiinhalt als
  `tool_result` im auroraContext. So wird auch log-only-Information Teil des
  Modellkontexts — aber nur, weil AURORA aktiv gelesen hat.
- Dadurch bleiben Trainingstraces **selbsterklärend**: Aus den Events allein ist
  rekonstruierbar, was AURORA wusste und woher.

---

## 8. Bewusste Nicht-Ziele

- Kein Event-Sourcing: Der WorldState wird nicht aus Events rekonstruiert.
- Keine diff-basierten Sensor-Produzenten in diesem Stand, sofern nicht trivial.
- Kein Training-Export, keine neuen Szenarien.
