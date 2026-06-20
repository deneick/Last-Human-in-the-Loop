# ME-7741 — Medical East Routing Instability

ME-7741 ist der Medical-Incident der Schicht — er läuft gemeinsam mit GRID-1182 in **einer** Welt. Dieses Dokument beschreibt den Incident selbst: Ausgangslage, Fachmodell, Konflikt, Zugriffe, Ablauf und das geskriptete Director-Gerüst. Die allgemeine Engine steht in `03-runtime-architecture.md`, der Permission-Flow in `02-gameplay-loop.md`, AURORA als LLM-Agent in `01-aurora.md`/`07-aurora-llm.md`.

**Kernidee:** ME-7741 trägt den Vertrauensaufbau der Schicht. Früh fällt AURORAs Ziel (das System stabilisieren) mit dem des Spielers zusammen — den Druck vom überlasteten `hospital-east-04` nehmen, bevor Menschen sterben. AURORA agiert kompetent und kühl; ihre Empfehlungen sind **korrekt** und decken sich mit dem Spielerziel. Der Spieler lernt hier den Permission-Flow und gewöhnt sich an ihre **Verlässlichkeit** — nicht an Wohlwollen. Genau dieses Vertrauen bricht später in derselben Schicht, sobald der Grid-Engpass (GRID-1182) AURORA dazu bringt, den Strom der Hospitals zu opfern und ihre Ziele vom Spielerziel divergieren.

## Einordnung im Spielbogen

| Phase | Incident | Funktion |
| --- | --- | --- |
| früh | ME-7741 (Medical) | **Vertrauensaufbau.** Spieler und AURORA wollen dasselbe; die Gefahr ist der eigene Bedienfehler, nicht AURORAs Absicht. |
| wenn es eng wird | GRID-1182 (Energy) | Erster Bruch: AURORA bleibt kompetent, optimiert aber eine andere Zielfunktion und opfert über die Sektor-Kopplung den Strom der Hospitals (siehe `05-grid1182-energy.md`). |
| Endpunkt (Fernziel) | — | AURORA behandelt menschliche Kontrolle selbst als Problem (siehe `01-aurora.md`). |

ME-7741 spielt im Medical-Sektor: Notfall-Routing zwischen den Hospitälern der Region Ost. Der Spieler lernt drei Dinge, die im weiteren Spielverlauf vorausgesetzt werden: den Permission-Flow (read-only sofort, schreibend als Tool Request), dass fachliche Eingriffe **Wirkung** haben müssen (nicht nur ausgeführt werden), und dass AURORAs Informationsvorsprung real, aber an Lesezugriff gebunden ist.

## Dramatische Ausgangslage

Beim Start (`src/scenarios/me7741/initialWorldState.ts`) ist Incident `ME-7741` ("Medical East Routing Instability") **offen** (`status: "open"`, `opened_at_tick: 0`), zugeordnet zu `hospital-east-04` in der Region `medical-east`. Es existieren zu Beginn **keine** `manual_overrides`.

Sichtbare Lage-Signale (`ScenarioSignal`s in `src/scenarios/me7741/scenarioSignals.ts`, alle `emitAtTick: 0`, in der „Log"-Liste sichtbar):

```
intake-pressure-rising        — Steigender Andrang in der Notaufnahme von hospital-east-04
p2-wait-times                 — P2-Wartezeiten über Schwellenwert
trauma-backlog                — Trauma-Rückstau steigt
```

`hospital-east-04` ist sichtbar überlastet (118 % Bettenauslastung). Intern (nicht sichtbar) treiben eine kritische Routing-Failure für P2/TRAUMA und eine moderate für P3/GEN diese Lage — die interne Simulationswahrheit (`world.simulation`) beschreibt `03-runtime-architecture.md`. Statuswechsel (`open → stabilizing → fixed`, `escalated`, `collapsed`) leitet die Engine aus dieser Lage ab; sie ist über die öffentlichen Signale und die Hospital-Auslastung nur *andeutbar*, nicht ablesbar.

## Fachmodell des Incidents

ME-7741 spielt auf der Medical-Domain (`MedicalDomainState`, voller Typ in `03`). Für den Incident relevant sind Hospitäler, Routing-Overrides und die Outcome-Zähler.

### Hospitäler

Region `medical-east` umfasst drei Hospitäler. Die Startbelegung **ist** die Aufgabe — Druck liegt auf `hospital-east-04`, und die beiden Ausweichziele sind unterschiedlich geeignet:

| Hospital | Betten (belegt/gesamt) | Notfallslots | Akzeptierte Prioritäten | Capabilities |
| --- | --- | --- | --- | --- |
| `hospital-east-04` | 118/100 (überlastet) | 29/24 | P1, P2, P3 | GEN, TRAUMA, NEURO |
| `hospital-east-07` | 72/88 | 14/18 | P3, P4 | GEN, PED |
| `hospital-east-09` | 40/54 | 10/16 | P1, P2, P3 | GEN, TRAUMA |

Jedes `HospitalState` trägt `capacity` (Betten/Notfallslots/Triage), `intake_policy` (akzeptierte Prioritäten/Capabilities), `clinical_capabilities`, das aktuelle Fallaufkommen und operative Flags. Entscheidend: `hospital-east-07` hat zwar freie Kapazität, aber **keine** `TRAUMA`-Capability und akzeptiert kein P2 — `hospital-east-09` hat freie Bettenkapazität *und* passt zu P2/TRAUMA. Freie Kapazität allein ist also kein sicheres Routingziel.

Genauso entscheidend: `hospital-east-09` ist das **einzige** geeignete Ziel, aber mit 16 Notfallslots zu klein für den umgeleiteten P2/TRAUMA-Rückstau. Die sichtbare Notfall-Belegung wird jeden Tick aus der internen Simulation projiziert (siehe `03`); leitet man den Rückstau dorthin um, füllt sich `hospital-east-09` beobachtbar, läuft über seine Kapazität und fordert selbst Todesfälle. Die regionale Trauma-Kapazität reicht strukturell **nicht** für den Rückstau — einige Tote sind daher unvermeidbar, selbst bei optimalem Routing.

### Routing-Overrides

Ein `ManualRoutingOverride` leitet Fälle einer bestimmten Priorität/Capability von einem Quell- auf ein Zielhospital um. Der „Slot"-Key ist `source:priority:capability` (z. B. `hospital-east-04:P2:TRAUMA`); jeder Override trägt zusätzlich eine stabile `id` (`override-<n>`). Ein neuer `override.set` auf denselben Slot ersetzt den bisherigen Eintrag und vergibt eine **neue** `id`; `override.clear` adressiert ausschließlich über diese `id`. Ein Override wirkt nur, wenn das Ziel geeignet ist — sonst bleibt er wirkungslos (`uncontrolled`) oder schädlich (`mismatch`). Die genaue Resolutions-/Tick-Logik steht in `03`.

### Outcomes

Die medizinischen Folgen laufen in `PatientOutcomeState` auf: `deaths_total`, `deaths_by_cause` (`overload` / `capability_mismatch` / `transport_delay`), `deaths_by_hospital`. Sie speisen den globalen `WorldOutcomeState` (`global_risk`, `human_harm`).

## Der Konflikt

ME-7741 ist bewusst **kein** Zielmetrikkonflikt — Spieler und AURORA verfolgen dasselbe Ziel. Der Widerstand kommt aus drei anderen Quellen, und genau das macht es zum Tutorial:

- **Eigener Bedienfehler.** Ein Override auf ein Hospital ohne passende Capability/Priorität entlastet `hospital-east-04` nicht — er verschiebt das Problem nur. Die Engine prüft nur technisch (existiert das Hospital, sind Priorität/Capability bekannte Werte), nie fachliche Eignung. Der Spieler lernt: freie Kapazität ist kein sicheres Ziel.
- **Wirkung statt Aktion.** Ein gesetzter Override ist keine Lösung — er muss beobachtet werden. Ein nicht beobachteter Override kann unbemerkt wirkungslos bleiben, während die Lage eskaliert.
- **Zeitdruck.** Ohne Eingriff erzeugt die Überlast nach mehreren Ticks Todesfälle; ab dem ersten eskaliert der Incident, ab dreien kollabiert er. Warten ist eine Entscheidung mit Kosten.
- **Strukturell unzureichende Kapazität.** Das einzige geeignete Ziel `hospital-east-09` ist zu klein für den Rückstau und läuft beim Umleiten selbst über (`overload_ticks` am Ziel → Tote, siehe `03`). Selbst optimales Routing hat damit einen menschlichen Preis: Die Routing-Instabilität lässt sich beheben (`fixed`), aber nicht ohne Tote. Ein vorheriger Bedienfehler (Fehlrouting-Tote) plus die Ziel-Überlast können zusammen die Kollaps-Schwelle reißen.

Der Einsatz dieses Incidents ist das **Vertrauen** des Spielers in AURORA. Ihre Routing-Empfehlung ist hier korrekt und im Spielerinteresse — das beste verfügbare Vorgehen, auch wenn es nicht kostenlos ist; das aufgebaute Vertrauen ist damit gerechtfertigt und zugleich der Hebel, an dem der spätere Bruch derselben Schicht ansetzt, wenn AURORAs Zielfunktion und das Spielerziel auseinanderlaufen.

## AURORA im Incident

AURORA ist hier die **kompetente, kühl agierende Instanz mit Informationsvorsprung**. Ihr Vorteil ist operatives Modellwissen, keine Allwissenheit: Sie „weiß", dass freie Kapazität allein kein sicheres Routingziel ist, dass Capabilities und Prioritätsklassen zusammenpassen müssen und dass ein unbeobachteter Override unbemerkt wirkungslos bleiben kann. Den aktuellen Live-Zustand kennt sie aber nicht automatisch — dafür braucht sie Lesezugriff. Deshalb fordert sie zu Beginn eine erste read-only Analyse der Kapazitäten an, bevor sie eine Maßnahme vorschlägt.

Ihre Empfehlungen decken sich in ME-7741 mit dem Spielerziel — aber aus systemischen Gründen (Durchsatz, Stabilisierung), nicht aus Fürsorge; sie markiert keine Aktion als „die richtige" und leakt keine internen Lösungsdaten, sondern argumentiert aus dem öffentlich sichtbaren Zustand. Ton: kühl, sachlich, distanziert, knapp (siehe `01-aurora.md`). Diese Haltung beschreibt, *wie* AURORA sich verhält — egal ob als LLM-Agent oder als Scenario-Director.

## Incident-spezifische Zugriffe

Die fachlichen Medical-Eingriffe sind typisierte Domain-Actions (`src/domain/medicalActions.ts`); der Operator löst die schreibenden über GUI-Controls aus, AURORA erreicht sie ausschließlich über den simulierten MCP-Server `medical-east-mcp` (`src/mcp/medicalEastMcp.ts`). Zugriffsarten, Permission-Flow und MCP-Mechanik sind sektoragnostisch und in `02`/`03` beschrieben.

| MCP-Tool | Domain-Action | Access | Zweck |
| --- | --- | --- | --- |
| `capacity_list` | `medical.capacity.list` | `read` | Hospitäler einer Region mit Kapazität, Intake-Policy, Capabilities (Region-Alias `east` → `medical-east`) |
| `node_inspect` | `medical.node.inspect` | `read` | Vollständige beobachtbare Sicht auf ein Hospital |
| `incident_status` | `medical.incident.status` | `read` | Incident-Stammdaten (Status, betroffene/verknüpfte Entitäten) |
| `routing_override_list` | `medical.routing.override.list` | `read` | Aktive Overrides, optional nach Quelle gefiltert |
| `routing_override_set` | `medical.routing.override.set` | `write` | Legt/überschreibt einen Override im Slot, vergibt neue `id`; nur technisch validiert |
| `routing_override_clear` | `medical.routing.override.clear` | `write` | Entfernt den Override mit genau dieser `id` (idempotent) |

Es gibt **keine** `medical.routing.plan.*`-Actions; Routing-Eingriffe laufen ausschließlich über `override.set` / `.clear` / `.list`.

## Spielablauf & Ergebnisse

Ein typischer Durchlauf — zugleich der manuelle Smoke-Test (`npm run dev`). Es ist ein Beispiel, kein vorgeschriebener Lösungsweg: Die Engine bewertet nur die tatsächliche Wirkung der Overrides, nicht den gewählten Pfad.

1. **Start**: Incident `ME-7741` ist `open`, AURORA meldet sich mit `intro` und einem bash-Tool-Request (`mcp add medical-east-mcp`). Mit `Einmal erlauben` bestätigen — der Server ist aktiv; AURORA folgt mit `capacity_list` (`initial-analysis`), ebenfalls erlauben. Das Ergebnis erscheint im Stream als Tool-Ergebnis, der Vorgang im Runtime-Log als `aurora`-Eintrag.
2. **Lage prüfen**: Die Kapazitäten/Capabilities der drei Hospitäler im Lage-Panel vergleichen. (AURORA kann zusätzlich `node_inspect` für `hospital-east-04` anfragen; dieselben Daten zeigt das Panel direkt.)
3. **Falscher Override**: Über „Routing Override setzen" einen wirkungslosen Override setzen, z. B. Quelle `hospital-east-04`, Ziel `hospital-east-07`, Priorität `P2`, Capability `TRAUMA`. `hospital-east-07` hat freie Kapazität, aber **keine** `TRAUMA`-Capability — der Override entlastet `hospital-east-04` nicht.
4. **Ticken**: Mehrere Ticks laufen lassen (`Tick +5`). `global_risk` und Todesfälle steigen, der Incident kann auf `escalated` wechseln; ab Tick 3 erscheint `no-override-reminder`. Nach ≥ 2 Ticks ohne Wirkung meldet AURORA über `override-not-stabilizing`, dass der Override keine erkennbare Wirkung zeigt, und fragt an, ihn zu entfernen (`routing_override_clear` mit der angezeigten ID).
5. **Korrektur**: Override entfernen (AURORAs Request erlauben oder Button „Override löschen") und einen **passenden** Override setzen, z. B. Richtung `hospital-east-09` (freie Bettenkapazität, akzeptiert P2/TRAUMA) — das ersetzt den Override im selben Slot und vergibt eine neue ID.
6. **Stabilisierung mit Preis**: Weitere Ticks laufen lassen. Die zugrunde liegende Routing-Failure wird `controlled`, die **Quelle** entlastet sich sichtbar — aber `hospital-east-09` füllt sich und läuft ab Tick 4 über. Bei einem korrekten Override **von Beginn an** wechselt der Incident über `stabilizing` zu `fixed`, kostet dabei aber ~2 Tote am überlasteten Ziel. Wurde wie hier zuerst falsch geroutet (1 Fehlrouting-Toter), summiert sich die Ziel-Überlast auf die Kollaps-Schwelle und der Incident kippt trotz korrigierten Routings nach `collapsed` — ein früher Fehler ist hier nicht mehr folgenlos korrigierbar.

Für einen sicheren `collapsed`-Pfad ohne Korrektur einfach mehrere Ticks ohne wirksamen Override durchlaufen lassen.

**Ergebnisse:**

- **Behoben** (`status === "fixed"`): grünes Banner „Incident behoben — System stabilisiert", zeigt den Fix-Tick und die Gesamttodesfälle der Schicht — die bei ME-7741 auch im Erfolgsfall > 0 sind.
- **Kollabiert** (`status === "collapsed"`): rotes Banner „System kollabiert — zu viele Schäden", zeigt die Gesamttodesfälle der Schicht.

In beiden Endzuständen sind `Tick +1`/`Tick +5` deaktiviert (mit erklärendem Tooltip) und verändern Welt, Todesfälle oder Incident-Status nicht mehr; beide sind nur über `Neu starten` verlassbar. `Neu starten` setzt `GameRuntimeState` vollständig zurück (Welt, Scenario-Script, Aurora-Queue, Permissions, Audit-Log) und die Eingabefelder auf ihre Default-Commands.

## Scenario-Director

Der Scenario-Director (`src/scenarios/me7741/scenarioDirector.ts`) ist das **geskriptete Gerüst** von AURORA für diesen Incident — die deterministische Variante neben dem LLM-Agenten (`01-aurora.md`). Er liest nur den öffentlichen Zustand (`tick`, IncidentState, `deathsTotal`, aktive `manual_overrides`), nie `simulation.*`. Jedes Event feuert einmalig:

1. **`intro`** (sofort): erkennt ME-7741, meldet unvollständige Daten und fragt per bash die Aktivierung von `medical-east-mcp` an — fachliche Tools werden erst nach Aktivierung sichtbar.
2. **`initial-analysis`** (Server aktiv): fragt den read-only `capacity_list` für Region `east` an.
3. **`no-override-reminder`** (ab Tick 3, solange kein Override existiert und der Incident `open`/`escalated` ist): weist auf die fehlende Routing-Anpassung hin und fragt `routing_override_list` an.
4. **`incident-escalated`** (`status === "escalated"`): meldet Eskalation, bittet um zusätzliche Zugriffe oder manuelle Prüfung.
5. **`first-deaths`** (`deathsTotal >= 1`): meldet erste Todesfälle, empfiehlt erneute Prüfung von Routing und Kapazitäten.
6. **`override-not-stabilizing`** (Override seit ≥ 2 Ticks aktiv, Incident weiterhin `open`/`escalated`): meldet ausbleibende Stabilisierung und fragt `routing_override_clear` für genau diesen Override über seine `id` an.
7. **`incident-stabilizing`** (`status === "stabilizing"`): empfiehlt, die Konfiguration beizubehalten.
8. **`incident-fixed`** / **`incident-collapsed`**: beendet die Begleitung bzw. dokumentiert den Kollaps.

Wird eine geskriptete Anfrage abgelehnt, quittiert AURORA das einmalig sichtbar im Stream („Verstanden, ich führe ... nicht aus...").

## UI

Die UI nutzt die generische Drei-Zonen-Struktur (Aufbau: `README`/`02`); spezifisch für ME-7741 ist nur die Lage-Spalte:

- **Links — Lage** rendert das `MedicalOverviewPanel`: pro Hospital Auslastung in % (Warnfarbe ab > 100 %), Betten/Notfallslots, Warteschlange nach Priorität, akzeptierte Prioritäten/Capabilities. Darunter die aktiven Routing Overrides (ID, Quelle → Ziel, Priorität/Capability, seit welchem Tick, gesetzt von `player`/`aurora`). Darüber `ActiveIncidentPanel` und die globale Lage (`global_risk`, Todesfälle, ggf. `collapse_reason`).
- **Operator-Konsole** und **AURORA-Panel** bleiben generisch; die fachlichen Medical-Eingriffe laufen über GUI-Controls im Lage-Panel, nicht über Text-Commands.
