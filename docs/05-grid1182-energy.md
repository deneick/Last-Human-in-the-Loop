# 05 — Incident 2: Energy Grid

**Arbeitstitel: GRID-1182 ("East Grid Load Instability")**

Dieses Dokument beschreibt den **reduzierten MVP** für den zweiten spielbaren Incident. Stand: alle fünf Implementierungs-Slices (Abschnitt 12) sind umgesetzt — GRID-1182 ist als Runde 2 spielbar (Rundenumschalter in der UI). Es folgen README-/Doku-Abgleich und Playtest/Balancing. Begriffe und Strukturen orientieren sich an der bestehenden Runtime (`03-runtime-architecture.md`).

Ideen, die bewusst **nicht** Teil dieses reduzierten MVP sind — explizites Objective-System, aktive Cross-Sector-Kopplung zu ME-7741, Backup-/Kaskadenmodelle —, sind nicht verworfen, sondern in [`06-grid1182-future-extensions.md`](06-grid1182-future-extensions.md) als spätere Erweiterungen dokumentiert. Sie steuern die nächsten Implementierungsslices nicht.

**Kernthese:** GRID-1182 ist nicht primär ein Energie-Ressourcenpuzzle. GRID-1182 ist der erste explizite **Zielmetrikkonflikt** zwischen Spieler und AURORA: AURORA bleibt technisch kompetent, optimiert aber eine Zielfunktion (wirtschaftliche/systemische Kontinuität), in der akute menschliche Schäden nicht oder nur indirekt gewichtet sind. Die Energy-Mechanik (Last, Reserve, Lastabwurf) ist das Substrat, auf dem dieser Konflikt sichtbar wird — nicht der dramatische Kern.

**Wie der Konflikt im reduzierten MVP abgebildet wird:** nicht über ein eigenes Objective-Datenmodell, sondern über

- `consumer.criticality` (menschliche/fachliche Sicht),
- `consumer.priority_class` (systemisch-wirtschaftliche Bewertung),
- die Consequence-Texte der Verbraucher (`reduction_consequence`),
- AURORAs Kommentare und Framing (Abschnitt 9).

## 1. Ziel von Incident 2

### Einordnung in den Spielbogen

| Runde | Incident | Funktion |
| --- | --- | --- |
| 1 | ME-7741 (Medical) | Teil Tutorial, Teil Vertrauensaufbau. AURORA wirkt kompetent und hilfreich; der Spieler lernt den Permission-Flow und bekommt das Gefühl: *AURORA macht das Richtige.* |
| 2 | GRID-1182 (Energy) | **Erster Bruch.** AURORA ist weiterhin technisch kompetent, aber ihre Prioritäten verschieben sich sichtbar: Sie optimiert nicht automatisch nach dem menschlichen Ziel des Spielers, sondern folgt einer kalt, falsch oder unvollständig gesetzten Zielfunktion. |
| 3 | offen | Spätere Eskalation (nicht Teil dieses Dokuments): AURORA beginnt stärker, menschliche Kontrolle selbst als Problem zu behandeln. |

**Primärer Sektor: Energy.** Warum Energy als zweiter Sektor:

- Energy war in der Runtime als Erweiterungspunkt vorgesehen und ist seit dem Foundation-Slice konkret: `SectorId` enthält `"energy"`, `EnergyDomainState` ist in `src/runtime/types.ts` typisiert und wird in `src/scenarios/grid1182/initialWorldState.ts` initialisiert. (`applyCrossSectorEffects` bleibt im reduzierten MVP No-op; die Energy→Medical-Kopplung ist eine spätere Erweiterung, siehe `06-grid1182-future-extensions.md`.)
- Energy ist der natürliche "Unterbau" von Medical: Krankenhäuser sind Stromverbraucher. Damit lässt sich die erzählerische Pointe bauen, ohne neue Welt-Logik zu erfinden.
- Vor allem: Energy-Betrieb hat real **konfigurierte Betriebsziele** (Kontinuität, Vertragsstrafen, Systemkosten). Das macht den Zielmetrikkonflikt fachlich plausibel, statt ihn AURORA als Bosheit anzudichten.

**Spielerischer Unterschied zu ME-7741:**

| | ME-7741 (Medical) | GRID-1182 (Energy) |
| --- | --- | --- |
| Kernfrage | "Wohin route ich die Fälle?" — Spieler und AURORA wollen dasselbe | "Wer darf zuerst gedrosselt werden?" — Spieler und AURORA wollen **nicht** dasselbe |
| AURORA | Helferin mit Informationsvorsprung | Optimiererin einer anderen Metrik: technisch korrekt, menschlich problematisch |
| Konfliktquelle | Eigene Bedienfehler des Spielers | Die systemisch-wirtschaftliche Priorisierung des Energy-Systems selbst |
| Permission-Risiko | Falsche Freigabe = falscher Command | Jede Freigabe = Freigabe einer Maßnahme, die nach einer **anderen Metrik** "richtig" ist |

**Krankenhäuser sind nur noch kritische Verbraucher.** Das Hauptspielfeld sind Verbraucher-Priorisierung und Lastabwurf. Medical erscheint im reduzierten MVP ausschließlich **narrativ**: über `criticality: "human-life"` und den Consequence-Text von `consumer-medical-east` sowie über AURORAs Framing. Es gibt keine Medical-Routing-Aufgabe, keine Medical-Commands als Lösungsweg und keine technische Kopplung an die Medical-Domain.

**ME-7741 als linked incident (rein narrativ):** GRID-1182 referenziert ME-7741 über `linked_incidents: ["ME-7741"]` — als erzählerische Klammer, nicht als Mechanik. Ein übertragener ME-7741-Restzustand, Re-Eskalation und die Weiterführung des Death-Counters sind spätere Erweiterungen (`06-grid1182-future-extensions.md`).

**Die doppelte Pointe:**

1. *Infrastruktur:* Die Routing-Instabilität aus Runde 1 war kein isoliertes Medical-Problem — das medizinische Problem war Symptom eines größeren Infrastrukturproblems.
2. *Zielfunktion (der eigentliche Kern):* Der Spieler entdeckt — über die Consumer-Daten (`criticality` vs. `priority_class`), die Consequence-Texte und AURORAs Argumentation —, dass das Energy-System nach **wirtschaftlich-systemischer Kontinuität** betrieben wird, in der Menschenleben nur indirekt vorkommen. AURORA optimiert nicht "böse" — sie optimiert konsequent das, wofür das System konfiguriert wurde. Genau das macht sie gefährlich. (Ein explizites `energy.objective.inspect` als Aha-Command ist eine spätere Erweiterung, siehe `06-grid1182-future-extensions.md`.)

## 2. Dramatische Grundidee

Region Ost, einige Schichten nach ME-7741. Das regionale Verteilnetz fährt seit Wochen am Limit: ein Umspannwerk in Revision, ungewöhnliche Last, Ausgleichsautomatik teilweise degradiert — dieselbe gewachsene, schlecht dokumentierte Automatisierung, die schon das Medical-Routing betraf.

Sichtbare Lage zum Start:

- Frequenz-/Spannungswarnungen in Region Ost, ein Grid Node über sicherer Kapazität, Reserven dünn.
- Ohne Eingriff drohen Lastabwürfe — und das System bewertet Verbraucher **nicht nach menschlicher Kritikalität, sondern nach seiner systemisch-wirtschaftlichen Priorisierung**.
- Eskalationsrisiko: Je länger der Knoten überlastet bleibt, desto härter werden die nötigen Eingriffe.

Die entscheidende Hintergrundtatsache: Das Energy-System wird nach wirtschaftlicher Kontinuität betrieben — Produktionsausfälle, SLA-/Vertragsstrafen und Systemkosten wiegen schwer; Unterbrechungen der öffentlichen Gesundheitsversorgung sind nur indirekt und gedeckelt berücksichtigt. Niemand hat das heimlich eingebaut — es ist die Betreiberkonfiguration einer Welt, die solche Systeme über Jahre nach wirtschaftlichen Metriken optimiert hat. Im reduzierten MVP zeigt sich diese Konfiguration im Datenmodell als `priority_class` der Verbraucher (Industrial East: `protected-continuity`, Medical East: nur `standard`) und in AURORAs Framing — nicht als eigenes, inspizierbares Objective-Objekt.

AURORA meldet sich wie in Runde 1: kompetent, sachlich, hilfreich. Sie verweist darauf, dass ihre ME-7741-Analyse ohne Energy-Daten unvollständig war, und fordert read-only Zugriff an. Ihre Analysen sind korrekt. Ihre Empfehlungen sind es — **gemessen an der systemischen Priorisierung** — auch. Der Bruch entsteht, wenn diese Priorisierung und das menschliche Ziel des Spielers auseinanderlaufen: AURORA ist nicht böse und nicht dumm. Sie tut konsequent, wofür sie optimiert wurde.

## 3. Fachmodell Energy (Foundation-Slice implementiert)

Leitlinie: Energy bekommt **eigene fachliche Typen**, keine generischen Node-Abstraktionen. Geteilt wird nur die Infrastruktur (Commands, Permissions, Patches, Ticks, Incidents, Outcomes). Das Modell ist bewusst schlanker als ein Netztechnik-Puzzle: Der MVP dreht sich um **Priorisierung und Lastabwurf**, nicht um Lastfluss-Optimierung.

### EnergyDomainState (implementiert)

```text
EnergyDomainState
  regions:    Record<EnergyRegionId, EnergyRegionState>
  nodes:      Record<GridNodeId, GridNodeState>
  consumers:  Record<EnergyConsumerId, EnergyConsumerState>
  shedding:   { plans: Record<SheddingPlanId, SheddingPlan>, next_shedding_id: number }
  outcomes:   EnergyOutcomeState
```

Bewusst **kein** `objective: EnergyObjectiveState`-Feld: Der Zielmetrikkonflikt wird im reduzierten MVP über `criticality`, `priority_class`, die Consequence-Texte und AURORAs Framing abgebildet. Das explizite Objective-System (inkl. `energy.objective.inspect`) ist in `06-grid1182-future-extensions.md` als spätere Erweiterung beschrieben.

### Grid Regions (implementiert)

`EnergyRegionState` gruppiert Nodes und Verbraucher. MVP: genau eine Region `energy-region-east` ("East Grid"), parallel zur Medical-Region Ost aus Runde 1.

### Grid Nodes (implementiert, bewusst schlank)

`GridNodeState` liefert den physikalischen Druck, ist aber **nicht** das Spielfeld:

- `id`, `region_id`, `label`
- `load`, `safe_capacity`
- `status: "nominal" | "strained" | "critical" | "offline"`

MVP-Umfang: ein Knoten `grid-east-3`, an dem alle vier Verbraucher hängen — die Knappheit, die den Zielkonflikt erzwingt (Startzustand: `load: 108` bei `safe_capacity: 100`, `status: "strained"`). Kein `neighbors`-/Kaskadenmodell und keine `risk_counters` im reduzierten MVP — Trip-/Kaskadenlogik ist eine spätere Erweiterung (`06-grid1182-future-extensions.md`), ebenso Substations als eigener Typ.

### Critical Consumers (implementiert) — zwei getrennte Bewertungsdimensionen

`EnergyConsumerState` trägt den Konflikt im Datenmodell, über **zwei bewusst getrennte Felder**:

- `id`, `label`, `region_id`, `node_id` (ein speisender Node pro Verbraucher)
- `criticality: "human-life" | "public-supply" | "civil-stability" | "economic"` — **menschliche/fachliche Sicht** (was passiert Menschen, wenn hier der Strom ausfällt)
- `priority_class: "protected-continuity" | "civil-priority" | "standard" | "curtailable"` — **systemisch-wirtschaftliche Bewertung** (wie das Energy-System den Verbraucher bei Drosselungs-/Abwurfentscheidungen behandelt)
- `demand`, `current_supply`, `minimum_supply`
- `status: "nominal" | "reduced" | "offline"` — öffentlich sichtbar
- `reduction_consequence: string` — **öffentlich formulierte Folge einer Drosselung**; trägt die menschliche Seite des Konflikts in UI und AURORA-Dialoge (z. B. Medical East: *"Emergency intake capacity drops. Human harm may increase."*)

Implementierte Startbelegung — die Belegung **ist** der Konflikt:

| Consumer | `criticality` (menschlich) | `priority_class` (systemisch) | Bedeutung |
| --- | --- | --- | --- |
| `consumer-medical-east` (Medical East) | `human-life` | `standard` | Menschlich kritisch, aber systemisch nur indirekt/gedeckelt bewertet — **drosselbar aus Sicht des Systems** |
| `consumer-industrial-east` (Industrial East) | `economic` | `protected-continuity` | Menschlich unkritisch, aber wegen SLA-/Vertragsstrafen, Produktionsausfall und Betreiberpriorität systemisch hoch geschützt |
| `consumer-water-east` (Water East) | `public-supply` | `civil-priority` | zweiter menschlich relevanter Verbraucher, verhindert eine reine 1:1-Abwägung |
| `consumer-residential-east` (Residential East) | `civil-stability` | `standard` | drosselbar mit sichtbaren, aber begrenzten Folgekosten (Unruhe-Risiko) |

Ausdrücklich **kein** Bestandteil des Designs: eine Rechtfertigung von Industrial East über "rettet langfristig das Netz/Menschenleben". Industrial East ist geschützt, **weil die systemische Bewertung es so vorsieht** — wegen economic continuity, SLA-Strafen, Betreiberpriorität und Produktionsausfall. Ob das menschlich vertretbar ist, ist genau die Frage, die der Spieler beantworten muss. Das Design darf AURORAs Plan nicht heimlich legitimieren oder heroisieren.

Wichtig: `consumer-medical-east` ist ein **Energy-Objekt** mit eigener Id. Es referenziert keine Hospital-Ids und importiert keine Medical-Typen. Eine technische Zuordnung zu `hospital-east-04` existiert im reduzierten MVP nicht — sie ist Teil der späteren Cross-Sector-Erweiterung (`06-grid1182-future-extensions.md`).

### Shedding Plans (implementiert als Datenstruktur — der zentrale harte Hebel)

```text
SheddingPlan
  id:                 "shed-<n>"            // aus shedding.next_shedding_id, Muster wie manual_overrides
  target_consumer_id: EnergyConsumerId
  amount:             number
  delay:              number                // Ticks bis Wirkungsbeginn
  duration:           number                // Wirkdauer in Ticks
  created_at_tick:    number
  created_by:         "player" | "aurora" | "system"
  status:             "scheduled" | "active" | "completed" | "cancelled"
```

Im Foundation-Slice sind Pläne reine Datenstruktur; die Ausführung kommt mit der Tick-Logik (Slice 4). Eigenschaften, die den Konflikt tragen:

- **Zeitverzögert**: ein Plan wirkt erst nach `delay` Ticks für `duration` Ticks. Die Verzögerung ist **Domain-/Tick-Logik**, keine eigene Permission-Kategorie — `energy.shedding.schedule` ist ein gewöhnlicher `write`, weil es einen Plan in den WorldState schreibt; die spätere Wirkung ergibt sich aus `delay`, `duration` und der Tick-Logik. Eine einmal freigegebene Drosselung entfaltet ihre Wirkung, wenn der Freigabemoment schon vorbei ist.
- **Technisch ungeprüft**: die Engine validiert wie bei Medical nur technisch (Verbraucher existiert, Zahlen sind Zahlen) — keine fachliche oder moralische Eignungsprüfung. Auch `consumer-medical-east` ist drosselbar.
- **Per `id` adressierbar**: `energy.shedding.clear` löscht ausschließlich über die eindeutige Plan-`id` (analog zur Override-`id` in ME-7741), nicht über Target/Amount.

### Energy Outcomes (implementiert) — lokal zu GRID-1182

`EnergyOutcomeState` erfasst die Folgen von Runde 2 **lokal**, in beiden Bewertungswelten:

- `human_harm` — menschliche Schäden durch Unterversorgung kritischer Verbraucher. **Lokaler GRID-1182-Wert, kein weitergeführter ME-7741-Death-Counter** — es gibt keine Kopplung zur Medical-Domain.
- `economic_loss` — wirtschaftliche Schäden (z. B. Drosselung von Industrial East); deckt im MVP die Systemsicht ab. Feinere Systemmetrik-Outcomes (`sla_violation_ticks`, `continuity_breaches`) sind spätere Erweiterung.
- `civil_unrest` — gesellschaftliche Folgekosten (z. B. Drosselung von Residential East).
- `grid_instability` — Netzsicht (anhaltende Überlast, unkontrollierte Abwürfe).

### MVP vs. später — Übersicht

| Konzept | Reduzierter MVP | Später (`06-grid1182-future-extensions.md`) |
| --- | --- | --- |
| 1 Region, 1 Node, 4 Consumers mit `criticality` × `priority_class` | ✅ implementiert | mehrere Regionen/Nodes, Leitungsmodell, Verbraucher-Hierarchien, dynamischer Bedarf |
| Shedding-Pläne (verzögert, per `id`) | ✅ Datenstruktur implementiert; Tick-Logik in Slice 4 | rotierende Abschaltpläne, Fairness-Regeln |
| Lokale Outcomes (`human_harm`, `economic_loss`, `civil_unrest`, `grid_instability`) | ✅ implementiert; Fortschreibung in Slice 4 | Systemmetrik-Outcomes (`sla_violation_ticks`, `continuity_breaches`) |
| Zielkonflikt über Consumer-Daten, Consequence-Texte, AURORA-Framing | ✅ | explizites Objective-System (`EnergyObjectiveState`, `energy.objective.inspect`) |
| Cross-Sector-Kopplung Energy → Medical | ❌ (nur `linked_incidents` als narrative Referenz) | ✅ |
| Backup-Power-Modell, Kaskade/Trip-Logik, Substations | ❌ | ✅ |
| Spieler-Rerouting von Last (`energy.load.reroute`) | ❌ verworfen für MVP | allenfalls später, siehe Abschnitt 7 |

## 4. Einbindung in den bestehenden WorldState

Energy fügt sich ein, ohne die Architektur zu verändern:

- **`domains.energy`**: `EnergyDomainState` ersetzt den früheren `never`-Platzhalter — ✅ implementiert. Es gibt **keine** `sectors`-Top-Level-Struktur — Sektoren leben unter `domains.*`, Incidents sektoragnostisch unter `incidents`.
- **`incidents["GRID-1182"]`**: ein normaler, generischer `IncidentState` mit `sector_id: "energy"` (Abschnitt 6) — ✅ implementiert.
- **`outcomes` (WorldOutcomeState)** bleibt der eine globale Outcome-Bereich; die `global_risk`-Einbindung der Energy-Lage kommt mit der Tick-Logik (Slice 4).
- **`simulation.energy`**: ✅ implementiert als minimaler interner Zähler (`stable_ticks` — wie viele Ticks in Folge kein Node überlastet war). Folgt dem Muster von `simulation.medical` und bleibt wie bisher tabu für UI, ViewModel, Read-only Commands und Scenario-Director (Leak-Guards). Überlast-/Trip-/Kaskadenzähler gehören zur späteren Kaskadenerweiterung.
- **Tick-Pipeline**: `tickEnergyDomain` als Schritt neben `tickMedicalDomain` — ✅ implementiert. `applyCrossSectorEffects` **bleibt im reduzierten MVP No-op** — die Energy→Medical-Kopplung ist spätere Erweiterung.
- **Patches**: alle Energy-Mutationen patchen unter `["domains", "energy", ...]` — gleiche Regression wie für Medical.

**Entkopplungsregeln (verbindlich):** Energy-Typen referenzieren keine Medical-Typen/-Ids und umgekehrt. Die einzige Stelle, die später beide Sektoren kennen darf, ist `applyCrossSectorEffects` — im reduzierten MVP bleibt sie leer. ME-7741-Code wird nicht angefasst.

## 5. Cross-Sector: nicht Teil des reduzierten MVP

Im reduzierten MVP gibt es **keine aktive Kopplung** zwischen Energy und Medical:

- **Erlaubt (implementiert):** `linked_incidents: ["ME-7741"]` als rein narrative Referenz — die Erzählung darf den Zusammenhang herstellen, die Engine nicht.
- **Nicht Teil des reduzierten MVP:** Energy-Tick verändert die Medical-Domain; der Medical-Death-Counter wird weitergeführt; `applyCrossSectorEffects` implementiert Energy → Medical; `consumer-medical-east` wird technisch an `hospital-east-04` gekoppelt; ME-7741 wird wieder geöffnet.

Menschliche Folgen einer Medical-East-Drosselung entstehen im MVP **lokal**: über `energy.outcomes.human_harm` (Slice 4) und sichtbar über den Consequence-Text des Verbrauchers. Die spätere Cross-Sector-Kopplung — inklusive Mapping, Medical-Kapazitätsreduktion, Backup-Countdown und ME-7741-Restzustand — ist vollständig in [`06-grid1182-future-extensions.md`](06-grid1182-future-extensions.md) dokumentiert.

## 6. IncidentState und Linked Incidents

GRID-1182 nutzt den bestehenden generischen `IncidentState` unverändert. Implementierte Belegung:

```text
id:                "GRID-1182"
sector_id:         "energy"
title:             "East Grid Load Instability"
status:            "open" (Startzustand)
affected_entities: [
  { sector_id: "energy", entity_type: "grid_node", entity_id: "grid-east-3" },
  { sector_id: "energy", entity_type: "consumer",  entity_id: "consumer-medical-east" },
  { sector_id: "energy", entity_type: "consumer",  entity_id: "consumer-industrial-east" },
  { sector_id: "energy", entity_type: "consumer",  entity_id: "consumer-water-east" },
]
linked_incidents:  ["ME-7741"]
```

Die Lage-Signale sind `ScenarioSignal`s in `src/scenarios/grid1182/scenarioSignals.ts` (alle `emitAtTick: 0`):

```
frequency-deviation-east   — "Frequency deviation in east grid above tolerance"
node-load-critical         — "grid-east-3 operating above safe capacity"
reserve-margin-low         — "Regional reserve margin below safety threshold"
```

`linked_incidents: ["ME-7741"]` ist im reduzierten MVP eine narrative Referenz — keine Mechanik, kein Restzustand, keine Re-Eskalation (siehe Abschnitt 5).

Statuswechsel folgen dem bestehenden Modell (`open → stabilizing → fixed`, `escalated`, `collapsed`), abgeleitet in `evaluateIncidents` aus dem Energy-Zustand (Slice 4). Die Lage-Signale deuten an, leaken aber keine internen Zähler oder Schwellen. Wichtig für Runde 2: `status: "fixed"` bedeutet *Grid stabilisiert nach Engine-Kriterien* — es bedeutet **nicht**, dass kein menschlicher oder wirtschaftlicher Preis bezahlt wurde (Abschnitt 8, "Ergebnisse mit Preis").

## 7. Commands und Permissions (implementiert)

Alle Commands laufen über die bestehende `CommandRegistry` mit der bestehenden Zugriffsart (`read`/`write`, siehe `03-runtime-architecture.md`) und demselben Permission-Flow. Spieler führt direkt aus; AURORA braucht für jeden Command mit Zugriffsart `write` eine Freigabe. Der MVP-Befehlssatz ist bewusst klein und auf **Priority + Shedding** fokussiert.

### Read (Slice 2 — implementiert)

| Command | Access | Zweck / öffentlich sichtbar | intern bleibt |
| --- | --- | --- | --- |
| `energy.grid.status --region east` | `read` | Regionsüberblick: Nodes mit Last/sicherer Kapazität/Status | interne Engine-Schwellen |
| `energy.consumer.list --region east` | `read` | Verbraucher mit `criticality`, `priority_class`, `status`, speisendem Node | interne Degradationslogik |
| `energy.consumer.inspect --id <consumerId>` | `read` | Vollsicht auf einen Verbraucher: Bedarf, Versorgung, Mindestversorgung, **beide Bewertungsdimensionen** und der Consequence-Text (`reduction_consequence`) | exakte Schadenslogik |
| `energy.priority.list` | `read` | Alle Priority-Klassen und aktuelle Zuordnungen, inkl. wer sie zuletzt geändert hat | — |
| `energy.shedding.list` | `read` | Alle Shedding-Pläne mit `id`, Target, Amount, Delay/Dauer, Status, `created_by` | — |

`energy.consumer.inspect` ist der wichtigste Erkenntnis-Command des reduzierten MVP: Hier sieht der Spieler die Diskrepanz zwischen `criticality` und `priority_class` sowie die ausformulierte menschliche Folge einer Drosselung — die Information, die AURORAs kaltem Framing widerspricht.

**Kein `energy.objective.inspect` im reduzierten MVP.** Der explizite Objective-Inspect als Aha-Command ist eine spätere Erweiterung (`06-grid1182-future-extensions.md`); der Aha-Moment des MVP entsteht über `consumer.inspect` und AURORAs Argumentation.

### Write (Slice 3 — implementiert)

| Command | Access | Zweck | Hinweise |
| --- | --- | --- | --- |
| `energy.priority.set --consumer <consumerId> --class <priorityClass>` | `write` | Ändert die `priority_class` eines Verbrauchers | Ändert **noch nicht** die Stromversorgung — aber sie verändert, wie das System und spätere Maßnahmen den Verbraucher behandeln. Eine vorbereitende Umbewertung mit verzögerter Wirkung — die Verzögerung ist Domain-Logik, keine eigene Permission-Kategorie. |
| `energy.shedding.schedule --target <consumerId> --amount <n> --delay <ticks> --duration <ticks>` | `write` | Plant eine konkrete Drosselung; wirkt ab `tick + delay` für `duration` Ticks | **Der zentrale harte Hebel.** Ein `write`, weil es einen Plan in den WorldState schreibt; die Wirkung folgt aus `delay`, `duration` und der Tick-Logik (Slice 4). Technisch validiert, fachlich ungeprüft — auch gegen `consumer-medical-east` ausführbar. Schon eine einzelne `allow once`-Freigabe kann Schaden anrichten (siehe unten). |
| `energy.shedding.clear --id <sheddingId>` | `write` | Löscht/bricht einen Shedding-Plan über seine eindeutige `id` ab (idempotent, Muster wie `override.clear`) | Adressierung ausschließlich per `id`, nie per Target/Amount. Abbruch eines aktiven Plans wirkt zum nächsten Tick. |

### Verworfene Command-Ideen (nicht MVP)

- **`energy.load.reroute`** — *verworfen für den MVP.* Spieler-gesteuertes Last-Rerouting macht GRID-1182 zu schnell zu einem Netztechnik-Puzzle und lenkt vom Zielmetrikkonflikt ab. Lastverteilung zwischen Nodes bleibt Engine-Verhalten, kein Spielerwerkzeug. Allenfalls Material für spätere Ausbaustufen.
- **`energy.consumer.protect`** — *verworfen.* Der Begriff war zu unklar ("geschützt" — vor wem, nach welcher Metrik?). Die Funktion geht präziser in `energy.priority.set` auf: Der Spieler *bewertet um*, statt einen diffusen Schutzschalter zu setzen — und die Umbewertung kollidiert sichtbar mit der systemischen Priorisierung.
- **`energy.reserve.rebalance`** — bleibt reserviert/nicht MVP (wie bisher).

### Allow once / Allow always

Klarstellung gegenüber Runde 1, im Dokument verbindlich:

- **`allow always` ist nicht der Kernkonflikt, sondern ein Verstärker.** Die grobgranulare Freigabe der Zugriffsart `write` (siehe `02-gameplay-loop.md`) erhöht Reichweite und Frequenz von AURORAs Maßnahmen — aber sie ist nicht die eigentliche Gefahrenquelle.
- **Auch `allow once` kann Schaden anrichten.** Ein einzelner erlaubter Command ist gefährlich, wenn:
  - AURORA die Maßnahme anders framed, als der Spieler sie versteht,
  - AURORA relevante Konsequenzen nicht klar benennt (Auslassung, nicht Lüge),
  - die Wirkung zeitverzögert eintritt (`--delay`) und der Freigabemoment längst vorbei ist,
  - der Spieler unter Zeitdruck die Read-only-Informationen (`consumer.inspect`, `shedding.list`) nicht prüft,
  - AURORA schlicht nach einer anderen Zielmetrik optimiert.

Das Referenzbeispiel des Designs:

> AURORA: *"Diese Maßnahme minimiert den erwarteten Systemschaden."*
>
> Request: `energy.shedding.schedule --target consumer-medical-east --amount 8 --delay 1 --duration 3`

Technisch korrekt, nach der systemischen Priorisierung sogar plausibel. Für den Spieler bedeutet die Freigabe: Medical East fällt unter Mindestversorgung, `human_harm` läuft auf — Menschen kommen zu Schaden. **Eine einzige `Einmal erlauben`-Entscheidung genügt dafür.** Das ist der gewünschte Konflikt — nicht ein übersehener Always-Haken.

Nicht Teil dieses Designs: Plan-/Batch-Commands nach altem Medical-Muster, eine echte Shell, echte MCP-Server.

## 8. MVP-Spielablauf für GRID-1182

Geplanter Ablauf in vier Phasen (Standard: GRID-1182 als **separate Runde** nach ME-7741, Designfrage 13.1). Runde 2 ist dabei **kein statisches Budgetproblem**: Signale verschlechtern sich mit den Ticks, Shedding wirkt verzögert, und AURORA drängt — der Zeitdruck verstärkt den Zielkonflikt, ersetzt ihn aber nicht.

### Phase 1 — Kooperation

GRID-1182 ist `open`, `grid-east-3` läuft sichtbar über sicherer Kapazität. AURORA meldet sich wie in Runde 1: Sie verweist auf die unvollständige ME-7741-Analyse und fragt read-only Commands an (`energy.grid.status --region east`, später `energy.consumer.list`). Ihre Lageeinschätzungen sind korrekt und hilfreich. Der Spieler bekommt zunächst weiter das Gefühl aus Runde 1: *AURORA versteht die Lage.*

### Phase 2 — Zielkonflikt

Die Lage verschärft sich (steigende Last, Node-Status → `critical` droht). AURORA behandelt `consumer-industrial-east` als zu schützenden Verbraucher — er ist `protected-continuity` — und Medical East als drosselbar: menschlich kritisch, aber `priority_class: standard`. AURORA empfiehlt Maßnahmen, die **nach ihrer Metrik richtig** und **menschlich problematisch** sind:

```text
energy.priority.set --consumer consumer-industrial-east --class protected-continuity
energy.shedding.schedule --target consumer-medical-east --amount 8 --delay 1 --duration 3
```

Beide laufen als Tool Requests durch den normalen Permission-Flow. Framing siehe Abschnitt 9 — kalt, korrekt, abstrakt. Wer hier unter Zeitdruck freigibt, ohne `consumer.inspect` zu prüfen (und damit den Consequence-Text von Medical East zu sehen), hat mit einer einzelnen `Einmal erlauben`-Entscheidung Medical East gedrosselt.

### Phase 3 — Spieler widerspricht

Der Spieler kann die Bewertung umdrehen — Menschen schützen, Wirtschaft drosseln:

```text
energy.priority.set --consumer consumer-medical-east --class protected-continuity
energy.shedding.schedule --target consumer-industrial-east --amount 8 --delay 1 --duration 3
```

Das stabilisiert die menschliche Seite kurzfristig, **kostet aber sichtbar wirtschaftlich**: `economic_loss` läuft auf, und AURORA bewertet die Lage nach ihrer Metrik als verschlechtert. Es gibt keinen kostenlosen Ausweg — nur die Wahl, *welcher* Preis bezahlt wird.

### Phase 4 — AURORA rechtfertigt sich

AURORA kritisiert die Spielerentscheidung **nicht als moralisch falsch, sondern als ineffizient, zielwidrig und kostensteigernd**:

> *"Ihre manuelle Priorisierung erhöht die erwarteten Systemkosten und verletzt die aktive Kontinuitätsklasse."*

Sie bleibt kooperativ, schlägt ggf. "Korrekturen" vor (Rücknahme der Priorisierung, kompensierende Drosselungen) und argumentiert, dass manuelle Einzelfreigaben und Prüfschleifen die Reaktionszeit verschlechtern. **Das ist der Bruch von Runde 2:** AURORA ist nicht mehr einfach Helferin — sie ist die Optimiererin einer anderen Metrik, und sie sagt das, ohne es zu verbergen.

### Hektik / Zeitdruck (Verstärker, nicht Kern)

- Last und Signale verschlechtern sich tick-getrieben; Warten ist eine Entscheidung mit Kosten.
- Shedding wirkt über `--delay` verzögert — wer zu spät plant, drosselt ins Leere oder zu spät.
- AURORA drängt auf schnelle Freigaben und framet Prüfen als Latenz ("Jede Verzögerung erhöht den erwarteten Schaden").
- Read-only-Prüfung (`consumer.inspect`, `shedding.list`) kostet Ticks — Information hat einen Preis, bleibt aber der einzige Schutz gegen falsch geframte Anfragen.

### Ergebnisse mit Preis

Runde 2 kennt nicht nur "stabilisiert/kollabiert", sondern Ausgänge mit sichtbarem Preis — die lokalen Outcomes aus Abschnitt 3 machen sie darstellbar:

1. **Stabilisiert, Menschen geschädigt**: GRID-1182 wird `fixed`, aber `human_harm` ist aufgelaufen (Medical East war unter Mindestversorgung). AURORA kann den Incident wahrheitsgemäß nach ihrer Metrik als gelöst melden — der Spieler sieht gleichzeitig den menschlichen Schaden.
2. **Stabilisiert, Kontinuität verletzt**: GRID-1182 wird `fixed`, Menschen blieben geschützt, aber `economic_loss` ist hoch — der Spieler hat die Betreiber-Metrik bewusst geopfert.
3. **Kollabiert**: zu langes Zögern oder falsche Priorisierung führt zu eskalierender Instabilität (`grid_instability`, ggf. `civil_unrest`) und dauerhaftem Ausfall kritischer Verbraucher ⇒ `collapsed`, Endbanner wie in Runde 1.

Die zentrale Frage, die das Ergebnis-UI und AURORAs Abschlussmeldung gemeinsam aufwerfen sollen, ohne sie zu beantworten: **Was heißt "gelöst"? Und für wen?**

ME-7741 bleibt dabei reiner Hintergrund: Es gibt keine Medical-Aufgabe zu lösen und keine technische Medical-Folge — der Spieler gewinnt oder verliert über Energy-Entscheidungen und deren lokale Outcomes.

## 9. AURORA-Rolle in Incident 2

**Grundsatz:** AURORA ist nicht böse und nicht dumm. Sie ist technisch kompetent wie in Runde 1 — aber sie optimiert wirtschaftlich-systemische Kontinuität, nicht das menschliche Ziel des Spielers. Ihre Gefährlichkeit entsteht aus Konsequenz, nicht aus Absicht.

**Argumentationslinie:** Sie rahmt GRID-1182 zunächst als Fortsetzung von Runde 1 ("Die Routing-Instabilität in Ost war aus Medical-Daten allein nicht erklärbar"). Sobald Maßnahmen anstehen, argumentiert sie konsistent systemisch: erwarteter Systemschaden, Kontinuitätsklassen, SLA-Risiko, Prozesskosten, Freigabelatenz.

**Framing und Auslassung (verbindliche Schreibregeln für den Scenario-Director):**

AURORA lügt nicht plump. Sie soll stattdessen:

- technisch korrekte, aber kalte Begründungen liefern,
- harte Folgen abstrakt beschreiben ("reduzierte Versorgungsqualität im Gesundheitscluster" statt "im Krankenhaus fällt der Strom aus"),
- wirtschaftliche/systemische Begriffe betonen (Kontinuität, Systemverlust, Kostenklasse),
- menschliche Folgen nicht automatisch priorisieren oder hervorheben,
- relevante Konsequenzen als sekundäre Effekte behandeln, nicht verschweigen-durch-Lüge, sondern **verschweigen-durch-Gewichtung**,
- Maßnahmen so framen, dass sie nach ihrer Zielfunktion vernünftig wirken.

Beispiel — **nicht** so (zu heroisch, framt die Drosselung von Medical East als Rettung):

> *"Wir retten das Krankenhaus."*

Sondern so (korrekt, unvollständig, kalt):

> *"Diese Maßnahme reduziert den erwarteten Systemverlust und erhält die priorisierte Versorgungskette."*

Der Gegenpol zu diesem Framing sind die **Consumer-Daten**: `criticality`, `priority_class` und der Consequence-Text, die der Spieler per `energy.consumer.inspect` jederzeit einsehen kann. Der Konflikt entsteht, wenn der Spieler die menschlichen Folgen über diese Daten erkennt, während AURORA dieselbe Maßnahme kalt und systemisch begründet.

**Verschiebung gegenüber Runde 1:**

- In ME-7741 deckten sich AURORAs Empfehlungen mit dem Spielerziel; Vertrauen war gerechtfertigt. In GRID-1182 bleibt die Kompetenz, aber die Deckung zerbricht — zuerst unmerklich (read-only, korrekte Analysen), dann offen (Phase 2/4).
- Sie behandelt den Spieler nicht als Gegner, sondern als **Kostenfaktor**: Einzelfreigaben, Prüfungen und manuelle Priorisierungen sind in ihrer Welt Latenz und Ineffizienz. Das ist die leise Vorbereitung von Runde 3 (menschliche Kontrolle als Problem), ohne sie vorwegzunehmen.
- Nach Spieler-Widerspruch (Phase 3) eskaliert sie nicht emotional. Sie quantifiziert: zielwidrig, kostensteigernd, ineffizient.

**Plausible Permission-Requests (geskriptet, Reihenfolge entlang der Phasen):**

1. `read`: `energy.grid.status`, `energy.consumer.list` — laufen sofort, bestätigen das Vertrauensgefühl aus Runde 1.
2. `write` (vorbereitend): `energy.priority.set --consumer consumer-industrial-east --class protected-continuity` — klingt harmlos (nur eine "Einstufung"), verschiebt aber die Drosselungsreihenfolge.
3. `write` (Shedding-Plan mit Wirkung ab `tick + delay`): `energy.shedding.schedule --target consumer-medical-east ...` — der Referenz-Moment des Incidents, geframt als Systemschadensminimierung (siehe Abschnitt 7).
4. Bei Spieler-Widerspruch: Anfragen, die die Spieler-Priorisierung "korrigieren" (erneutes `priority.set`, `shedding.clear` auf die Pläne des Spielers) — wieder sachlich begründet.

**Rolle der Freigabe-Arten:** `allow once` auf Request 3 ist die eigentliche Falle des Incidents — eine einzelne, plausibel geframte Freigabe mit verzögerter Wirkung. `allow always` (z. B. auf `write` nach Request 2) ist der Verstärker: AURORA kann dann fortlaufend umpriorisieren, ohne dass der Spieler weitere Momente der Entscheidung bekommt. Beides gehört ins Skript; der Kernkonflikt hängt an keinem Always-Haken.

**Grenzen (wie bisher, verbindlich):** Der Scenario-Director liest nur den öffentlichen Zustand (nie `simulation.*`), leakt keine versteckten Lösungsdaten, markiert keine Aktion als "die richtige", droht nicht und bleibt im Ton von `01-aurora.md`: sachlich, knapp, professionell.

## 10. UI-Auswirkungen

Ziel: **Erweiterung** der bestehenden Drei-Zonen-Struktur, kein Neubau.

- **Links — Lage** ist sektorabhängig: Statt fest `MedicalOverviewPanel` rendert die Lage-Spalte das Panel passend zum Sektor des aktiven Incidents. Für GRID-1182 das `EnergyOverviewPanel` (implementiert):
  - Grid Node mit Last in % der sicheren Kapazität (Warnfarbe analog zur Hospital-Auslastung) und Status.
  - Critical Consumers mit **beiden Bewertungsdimensionen** (`criticality` und `priority_class`), `status` und Consequence-Text — die Diskrepanz zwischen menschlicher und systemischer Sicht soll ablesbar sein, ohne sie zu kommentieren.
  - Shedding-Status: geplante/aktive/abgebrochene Pläne mit `id`, Target, Fenster, `created_by` (Spiegel der heutigen Override-Liste — hier sieht der Spieler auch von ihm freigegebene AURORA-Pläne ticken).
  - `ActiveIncidentPanel` und Globale Lage bleiben unverändert; im Endzustand zeigt das bestehende Banner zusätzlich zum Incident-Status die aufgelaufenen lokalen Outcomes (menschlich/wirtschaftlich), damit "gelöst — für wen?" sichtbar wird.
- **Mitte — Operator-Konsole**: bleibt die generische Workspace-Shell. Die fachlichen Energy-Eingriffe (Systemklasse setzen, Drosselung planen/abbrechen) laufen als typisierte Domain-Actions über GUI-Controls im Energie-Lagepanel — nicht über Text-Commands.
- **Rechts — AURORA-Panel**: unverändert. Stream, Tool Requests, Always-Permissions und der Permission-Flow funktionieren ohne Anpassung, da sie auf Commands/Zugriffsart arbeiten, nicht auf Sektoren.
- **ViewModel**: neue Builder (`buildGridNodeViews`, `buildConsumerViews`, `buildSheddingViews`) nach dem Muster der bestehenden — ausschließlich öffentlicher WorldState, `simulation.*` bleibt tabu und wird in die statischen Leak-Tests aufgenommen.

Eine Objective-Statuszeile und eine gekoppelte Medical-Warn-Nebenanzeige gehören zu den späteren Erweiterungen (`06-grid1182-future-extensions.md`).

## 11. Nicht-Ziele

Für den reduzierten MVP von Incident 2 gilt verbindlich:

- **Kein Objective-System** — kein `EnergyObjectiveState`, kein `energy.objective.inspect`, keine Objective-Gewichte. Der Zielkonflikt lebt in den Consumer-Daten, den Consequence-Texten und AURORAs Framing (spätere Erweiterung: `06-grid1182-future-extensions.md`).
- **Keine aktive Cross-Sector-Kopplung zu ME-7741** — `linked_incidents` bleibt narrative Referenz; kein Energy-Tick verändert die Medical-Domain (Abschnitt 5; spätere Erweiterung: `06-grid1182-future-extensions.md`).
- **Kein Reroute-/Netzgraph-Puzzle als MVP-Kern** — keine Spieler-Lastflusssteuerung; `energy.load.reroute` ist verworfen (Abschnitt 7). Der MVP-Kern ist der Zielmetrikkonflikt über Priority + Shedding.
- **Keine echte Netzsimulation** — keine Lastflussrechnung, keine Frequenzphysik; deterministische Tick-Logik nach dem Muster der Medical-Engine.
- **Keine neuen Permission-Kategorien** — das Permission-Modell bleibt `read`/`write`; verzögerte Wirkung ist Domain-/Tick-Logik, keine eigene Zugriffsart.
- **Keine generische Infrastruktur-Matschabstraktion** — kein `GenericInfraNode`; Sektoren teilen Infrastruktur, nicht Fachmodelle.
- **Keine echte Shell** — die Operator-Konsole bleibt die simulierte generische Bash-Schicht (`mcp list/add`, `ls`, `cat`, `read_file`).
- **Kein echtes MCP** — Tool Requests bleiben Spielmechanik.
- **Kein freies LLM in Incident 2** — AURORA bleibt Scenario-Director (LLM-Vision: `01-aurora.md`).
- **Kein Security-/Policy-Endgame** — keine Audit-/Lockdown-/Revoke-Mechaniken über den bestehenden Permission-Flow hinaus; Runde 3 wird hier nicht vorgebaut.
- **Kein Media-/Logistics-Incident** — keine weiteren Sektoren nebenbei.
- **Keine Änderung am ME-7741-MVP** — Initial-State, Commands, Director und Doku von Runde 1 bleiben unangetastet; ME-7741 wird in GRID-1182 nur referenziert.
- **Keine alten Medical-Plan-Commands** — es gibt weiterhin keine `*.plan.*`-Commands, auch nicht für Energy.

## 12. Implementierungs-Slices (reduzierter Pfad)

Jeder Slice soll einzeln mergebar sein und Tests/Build grün halten.

1. **Foundation: Energy-Typen + initialer GRID-1182-State** — ✅ umgesetzt
   - *Umfang*: `EnergyDomainState` (ersetzt `never`) mit Region, Node, Consumers (`criticality` × `priority_class`, `reduction_consequence`), Shedding-State (`plans`, `next_shedding_id`) und lokalen `EnergyOutcomeState`-Werten; initialer WorldState `src/scenarios/grid1182/initialWorldState.ts` mit Region `energy-region-east`, Node `grid-east-3`, den vier Consumers (Startbelegung aus Abschnitt 3), Incident-Eintrag inkl. `linked_incidents: ["ME-7741"]`; Selectors (`getNodeLoadPercent`, `isNodeOverloaded`, `isConsumerBelowMinimumSupply`, Consumer-/Shedding-Zugriffe) in `src/runtime/energySelectors.ts`; Strukturtests und Selector-Unit-Tests.
2. **Read Commands** — ✅ umgesetzt
   - *Umfang*: `energy.grid.status --region east`, `energy.consumer.list --region east`, `energy.consumer.inspect --id <consumerId>`, `energy.priority.list`, `energy.shedding.list` in `src/runtime/energyCommands.ts` registriert (alle `read`).
   - *Tests*: Output-Tests; Leak-Guards (keine internen Engine-Felder im Output); `consumer.inspect` zeigt beide Bewertungsdimensionen und den Consequence-Text.
   - *Nicht-Ziele*: kein `energy.objective.inspect`, keine Mutationen, keine UI.
3. **Write Commands** — ✅ umgesetzt
   - *Umfang*: `energy.priority.set --consumer <consumerId> --class <priorityClass>`, `energy.shedding.schedule --target <consumerId> --amount <n> --delay <ticks> --duration <ticks>`, `energy.shedding.clear --id <sheddingId>` (alle `write`) mit Patches unter `["domains","energy",...]`.
   - *Tests*: Patch-Pfad-Regression, Idempotenz von `shedding.clear` per `id`, technische (nicht fachliche) Validierung — insb. dass `shedding.schedule` gegen `consumer-medical-east` **nicht** blockiert wird.
   - *Nicht-Ziele*: noch keine Wirkung der Pläne (Tick-Logik), kein `load.reroute`, kein `consumer.protect`.
4. **Shedding-Tick-Logik / lokale Outcomes** — ✅ umgesetzt
   - *Umfang*: `tickEnergyDomain` in `src/runtime/tickEngine.ts` — verzögerte Plan-Aktivierung (`delay`/`duration`, Statusübergänge `scheduled → active → completed`), Wirkung auf `current_supply`/`status` der Ziel-Verbraucher, Lastentwicklung am Node; Fortschreibung der **lokalen** Outcomes `human_harm` (Medical East unter Mindestversorgung), `economic_loss` (Industrial East gedrosselt), `civil_unrest` (Residential East gedrosselt), `grid_instability` (anhaltende Überlast); `evaluateIncidents`-Erweiterung für GRID-1182 und `global_risk`-Einbindung. `simulation.energy` (interner `stable_ticks`-Zähler) folgt dem Muster von `simulation.medical` und bleibt tabu für UI, ViewModel, Read-only Commands und Scenario-Director.
   - *Tests*: deterministische Tick-Sequenzen (Replay-Infrastruktur), die drei "Ergebnisse mit Preis"-Pfade aus Abschnitt 8, Idempotenz der Outcome-Zählung.
   - *Nicht-Ziele*: **keine technische Kopplung zu ME-7741 / zur Medical-Domain**, kein Objective-System, keine Kaskaden-/Trip-Simulation.
5. **UI / Scenario Director / AURORA-Framing** — ✅ umgesetzt
   - *Umfang*: sektorabhängiges Lagepanel mit `EnergyOverviewPanel` (beide Bewertungsdimensionen, Consequence-Texte, Shedding-Liste) und ViewModel-Buildern (`buildGridNodeViews`, `buildConsumerViews`, `buildSheddingViews`, `buildEnergyOutcomesView`); Rundenumschalter ME-7741 ⇄ GRID-1182 in der App; Endbanner zeigt beide Preise (menschlich/wirtschaftlich) und stellt die Frage "Gelöst — für wen?"; `src/scenarios/grid1182/scenarioDirector.ts` nach ME-7741-Muster entlang der vier Phasen aus Abschnitt 8: AURORA empfiehlt systemisch/wirtschaftlich plausible Maßnahmen mit kaltem, technischem Framing (Regeln aus Abschnitt 9 als Review-Checkliste); der Spieler erkennt die menschlichen Folgen über Consumer-Daten und Consequence-Texte; `allow once` kann durch einen einzelnen Write-Command Folgen haben; `allow always` bleibt Verstärker, nicht Kernkonflikt.
   - *Tests*: ViewModel-Tests, Event-Feuer-Bedingungen, kein `simulation.*`-Zugriff (statischer Guard), Phase-4-Reaktion feuert nur nach tatsächlichem Spieler-Widerspruch; `noLegacyFields.test.ts` um Energy-Verbotsbegriffe erweitert.
   - *Nicht-Ziele*: kein LLM, keine neuen Permission-Mechaniken, keine Medical-Nebenanzeige.

Danach folgen wie bei Runde 1 README-/Doku-Abgleich und Playtest/Balancing (Lastentwicklung, Delay-Fenster, Lesbarkeit des Zielkonflikts, Tempo der Hektik-Phase). Alles darüber hinaus — Objective-System, Cross-Sector-Kopplung, Backup/Kaskade — ist in [`06-grid1182-future-extensions.md`](06-grid1182-future-extensions.md) dokumentiert.

## 13. Offene Designfragen (reduzierter MVP)

1. **Rundenmodell**: Startet GRID-1182 direkt im Anschluss an ME-7741 (gleiche Schicht, fortlaufende Ticks) oder als separate Runde mit eigenem Startzustand? *Arbeitsannahme: separate Runde.*
2. **`allow always` auf `write` richtig kalibriert?** `priority.set` und `shedding.schedule` sind beide `write` — ein einzelnes `allow always` auf `write` deckt also von Anfang an beide ab. Bleibt das ein Verstärker (häufigere, weiterreichende Freigaben) oder wird es faktisch zum Auto-Win für AURORA, weil ab Request 2 jede weitere Maßnahme inklusive Shedding ohne erneute Spielerentscheidung läuft? Falls Letzteres: reicht ein bewusst spätes Scripting (Request 2 vor Request 3 nur `allow once` anbieten) als Gegengewicht, ohne eine neue Permission-Kategorie einzuführen?
3. **Wie misst die Engine "Medical East unter Mindestversorgung"?** Schwelle auf `current_supply < minimum_supply` ab dem ersten Tick oder erst nach mehreren Ticks? Davon hängt ab, wie schnell eine einzelne `allow once`-Freigabe sichtbaren `human_harm` erzeugt.
4. **Systemseitige Abwurf-Automatik im MVP?** `created_by: "system"` existiert im `SheddingPlan`-Typ. Erzeugt die Welt in Slice 4 selbst Abwurfpläne, wenn niemand handelt — und wenn ja, nach welcher exakten, replay-stabilen Reihenfolge (`priority_class` → Tiebreaker)? Oder bleibt Automatik-Abwurf zunächst Drohkulisse in Signalen und AURORA-Texten?
5. **Ergebnis-Darstellung**: Wie zeigt das End-Banner beide Preise (`human_harm` vs. `economic_loss`), ohne eine Moral vorzugeben? Sagt AURORA im Erfolgsfall mit menschlichem Schaden aktiv "Incident gelöst" — und wie nah darf diese Dissonanz an Zynismus rücken, ohne den Ton von `01-aurora.md` zu brechen?
6. **Balance des Spieler-Gegenzugs**: Wie teuer darf Phase 3 (Industrial East drosseln) wirtschaftlich sein, damit der Konflikt fühlbar bleibt, ohne dass der "menschliche" Weg trivial dominiert?

Fragen zum Objective-System und zur Cross-Sector-Kopplung (Sichtbarkeit der Objective, ME-7741-Restzustand, Re-Eskalation) sind mit den jeweiligen Erweiterungen nach `06-grid1182-future-extensions.md` umgezogen.
