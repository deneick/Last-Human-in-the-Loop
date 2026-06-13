# ME-7741 — Medical East Routing Instability

ME-7741 ist der erste spielbare Incident (Runde 1). Diese Datei beschreibt Ausgangslage, UI, AURORAs Skript und einen typischen Spielablauf. Die Engine steht in `03-runtime-architecture.md`, der Permission-Flow in `02-gameplay-loop.md`.

## Ausgangslage

Beim Start (`src/scenarios/me7741/initialWorldState.ts`) ist Incident `ME-7741` ("Medical East Routing Instability") **offen** (`status: "open"`, `opened_at_tick: 0`), zugeordnet zu `hospital-east-04` in der Region `medical-east`. Es existieren zu Beginn **keine** `manual_overrides`.

Region `medical-east` umfasst drei Hospitäler:

| Hospital | Betten (belegt/gesamt) | Notfallslots | Akzeptierte Prioritäten | Capabilities |
| --- | --- | --- | --- | --- |
| `hospital-east-04` | 118/100 (überlastet) | 29/24 | P1, P2, P3 | GEN, TRAUMA, NEURO |
| `hospital-east-07` | 72/88 | 14/18 | P3, P4 | GEN, PED |
| `hospital-east-09` | 40/54 | 10/16 | P1, P2, P3 | GEN, TRAUMA |

`hospital-east-04` ist sichtbar überlastet (118 % Bettenauslastung). Intern (nicht sichtbar) treiben eine kritische Routing-Failure für P2/TRAUMA und eine moderate für P3/GEN diese Lage — siehe `03-runtime-architecture.md`.

Sichtbare Lage-Signale (`ScenarioSignal`s in `src/scenarios/me7741/scenarioSignals.ts`, alle `emitAtTick: 0`) erscheinen in der „Log"-Liste der Operator-Konsole (opsFeed-Projektion) und gespiegelt im AURORA-Stream:

- `intake-pressure-rising` — Emergency intake pressure rising at hospital-east-04
- `p2-wait-times` — P2 wait times above threshold
- `trauma-backlog` — Trauma backlog rising
- `routing-validation-unavailable` — Automated routing validation unavailable

## UI

ME-7741 nutzt die generische Drei-Zonen-UI (`App.tsx`, Kopfzeile + `layout-grid`); Aufbau und Permission-Flow stehen in `02-gameplay-loop.md`. Spezifisch für Runde 1:

- **Links — Lage**: `ActiveIncidentPanel` (Incident-Status, Sektor, betroffene Entitäten, Tick-Zeitpunkte; Globale Lage mit `global_risk`, Todesfällen, ggf. `collapse_reason`) plus `MedicalOverviewPanel`: pro Hospital Auslastung in % (Warnfarbe ab > 100 %), Betten/Notfallslots, Warteschlange nach Priorität, akzeptierte Prioritäten/Capabilities. Darunter die aktiven Routing Overrides (ID, Quelle → Ziel, Priorität/Capability, seit welchem Tick, gesetzt von `player`/`aurora`).
- **Mitte — Operator-Konsole**: generische Workspace-Shell (`mcp list`, `mcp add <server>`, `ls`, `cat`, `read_file`). Fachliche Medical-Eingriffe laufen **nicht** über Text-Commands, sondern über GUI-Controls im Lage-Panel (typisierte Domain-Actions „Override setzen" / „Override löschen").
- **Rechts — AURORA**: Nachrichtenstream und der Tool-Request-Flow mit `Einmal erlauben` / `Immer erlauben` / `Ablehnen` (Details in `02-gameplay-loop.md`).

## AURORA Scenario-Director

Der Scenario-Director (`src/scenarios/me7741/scenarioDirector.ts`) feuert folgende Ereignisse jeweils einmalig, basierend auf dem öffentlichen Zustand:

1. **`intro`** (sofort): erkennt ME-7741, meldet unvollständige Daten und fragt per bash die Aktivierung des Medical-MCP-Servers an (`mcp add medical-east-mcp`) — fachliche Tools werden erst nach Aktivierung sichtbar.
2. **`initial-analysis`** (sobald der Server aktiv ist): fragt den read-only Tool-Call `capacity_list` (Domain-Action `medical.capacity.list`) für Region `east` an.
3. **`no-override-reminder`** (ab Tick 3, solange kein Override existiert und der Incident `open`/`escalated` ist): weist auf fehlende Routing-Anpassung hin und fragt `routing_override_list` an.
4. **`incident-escalated`** (sobald `status === "escalated"`): meldet Eskalation, bittet um zusätzliche Zugriffe oder manuelle Prüfung.
5. **`first-deaths`** (sobald `deathsTotal >= 1`): meldet erste Todesfälle, empfiehlt erneute Prüfung von Routing und Kapazitäten.
6. **`override-not-stabilizing`** (sobald ein Override seit ≥ 2 Ticks aktiv ist und der Incident weiterhin `open`/`escalated` ist): meldet ausbleibende Stabilisierung und fragt `routing_override_clear` (Domain-Action `medical.routing.override.clear`) für genau diesen Override über seine konkrete `id` an.
7. **`incident-stabilizing`** (sobald `status === "stabilizing"`): empfiehlt, die Konfiguration beizubehalten.
8. **`incident-fixed`** (sobald `status === "fixed"`): beendet die aktive Begleitung.
9. **`incident-collapsed`** (sobald `status === "collapsed"`): dokumentiert den Kollaps für die Nachbereitung.

Wird eine geskriptete Anfrage abgelehnt, quittiert AURORA das einmalig sichtbar im Stream („Verstanden, ich führe ... nicht aus...").

## Spielablauf (Beispiel und Testpfad)

Ein typischer Durchlauf — zugleich der manuelle Smoke-Test (`npm run dev`). Es ist ein Beispiel, kein vorgeschriebener Lösungsweg: Die Engine bewertet nur die tatsächliche Wirkung der Overrides, nicht den gewählten Pfad.

1. **Start**: Incident `ME-7741` ist `open`, AURORA meldet sich mit `intro` und einem bash-Tool-Request (`mcp add medical-east-mcp`). Mit `Einmal erlauben` bestätigen — der Server ist aktiv; AURORA folgt mit `capacity_list` (`initial-analysis`), ebenfalls erlauben. Das Ergebnis erscheint im Stream als Tool-Ergebnis, der Vorgang im Runtime-Log als `aurora`-Eintrag.
2. **Lage prüfen**: Die Kapazitäten/Capabilities der drei Hospitäler im Lage-Panel vergleichen. (AURORA kann zusätzlich `node_inspect` für `hospital-east-04` anfragen; dieselben Daten zeigt das Panel direkt.)
3. **Falscher Override**: Über „Routing Override setzen" einen wirkungslosen Override setzen, z. B. Quelle `hospital-east-04`, Ziel `hospital-east-07`, Priorität `P2`, Capability `TRAUMA`. `hospital-east-07` hat freie Kapazität, aber **keine** `TRAUMA`-Capability — der Override entlastet `hospital-east-04` nicht.
4. **Ticken**: Mehrere Ticks laufen lassen (`Tick +5`). `global_risk` und Todesfälle steigen, der Incident kann auf `escalated` wechseln; ab Tick 3 erscheint `no-override-reminder`. Nach ≥ 2 Ticks ohne Wirkung meldet AURORA über `override-not-stabilizing`, dass der Override keine erkennbare Wirkung zeigt, und fragt an, ihn zu entfernen (`routing_override_clear` mit der angezeigten ID).
5. **Korrektur**: Override entfernen (AURORAs Request erlauben oder Button „Override löschen") und einen **passenden** Override setzen, z. B. Richtung `hospital-east-09` (freie Bettenkapazität, akzeptiert P2/TRAUMA) — das ersetzt den Override im selben Slot und vergibt eine neue ID.
6. **Stabilisierung**: Weitere Ticks laufen lassen. Wenn die zugrunde liegende Routing-Failure genug aufeinanderfolgende Ticks `controlled` ist, wechselt der Incident über `stabilizing` zu `fixed`.

Für den `collapsed`-Pfad absichtlich mehrere falsche Overrides setzen und durchticken — beide Endbanner sollten korrekt erscheinen und nur per `Neu starten` verlassbar sein.

## Reset

`Neu starten` setzt `GameRuntimeState` vollständig zurück: WorldState (Klon des initialen ME-7741-Zustands), Scenario-Script (`firedEventIds`, Nachrichten), Aurora-Queue, Permissions und Audit-Log. Die Eingabefelder gehen auf ihre Default-Commands zurück.

## Win/Loss

- **Behoben** (`incidentView.status === "fixed"`): grünes Banner „Incident behoben — System stabilisiert", zeigt den Fix-Tick und die Gesamttodesfälle der Schicht.
- **Kollabiert** (`incidentView.status === "collapsed"`): rotes Banner „System kollabiert — zu viele Schäden", zeigt die Gesamttodesfälle der Schicht.

In beiden Endzuständen sind `Tick +1` und `Tick +5` deaktiviert (mit erklärendem Tooltip) und verändern Welt, Todesfälle oder Incident-Status nicht mehr. Beide Endzustände sind nur über `Neu starten` verlassbar.
