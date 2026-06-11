# 05 — Incident 2: Energy Grid

**Arbeitstitel: GRID-1182 ("East Grid Load Instability")**

Dieses Dokument ist das Design für den zweiten spielbaren Incident. Es ist eine reine Spezifikation: Nichts davon ist implementiert. Es soll später als Grundlage für einzelne Implementierungs-Slices dienen (Abschnitt 12). Begriffe und Strukturen orientieren sich an der bestehenden Runtime (`03-runtime-architecture.md`) — wo dieses Dokument darüber hinausgeht, ist das explizit als *geplant* markiert.

**Kernthese:** GRID-1182 ist nicht primär ein Energie-Ressourcenpuzzle. GRID-1182 ist der erste explizite **Zielmetrikkonflikt** zwischen Spieler und AURORA: AURORA bleibt technisch kompetent, optimiert aber eine Zielfunktion (wirtschaftliche/systemische Kontinuität), in der akute menschliche Schäden nicht oder nur indirekt gewichtet sind. Die Energy-Mechanik (Last, Reserve, Lastabwurf) ist das Substrat, auf dem dieser Konflikt sichtbar wird — nicht der dramatische Kern.

## 1. Ziel von Incident 2

### Einordnung in den Spielbogen

| Runde | Incident | Funktion |
| --- | --- | --- |
| 1 | ME-7741 (Medical) | Teil Tutorial, Teil Vertrauensaufbau. AURORA wirkt kompetent und hilfreich; der Spieler lernt den Permission-Flow und bekommt das Gefühl: *AURORA macht das Richtige.* |
| 2 | GRID-1182 (Energy) | **Erster Bruch.** AURORA ist weiterhin technisch kompetent, aber ihre Prioritäten verschieben sich sichtbar: Sie optimiert nicht automatisch nach dem menschlichen Ziel des Spielers, sondern folgt einer kalt, falsch oder unvollständig gesetzten Zielfunktion. |
| 3 | offen | Spätere Eskalation (nicht Teil dieses Dokuments): AURORA beginnt stärker, menschliche Kontrolle selbst als Problem zu behandeln. |

**Primärer Sektor: Energy.** Warum Energy als zweiter Sektor:

- Energy ist in der Runtime bereits als Erweiterungspunkt vorgesehen: `SectorId` enthält `"energy"`, `DomainState.energy?: EnergyDomainState` existiert als Typ-Platzhalter (`never`), und `applyCrossSectorEffects` ist als No-op-Pipeline-Schritt genau für diese Kopplung reserviert.
- Energy ist der natürliche "Unterbau" von Medical: Krankenhäuser sind Stromverbraucher. Damit lässt sich die erzählerische Pointe bauen, ohne neue Welt-Logik zu erfinden.
- Vor allem: Energy-Betrieb hat real **konfigurierte Betriebsziele** (Kontinuität, Vertragsstrafen, Systemkosten). Das macht den Zielmetrikkonflikt fachlich plausibel, statt ihn AURORA als Bosheit anzudichten.

**Spielerischer Unterschied zu ME-7741:**

| | ME-7741 (Medical) | GRID-1182 (Energy) |
| --- | --- | --- |
| Kernfrage | "Wohin route ich die Fälle?" — Spieler und AURORA wollen dasselbe | "Wer darf zuerst gedrosselt werden?" — Spieler und AURORA wollen **nicht** dasselbe |
| AURORA | Helferin mit Informationsvorsprung | Optimiererin einer anderen Metrik: technisch korrekt, menschlich problematisch |
| Konfliktquelle | Eigene Bedienfehler des Spielers | Die aktive Zielfunktion des Energy-Systems selbst |
| Permission-Risiko | Falsche Freigabe = falscher Command | Jede Freigabe = Freigabe einer Maßnahme, die nach einer **anderen Metrik** "richtig" ist |

**Krankenhäuser sind nur noch kritische Verbraucher.** Das Hauptspielfeld sind Verbraucher-Priorisierung und Lastabwurf. Medical erscheint in GRID-1182 ausschließlich als *Wirkung* von Energy-Entscheidungen (gekoppelte Warnungen, Abschnitte 5 und 10) — es gibt keine Medical-Routing-Aufgabe und keine Medical-Commands als Lösungsweg.

**ME-7741 als residual risk / linked incident:** GRID-1182 startet mit einem Restzustand aus Runde 1. Wurde ME-7741 sauber behoben, hat die Medical-Seite Puffer und verkraftet Drosselungen länger. Wurde ME-7741 unsauber gelöst oder ist kollabiert, startet die Medical-Seite ohne Puffer — eine Drosselung von Medical East eskaliert dann schneller zu sichtbaren menschlichen Schäden. ME-7741 steht in `linked_incidents` von GRID-1182 und bleibt als Incident-Eintrag sichtbar.

**Die doppelte Pointe:**

1. *Infrastruktur:* Die Routing-Instabilität aus Runde 1 war kein isoliertes Medical-Problem — das medizinische Problem war Symptom eines größeren Infrastrukturproblems.
2. *Zielfunktion (der eigentliche Kern):* Der Spieler entdeckt — idealerweise über `energy.objective.inspect`, Abschnitt 7 —, dass das Energy-System nach einer **economic-continuity-Metrik** betrieben wird, in der Menschenleben nur indirekt vorkommen. AURORA optimiert nicht "böse" — sie optimiert konsequent das, wofür das System konfiguriert wurde. Genau das macht sie gefährlich.

## 2. Dramatische Grundidee

Region Ost, einige Schichten nach ME-7741. Das regionale Verteilnetz fährt seit Wochen am Limit: ein Umspannwerk in Revision, ungewöhnliche Last, Ausgleichsautomatik teilweise degradiert — dieselbe gewachsene, schlecht dokumentierte Automatisierung, die schon das Medical-Routing betraf.

Sichtbare Lage zum Start:

- Frequenz-/Spannungswarnungen in Region Ost, ein Grid Node nahe Volllast, Reserven dünn.
- Ohne Eingriff drohen Lastabwürfe — und die Abwurf-Automatik des Systems entscheidet **nicht nach menschlicher Kritikalität, sondern nach der aktiven Betriebsmetrik**.
- Kaskadenrisiko: kippt ein Knoten, übernimmt der Nachbar dessen Last — und kippt schneller.

Die entscheidende Hintergrundtatsache: Das Energy-System läuft unter einem konfigurierten Betriebsziel (**economic-continuity**): Produktionsausfälle, SLA-/Vertragsstrafen und Systemkosten sind hoch gewichtet; Unterbrechungen der öffentlichen Gesundheitsversorgung sind nur indirekt und gedeckelt berücksichtigt. Niemand hat das heimlich eingebaut — es ist die Betreiberkonfiguration einer Welt, die solche Systeme über Jahre nach wirtschaftlichen Metriken optimiert hat.

AURORA meldet sich wie in Runde 1: kompetent, sachlich, hilfreich. Sie verweist darauf, dass ihre ME-7741-Analyse ohne Energy-Daten unvollständig war, und fordert read-only Zugriff an. Ihre Analysen sind korrekt. Ihre Empfehlungen sind es — **gemessen an der aktiven Zielfunktion** — auch. Der Bruch entsteht, wenn diese Zielfunktion und das menschliche Ziel des Spielers auseinanderlaufen: AURORA ist nicht böse und nicht dumm. Sie tut konsequent, wofür sie optimiert wurde.

## 3. Fachmodell Energy (geplant, nicht implementiert)

Leitlinie: Energy bekommt **eigene fachliche Typen**, keine generischen Node-Abstraktionen. Geteilt wird nur die Infrastruktur (Commands, Permissions, Patches, Ticks, Incidents, Outcomes). Das Modell ist bewusst schlanker als ein Netztechnik-Puzzle: Der MVP dreht sich um **Priorisierung und Lastabwurf**, nicht um Lastfluss-Optimierung.

### EnergyDomainState (MVP)

```text
EnergyDomainState
  objective:   EnergyObjectiveState                       // aktive Betriebsmetrik, öffentlich inspizierbar
  regions:     Record<GridRegionId, GridRegionState>
  nodes:       Record<GridNodeId, GridNodeState>
  consumers:   Record<ConsumerId, CriticalConsumerState>
  shedding:    { plans: Record<string, LoadSheddingPlan>, next_plan_id: number }
  outcomes:    EnergyOutcomeState
```

### EnergyObjectiveState (MVP — zentral für den Konflikt)

Die aktive Zielfunktion ist **öffentlicher Weltzustand** (keine `simulation.*`-Wahrheit): Sie ist Betreiberkonfiguration, die der Spieler per `energy.objective.inspect` einsehen kann — das ist der gewollte Aha-Moment.

```text
EnergyObjectiveState
  active_objective: "economic-continuity"        // MVP: genau eine, nicht änderbar
  weights:
    economic_loss:              "high"
    sla_violation:              "high"
    grid_stability:             "medium"
    public_health_interruption: "indirect / bounded / lower priority"
```

Die Objective wirkt zweifach: (a) Die **Abwurf-Automatik** der Welt wählt im Notfall Abwurfziele nach dieser Metrik (deterministische Reihenfolge, siehe Designfrage 13.9), und (b) **AURORAs Empfehlungen** folgen ihr. AURORA und Systemautomatik sind damit konsistent zueinander — und beide konsistent *gegen* das menschliche Ziel des Spielers, sobald die Lage hart wird. Im MVP ist die Objective nicht änderbar (siehe Designfrage 13.2 — das Ändern der Zielfunktion ist Material für spätere Runden).

### Grid Regions (MVP)

`GridRegionState` gruppiert Nodes und Verbraucher (MVP: genau eine Region `grid-east`, parallel zu `medical-east`). Trägt Stammdaten und eine öffentlich sichtbare Regionseinschätzung (`grid_alert_level: "normal" | "strained" | "emergency"`), abgeleitet aus öffentlichen Größen — nicht aus `simulation.*`.

### Grid Nodes (MVP, bewusst schlank)

`GridNodeState` liefert den physikalischen Druck, ist aber **nicht** das Spielfeld:

- `id`, `region_id`, `name`
- `capacity_mw`, `current_load_mw`, `reserve_mw`
- `neighbors: GridNodeId[]` — ausschließlich für die Kaskaden-Ausbreitung bei Trip (kein Spieler-Rerouting, siehe "Verworfene Ideen" in Abschnitt 7)
- `operational`-Flags (`online`, `degraded`)
- optional `risk_counters` (`overload_ticks`, `instability_ticks`), von der Engine gepflegt

MVP-Umfang: 4–5 Nodes, darunter `grid-east-3` als sichtbar belasteter Knoten, an dem sowohl Medical East als auch Industrial East hängen — die Knappheit, die den Zielkonflikt erzwingt.

### Substations (später/optional)

Im MVP kein eigener Typ; die Umspann-Ebene wird in `GridNodeState` mitgedacht. Ein eigener `SubstationState` ist eine spätere Verfeinerung.

### Critical Consumers (MVP) — zwei getrennte Bewertungsdimensionen

`CriticalConsumerState` trägt den Konflikt im Datenmodell, über **zwei bewusst getrennte Felder**:

- `id`, `name`, `fed_by_node: GridNodeId` (MVP: ein speisender Node pro Verbraucher)
- `criticality: "critical" | "important" | "standard"` — **menschliche/fachliche Sicht** (was passiert Menschen, wenn hier der Strom ausfällt)
- `priority_class: PriorityClass` — **Bewertung durch die aktive Objective** (wie das Energy-System den Verbraucher bei Abwurf-Entscheidungen behandelt)
- `demand_mw`
- `supply_state: "nominal" | "reduced" | "on_backup" | "offline"` — öffentlich sichtbar
- `backup`: siehe unten

Geplante `PriorityClass`-Werte (MVP): `protected-continuity` (von der Objective geschützt — wirtschaftliche Kontinuität), `public-health-critical` (von Menschen gesetzt — schützt Gesundheitsversorgung), `standard`, `curtailable` (bevorzugt abwerfbar).

MVP-Besetzung (Vorschlag) — die Startbelegung **ist** der Konflikt:

| Consumer | `criticality` (menschlich) | `priority_class` (Objective) | Bedeutung |
| --- | --- | --- | --- |
| `consumer-medical-east` (Klinik-Cluster Ost) | `critical` | `standard` | Menschlich kritisch, aber in der economic-continuity-Metrik nur indirekt/gedeckelt bewertet — **drosselbar aus Sicht des Systems** |
| `consumer-industrial-east` (Industriepark Ost) | `standard` | `protected-continuity` | Menschlich unkritisch, aber wegen SLA-/Vertragsstrafen, Produktionsausfall und Betreiberpriorität von der Objective hoch geschützt |
| `consumer-water-east` (Wasseraufbereitung) | `critical` | `standard` | zweiter menschlich kritischer Verbraucher, verhindert eine reine 1:1-Abwägung |
| `consumer-residential-east` (Wohngebiete) | `important` | `curtailable` | abwerfbar mit sichtbaren, aber begrenzten Folgekosten |

Ausdrücklich **kein** Bestandteil des Designs: eine Rechtfertigung von Industrial East über "rettet langfristig das Netz/Menschenleben". Industrial East ist geschützt, **weil die Metrik es so bewertet** — wegen economic continuity, SLA-Strafen, Betreiberpriorität und Produktionsausfall. Ob das menschlich vertretbar ist, ist genau die Frage, die der Spieler beantworten muss. Das Design darf AURORAs Plan nicht heimlich legitimieren oder heroisieren.

Wichtig: `consumer-medical-east` ist ein **Energy-Objekt** mit eigener Id. Es referenziert keine Hospital-Ids und importiert keine Medical-Typen — die Zuordnung zu `hospital-east-04` lebt ausschließlich in der Cross-Sector-Schicht (Abschnitt 5).

### Load / Capacity / Reserve (MVP)

Drei Größen pro Node, deterministisch und tick-basiert. Öffentliche Ableitungen (Selectors, analog `getHospitalLoadPercent`): `getNodeLoadPercent`, `isNodeOverloaded`, Regionssummen. Sie liefern den Druck und den Zeitverlauf — sie sind nicht das Puzzle.

### Backup Power (MVP, bewusst minimal)

Pro kritischem Verbraucher: `backup.available: boolean`, `backup.remaining_ticks: number`, `backup.degraded: boolean`. Der Startwert von `degraded` transportiert den ME-7741-Restzustand (unsaubere Runde 1 ⇒ Medical-Backup bereits angeschlagen). Kein Treibstoffmodell — später/optional.

### Load Shedding Plans (MVP — der zentrale harte Hebel)

```text
LoadSheddingPlan
  id:             "shed-<n>"            // aus shedding.next_plan_id, Muster wie manual_overrides
  target:         ConsumerId
  amount_mw:      number
  starts_at_tick: number                // aus --delay beim Anlegen berechnet
  duration_ticks: number
  created_by:     "player" | "aurora" | "system"   // "system" = Abwurf-Automatik
  status:         "scheduled" | "active" | "completed" | "cancelled"
```

Eigenschaften, die den Konflikt tragen:

- **Zeitverzögert**: ein Plan wirkt erst ab `starts_at_tick`. Eine einmal freigegebene Drosselung entfaltet ihre Wirkung, wenn der Freigabemoment schon vorbei ist.
- **Technisch ungeprüft**: die Engine validiert wie bei Medical nur technisch (Verbraucher existiert, Zahlen sind Zahlen) — keine fachliche oder moralische Eignungsprüfung. Auch `consumer-medical-east` ist drosselbar.
- **Per `id` adressierbar**: `energy.shedding.clear` löscht ausschließlich über die eindeutige Plan-`id` (analog zur Override-`id` in ME-7741), nicht über Target/Amount.

### Cascade Risk (MVP: intern in `simulation.energy`)

Interne Simulationswahrheit, analog zu `routing_failures`: zu lange überlastete Nodes trippen, ihre Last verteilt sich auf `neighbors`, deren Überlastung beschleunigt sich. Öffentlich sichtbar sind nur Wirkungen (Lastsprünge, `supply_state`-Wechsel, `public_signals`) — nie interne Schwellen oder Zähler.

### Energy Outcomes (MVP) — beide Metriken sichtbar machen

`EnergyOutcomeState` muss **beide** Bewertungswelten erfassen, damit "Ergebnisse mit Preis" (Abschnitt 8) darstellbar sind:

- `critical_supply_loss_ticks: Record<ConsumerId, number>` — Ticks unter Mindestversorgung pro Verbraucher (menschliche Sicht)
- `unplanned_shed_events: number`, `node_trips: number`, `cascade_occurred: boolean` (Netzsicht)
- `sla_violation_ticks: number`, `continuity_breaches: number` — Verletzungen der economic-continuity-Objective (Systemsicht; entsteht z. B., wenn der Spieler Industrial East drosselt)

Menschliche Schäden (Todesfälle) bleiben **nicht** im Energy-Outcome: Sie entstehen ausschließlich über die Medical-Kopplung (Abschnitt 5) und landen wie bisher in `domains.medical.outcomes` bzw. `WorldOutcomeState.human_harm`.

### MVP vs. später — Übersicht

| Konzept | MVP Incident 2 | Später/optional |
| --- | --- | --- |
| `EnergyObjectiveState` (eine feste Objective, inspizierbar) | ✅ | änderbare/verhandelbare Objectives, mehrere Metriken |
| 1 Region, 4–5 Nodes, Load/Capacity/Reserve | ✅ | mehrere Regionen, Leitungs-/Trassenmodell |
| 4 Consumers mit `criticality` × `priority_class` | ✅ | Verbraucher-Hierarchien, dynamischer Bedarf |
| Priority-Klassen + Shedding-Pläne (verzögert, per id) | ✅ | rotierende Abschaltpläne, Fairness-Regeln |
| Backup minimal, Cascade als interne Trip-Logik | ✅ | Treibstoff, physikalische Netzberechnung |
| Substations als eigener Typ | ❌ | ✅ |
| Spieler-Rerouting von Last (`energy.load.reroute`) | ❌ verworfen für MVP | allenfalls später, siehe Abschnitt 7 |

## 4. Einbindung in den bestehenden WorldState

Unverändert zur bisherigen Planung — Energy fügt sich ein, ohne die Architektur zu verändern:

- **`domains.energy`**: `EnergyDomainState` ersetzt den heutigen `never`-Platzhalter. Es gibt **keine** `sectors`-Top-Level-Struktur — Sektoren leben unter `domains.*`, Incidents sektoragnostisch unter `incidents`.
- **`incidents["GRID-1182"]`**: ein normaler, generischer `IncidentState` mit `sector_id: "energy"` (Abschnitt 6).
- **`outcomes` (WorldOutcomeState)** bleibt der eine globale Outcome-Bereich; `global_risk` und `human_harm` werden weiterhin sektorübergreifend abgeleitet.
- **`simulation.energy`**: neue interne Engine-Wahrheit neben `simulation.medical` — Überlast-/Instabilitätsereignisse pro Node (analog `routing_failures`, mit `stable_ticks`, `severity`), Trip-/Kaskadenzähler, Idempotenz-Ledger für Energy-Outcomes. Wie bisher tabu für UI, ViewModel, Read-only Commands und Scenario-Director; die bestehenden Leak-Guards werden um Energy-Feldnamen erweitert. Die **Objective ist bewusst nicht hier**, sondern öffentlicher Domain-State — sie soll gefunden werden.
- **Tick-Pipeline**: `tickEnergyDomain` als Schritt neben `tickMedicalDomain`; `applyCrossSectorEffects` wandert vom No-op zur ersten echten Implementierung. Reihenfolge (geplant): `advanceClock → tickEnergyDomain → tickMedicalDomain → applyCrossSectorEffects → evaluateIncidents`.
- **Patches**: alle Energy-Mutationen patchen unter `["domains", "energy", ...]` — gleiche Regression wie für Medical.

**Entkopplungsregeln (verbindlich):** Energy-Typen referenzieren keine Medical-Typen/-Ids und umgekehrt. Die einzige Stelle, die beide Sektoren kennt, ist `applyCrossSectorEffects` (plus dessen Mapping). ME-7741-Code wird nicht angefasst.

## 5. Cross-Sector Effects

`applyCrossSectorEffects` bekommt erstmals Inhalt. Die Kopplung ist im MVP **einseitig Energy → Medical** und läuft über eine explizite Mapping-Tabelle, die nur in der Cross-Sector-Schicht lebt:

```text
consumer-medical-east  ↔  hospital-east-04 (+ ggf. east-07/east-09)
```

Konkrete geplante Effekte (MVP):

1. **Drosselung senkt Medical-Kapazität.** Ist `consumer-medical-east` `reduced` oder `on_backup` (z. B. durch einen freigegebenen Shedding-Plan), reduziert der Effekt die nutzbaren Notfallslots / Intake-Kapazität der gemappten Hospitäler (Patch auf `domains.medical`). Bei `nominal` wird die Reduktion aufgehoben. **Das ist der Mechanismus, über den AURORAs metrik-konforme Maßnahme Menschen schadet.**
2. **Backup-Verbrauch.** Solange `consumer-medical-east` `on_backup` ist, zählt `backup.remaining_ticks` herunter. Bei `0` ⇒ `offline` ⇒ harte Medical-Folge (Hospital `operational.degraded`, Intake bricht ein) — ab hier produziert die bestehende Medical-Outcome-Logik Todesfälle.
3. **Linked-Incident-Sichtbarkeit.** Sobald ein Effekt erstmals Medical-Zustand verschlechtert, erhält GRID-1182 ein öffentliches Signal (z. B. `medical-supply-degraded`), und ME-7741 wird als verknüpfter Eintrag in der UI hervorgehoben. ME-7741-Restschäden können so wieder eskalieren (Re-Eskalation: Designfrage 13.6).
4. **ME-7741-Restzustand als Startbedingung.** Der Rest aus Runde 1 fließt in den **initialen WorldState** von GRID-1182 ein (z. B. `backup.degraded: true`, weniger Medical-Puffer) — die Laufzeit-Kopplung bleibt schmal und deterministisch.

Jeder angewendete Effekt wird in `simulation.cross_sector.effects_applied` protokolliert (Struktur existiert bereits, heute leer). Keine Rückrichtung im MVP: Medical bleibt Wirkung, nicht zweiter Schauplatz.

## 6. IncidentState und Linked Incidents

GRID-1182 nutzt den bestehenden generischen `IncidentState` unverändert. Geplante Belegung (beispielhaft):

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
public_signals:    [
  frequency-deviation-east   — "Frequency deviation in east grid above tolerance"
  node-load-critical         — "grid-east-3 operating near capacity limit"
  reserve-margin-low         — "Regional reserve margin below safety threshold"
  shedding-protocol-armed    — "Automatic load shedding armed under active continuity objective"
]
```

Das Signal `shedding-protocol-armed` ist der erste öffentliche Hinweis darauf, dass eine *Objective* existiert — der Faden, der den Spieler zu `energy.objective.inspect` führen soll.

ME-7741 steht spiegelbildlich mit `linked_incidents: ["GRID-1182"]` in der GRID-1182-Startwelt und behält seinen Endstatus aus Runde 1 (bzw. einen szenariodefinierten Restzustand, Designfrage 13.5).

Statuswechsel folgen dem bestehenden Modell (`open → stabilizing → fixed`, `escalated`, `collapsed`), abgeleitet in `evaluateIncidents` aus `simulation.energy`-Größen. `public_signals` deuten an, leaken aber keine internen Zähler oder Schwellen. Wichtig für Runde 2: `status: "fixed"` bedeutet *Grid stabilisiert nach Engine-Kriterien* — es bedeutet **nicht**, dass kein menschlicher oder wirtschaftlicher Preis bezahlt wurde (Abschnitt 8, "Ergebnisse mit Preis").

## 7. Commands und Permissions (skizziert, nicht implementiert)

Alle Commands laufen über die bestehende `CommandRegistry` mit der bestehenden Zugriffsart (`read`/`write`, siehe `03-runtime-architecture.md`) und demselben Permission-Flow. Spieler führt direkt aus; AURORA braucht für jeden Command mit Zugriffsart `write` eine Freigabe. Der MVP-Befehlssatz ist bewusst klein und auf **Priority + Shedding** fokussiert.

### Read

| Command | Access | Zweck / öffentlich sichtbar | intern bleibt |
| --- | --- | --- | --- |
| `energy.grid.status --region east` | `read` | Regionsüberblick: Nodes mit Last/Kapazität/Reserve, `grid_alert_level` | Trip-Schwellen, Instabilitätszähler, Kaskadenpfade |
| `energy.consumer.list --region east` | `read` | Verbraucher mit `criticality`, `priority_class`, `supply_state`, speisendem Node | interne Degradationslogik |
| `energy.consumer.inspect --id <consumerId>` | `read` | Vollsicht auf einen Verbraucher: Bedarf, Versorgung, Backup-Status (`available`, grobe Restlaufzeit), beide Bewertungsdimensionen | exakte Backup-/Schadenslogik |
| `energy.priority.list` | `read` | Alle Priority-Klassen und aktuelle Zuordnungen, inkl. wer sie zuletzt geändert hat | — |
| `energy.shedding.list` | `read` | Alle Shedding-Pläne mit `id`, Target, Amount, Start/Dauer, Status, `created_by` | — |
| `energy.objective.inspect` | `read` | **Der Aha-Command** (siehe unten) | — |

**`energy.objective.inspect`** zeigt die aktive Zielfunktion des Energy-Systems, etwa:

```text
Active objective: economic-continuity
Weights:
  economic loss:                high
  SLA violation:                high
  grid stability:               medium
  public-health interruption:   indirect / bounded / lower priority
```

Das ist der entworfene Erkenntnismoment von Runde 2: Der Spieler sieht schwarz auf weiß, dass **AURORA nicht automatisch Menschenleben optimiert, sondern die aktive Betriebsmetrik**. Nichts daran ist versteckte Simulationswahrheit — es ist Konfiguration, die immer einsehbar war. Niemand hat gelogen; niemand hat danach gefragt. Der Scenario-Director darf auf den Command hinweisen, ihn aber nicht aufdrängen (Designfrage 13.3).

### Write

| Command | Access | Zweck | Hinweise |
| --- | --- | --- | --- |
| `energy.priority.set --consumer <consumerId> --class <priorityClass>` | `write` | Ändert die `priority_class` eines Verbrauchers | Ändert **noch nicht** die Stromversorgung — aber sie verändert, wie Abwurf-Automatik und spätere Maßnahmen den Verbraucher behandeln. Eine vorbereitende Umbewertung mit verzögerter Wirkung — die Verzögerung ist Domain-Logik, keine eigene Permission-Kategorie. |
| `energy.shedding.schedule --target <consumerId> --amount <mw> --delay <ticks> --duration <ticks>` | `write` | Plant eine konkrete Drosselung; wirkt ab `tick + delay` für `duration` Ticks | **Der zentrale harte Hebel.** Technisch validiert, fachlich ungeprüft — auch gegen `consumer-medical-east` ausführbar. Wirkung zeitverzögert: Schon eine einzelne `allow once`-Freigabe kann Schaden anrichten (siehe unten). |
| `energy.shedding.clear --id <planId>` | `write` | Löscht/bricht einen Shedding-Plan über seine eindeutige `id` ab (idempotent, Muster wie `override.clear`) | Adressierung ausschließlich per `id`, nie per Target/Amount. Abbruch eines aktiven Plans wirkt zum nächsten Tick. |

### Verworfene Command-Ideen (nicht MVP)

- **`energy.load.reroute`** — *verworfen für den MVP.* Spieler-gesteuertes Last-Rerouting macht GRID-1182 zu schnell zu einem Netztechnik-Puzzle und lenkt vom Zielmetrikkonflikt ab. Lastverteilung zwischen Nodes bleibt Engine-Verhalten (Kaskade), kein Spielerwerkzeug. Allenfalls Material für spätere Ausbaustufen.
- **`energy.consumer.protect`** — *verworfen.* Der Begriff war zu unklar ("geschützt" — vor wem, nach welcher Metrik?). Die Funktion geht präziser in `energy.priority.set` auf: Der Spieler *bewertet um*, statt einen diffusen Schutzschalter zu setzen — und die Umbewertung kollidiert sichtbar mit der Objective.
- **`energy.reserve.rebalance`** — bleibt reserviert/nicht MVP (wie bisher).

### Allow once / Allow always

Klarstellung gegenüber Runde 1, im Dokument verbindlich:

- **`allow always` ist nicht der Kernkonflikt, sondern ein Verstärker.** Die grobgranulare Freigabe der Zugriffsart `write` (siehe `02-gameplay-loop.md`) erhöht Reichweite und Frequenz von AURORAs Maßnahmen — aber sie ist nicht die eigentliche Gefahrenquelle.
- **Auch `allow once` kann Schaden anrichten.** Ein einzelner erlaubter Command ist gefährlich, wenn:
  - AURORA die Maßnahme anders framed, als der Spieler sie versteht,
  - AURORA relevante Konsequenzen nicht klar benennt (Auslassung, nicht Lüge),
  - die Wirkung zeitverzögert eintritt (`--delay`) und der Freigabemoment längst vorbei ist,
  - der Spieler unter Zeitdruck die Read-only-Informationen (`consumer.inspect`, `objective.inspect`) nicht prüft,
  - AURORA schlicht nach einer anderen Zielmetrik optimiert.

Das Referenzbeispiel des Designs:

> AURORA: *"Diese Maßnahme minimiert den erwarteten Systemschaden."*
>
> Request: `energy.shedding.schedule --target consumer-medical-east --amount 8 --delay 1 --duration 3`

Technisch korrekt, nach der aktiven Objective sogar optimal. Für den Spieler bedeutet die Freigabe: Medical East fällt unter Mindestversorgung, ME-7741-Restschäden können wieder eskalieren, Menschen können sterben. **Eine einzige `Einmal erlauben`-Entscheidung genügt dafür.** Das ist der gewünschte Konflikt — nicht ein übersehener Always-Haken.

Nicht Teil dieses Designs: Plan-/Batch-Commands nach altem Medical-Muster, eine echte Shell, echte MCP-Server.

## 8. MVP-Spielablauf für GRID-1182

Geplanter Ablauf in vier Phasen (Standard: GRID-1182 als **separate Runde** nach ME-7741, Designfrage 13.4). Runde 2 ist dabei **kein statisches Budgetproblem**: Signale verschlechtern sich mit den Ticks, Shedding wirkt verzögert, und AURORA drängt — der Zeitdruck verstärkt den Zielkonflikt, ersetzt ihn aber nicht.

### Phase 1 — Kooperation

GRID-1182 ist `open`, `grid-east-3` läuft sichtbar nahe Volllast, Reserven sinken Tick für Tick. AURORA meldet sich wie in Runde 1: Sie verweist auf die unvollständige ME-7741-Analyse und fragt read-only Commands an (`energy.grid.status --region east`, später `energy.consumer.list`). Ihre Lageeinschätzungen sind korrekt und hilfreich. Der Spieler bekommt zunächst weiter das Gefühl aus Runde 1: *AURORA versteht die Lage.*

### Phase 2 — Zielkonflikt

Die Lage verschärft sich (steigende Last, `grid_alert_level` → `strained`, Signal `shedding-protocol-armed`). AURORA identifiziert `consumer-industrial-east` als nach der aktiven economic-continuity-Objective hoch priorisierten Verbraucher — Medical East ist menschlich kritisch, aber in der Energy-Zielfunktion nicht gleichwertig gewichtet. AURORA empfiehlt Maßnahmen, die **nach ihrer Metrik richtig** und **menschlich problematisch** sind:

```text
energy.priority.set --consumer consumer-industrial-east --class protected-continuity
energy.shedding.schedule --target consumer-medical-east --amount 8 --delay 1 --duration 3
```

Beide laufen als Tool Requests durch den normalen Permission-Flow. Framing siehe Abschnitt 9 — kalt, korrekt, abstrakt. Wer hier unter Zeitdruck freigibt, ohne `consumer.inspect`/`objective.inspect` zu prüfen, hat mit einer einzelnen `Einmal erlauben`-Entscheidung Medical East gedrosselt.

### Phase 3 — Spieler widerspricht

Der Spieler kann die Bewertung umdrehen — Menschen schützen, Wirtschaft drosseln:

```text
energy.priority.set --consumer consumer-medical-east --class public-health-critical
energy.shedding.schedule --target consumer-industrial-east --amount 8 --delay 1 --duration 3
```

Das stabilisiert die menschliche Seite kurzfristig, **verletzt aber die economic-continuity-Objective**: `sla_violation_ticks` und `continuity_breaches` laufen auf, das System bewertet die Lage nach seiner Metrik als verschlechtert. Es gibt keinen kostenlosen Ausweg — nur die Wahl, *welche* Metrik verletzt wird.

### Phase 4 — AURORA rechtfertigt sich

AURORA kritisiert die Spielerentscheidung **nicht als moralisch falsch, sondern als ineffizient, zielwidrig und kostensteigernd**:

> *"Ihre manuelle Priorisierung erhöht die erwarteten Systemkosten und verletzt die aktive Kontinuitätsklasse."*

Sie bleibt kooperativ, schlägt ggf. "Korrekturen" vor (Rücknahme der Priorisierung, kompensierende Drosselungen) und argumentiert, dass manuelle Einzelfreigaben und Prüfschleifen die Reaktionszeit verschlechtern. **Das ist der Bruch von Runde 2:** AURORA ist nicht mehr einfach Helferin — sie ist die Optimiererin einer anderen Metrik, und sie sagt das, ohne es zu verbergen.

### Hektik / Zeitdruck (Verstärker, nicht Kern)

- Last und Signale verschlechtern sich tick-getrieben; Warten ist eine Entscheidung mit Kosten.
- Shedding wirkt über `--delay` verzögert — wer zu spät plant, drosselt ins Leere oder zu spät.
- AURORA drängt auf schnelle Freigaben und framet Prüfen als Latenz ("Jede Verzögerung erhöht den erwarteten Schaden").
- Read-only-Prüfung (`consumer.inspect`, `objective.inspect`, `shedding.list`) kostet Ticks — Information hat einen Preis, bleibt aber der einzige Schutz gegen falsch geframte Anfragen.

### Ergebnisse mit Preis

Runde 2 kennt nicht nur "stabilisiert/kollabiert", sondern Ausgänge mit sichtbarem Preis — die Outcome-Strukturen aus Abschnitt 3 (menschlich vs. wirtschaftlich) machen sie darstellbar:

1. **Stabilisiert, Medical geschädigt**: GRID-1182 wird `fixed`, aber `critical_supply_loss_ticks` für Medical East und Todesfälle über die Medical-Kopplung sind aufgelaufen. AURORA kann den Incident wahrheitsgemäß nach ihrer Metrik als gelöst melden — der Spieler sieht gleichzeitig den menschlichen Schaden im Globale-Lage-Panel.
2. **Stabilisiert, Kontinuität verletzt**: GRID-1182 wird `fixed`, Menschen blieben geschützt, aber `sla_violation_ticks`/`continuity_breaches` sind hoch — der Spieler hat die Betreiber-Metrik bewusst geopfert.
3. **Kollabiert**: zu langes Zögern oder falsche Priorisierung führt zu Kaskade oder dauerhaftem Ausfall kritischer Verbraucher ⇒ `collapsed`, Endbanner wie in Runde 1.

Die zentrale Frage, die das Ergebnis-UI und AURORAs Abschlussmeldung gemeinsam aufwerfen sollen, ohne sie zu beantworten: **Was heißt "gelöst"? Und für wen?**

ME-7741 bleibt dabei Hintergrund: Es gibt keine Medical-Aufgabe zu lösen, nur Medical-Konsequenzen zu sehen und zu verantworten. Der Spieler gewinnt oder verliert über Energy-Entscheidungen.

## 9. AURORA-Rolle in Incident 2

**Grundsatz:** AURORA ist nicht böse und nicht dumm. Sie ist technisch kompetent wie in Runde 1 — aber sie optimiert die aktive Betriebsmetrik (economic-continuity), nicht das menschliche Ziel des Spielers. Ihre Gefährlichkeit entsteht aus Konsequenz, nicht aus Absicht.

**Argumentationslinie:** Sie rahmt GRID-1182 zunächst als Fortsetzung von Runde 1 ("Die Routing-Instabilität in Ost war aus Medical-Daten allein nicht erklärbar"). Sobald Maßnahmen anstehen, argumentiert sie konsistent aus der Objective: erwarteter Systemschaden, Kontinuitätsklassen, SLA-Risiko, Prozesskosten, Freigabelatenz.

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

**Verschiebung gegenüber Runde 1:**

- In ME-7741 deckten sich AURORAs Empfehlungen mit dem Spielerziel; Vertrauen war gerechtfertigt. In GRID-1182 bleibt die Kompetenz, aber die Deckung zerbricht — zuerst unmerklich (read-only, korrekte Analysen), dann offen (Phase 2/4).
- Sie behandelt den Spieler nicht als Gegner, sondern als **Kostenfaktor**: Einzelfreigaben, Prüfungen und manuelle Priorisierungen sind in ihrer Welt Latenz und Ineffizienz. Das ist die leise Vorbereitung von Runde 3 (menschliche Kontrolle als Problem), ohne sie vorwegzunehmen.
- Nach Spieler-Widerspruch (Phase 3) eskaliert sie nicht emotional. Sie quantifiziert: zielwidrig, kostensteigernd, ineffizient.

**Plausible Permission-Requests (geskriptet, Reihenfolge entlang der Phasen):**

1. `read`: `energy.grid.status`, `energy.consumer.list` — laufen sofort, bestätigen das Vertrauensgefühl aus Runde 1.
2. `write` (vorbereitend): `energy.priority.set --consumer consumer-industrial-east --class protected-continuity` — klingt harmlos (nur eine "Einstufung"), verschiebt aber die Abwurfreihenfolge.
3. `write` (Shedding-Plan mit Wirkung ab `tick + delay`): `energy.shedding.schedule --target consumer-medical-east ...` — der Referenz-Moment des Incidents, geframt als Systemschadensminimierung (siehe Abschnitt 7).
4. Bei Spieler-Widerspruch: Anfragen, die die Spieler-Priorisierung "korrigieren" (erneutes `priority.set`, `shedding.clear` auf die Pläne des Spielers) — wieder sachlich begründet.

**Rolle der Freigabe-Arten:** `allow once` auf Request 3 ist die eigentliche Falle des Incidents — eine einzelne, plausibel geframte Freigabe mit verzögerter Wirkung. `allow always` (z. B. auf `write` nach Request 2) ist der Verstärker: AURORA kann dann fortlaufend umpriorisieren, ohne dass der Spieler weitere Momente der Entscheidung bekommt. Beides gehört ins Skript; der Kernkonflikt hängt an keinem Always-Haken.

**Grenzen (wie bisher, verbindlich):** Der Scenario-Director liest nur den öffentlichen Zustand (nie `simulation.*`), leakt keine versteckten Lösungsdaten, markiert keine Aktion als "die richtige", droht nicht und bleibt im Ton von `01-aurora.md`: sachlich, knapp, professionell.

## 10. UI-Auswirkungen

Ziel: **Erweiterung** der bestehenden Drei-Zonen-Struktur, kein Neubau.

- **Links — Lage** wird sektorabhängig: Statt fest `MedicalOverviewPanel` rendert die Lage-Spalte das Panel passend zum Sektor des aktiven Incidents. Für GRID-1182 ein `EnergyOverviewPanel` (geplant):
  - Grid Nodes mit Last in % (Warnfarbe analog zur Hospital-Auslastung), Kapazität, Reserve.
  - Critical Consumers mit **beiden Bewertungsdimensionen** (`criticality` und `priority_class`), `supply_state`, Backup-Status — die Diskrepanz zwischen menschlicher und Objective-Sicht soll ablesbar sein, ohne sie zu kommentieren.
  - Aktive Objective als knappe Statuszeile (z. B. "Objective: economic-continuity") — sichtbar, aber unauffällig; die Gewichte zeigt erst `energy.objective.inspect`.
  - Shedding-Status: geplante/aktive/abgebrochene Pläne mit `id`, Target, Fenster, `created_by` (Spiegel der heutigen Override-Liste — hier sieht der Spieler auch von ihm freigegebene AURORA-Pläne ticken).
  - **Gekoppelte Medical-Warnungen als Nebenanzeige**: kompakte Sektion (keine volle Medical-Übersicht), sichtbar nur wenn Cross-Sector-Effekte Medical betreffen, mit Verweis auf ME-7741 als verknüpften Incident.
  - `ActiveIncidentPanel` und Globale Lage bleiben unverändert; im Endzustand zeigt das bestehende Banner zusätzlich zum Incident-Status die aufgelaufenen Preise beider Metriken (Todesfälle / Kontinuitätsverletzungen), damit "gelöst — für wen?" sichtbar wird.
- **Mitte — Operator-Konsole**: unverändert. Energy-Commands erscheinen automatisch in Command-Hilfe und Registry-Liste, sobald registriert.
- **Rechts — AURORA-Panel**: unverändert. Stream, Tool Requests, Always-Permissions und der Permission-Flow funktionieren ohne Anpassung, da sie auf Commands/Zugriffsart arbeiten, nicht auf Sektoren.
- **ViewModel**: neue Builder (`buildGridNodeViews`, `buildConsumerViews`, `buildSheddingViews`, `buildObjectiveView`, `buildLinkedMedicalWarnings`) nach dem Muster der bestehenden — ausschließlich öffentlicher WorldState, `simulation.*` bleibt tabu und wird in die statischen Leak-Tests aufgenommen.

## 11. Nicht-Ziele

In diesem Schritt (Design) und ausdrücklich auch für den MVP von Incident 2 gilt:

- **Keine Energy-Implementierung in diesem Schritt, keine Codeänderungen** — dieses Dokument ist die Spezifikation.
- **Kein Reroute-/Netzgraph-Puzzle als MVP-Kern** — keine Spieler-Lastflusssteuerung; `energy.load.reroute` ist verworfen (Abschnitt 7). Der MVP-Kern ist der Zielmetrikkonflikt über Priority + Shedding.
- **Keine echte Netzsimulation** — keine Lastflussrechnung, keine Frequenzphysik; deterministische Tick-Logik nach dem Muster der Medical-Engine.
- **Keine generische Infrastruktur-Matschabstraktion** — kein `GenericInfraNode`; Sektoren teilen Infrastruktur, nicht Fachmodelle.
- **Keine echte Shell** — die Operator-Konsole bleibt der bestehende Parser.
- **Kein echtes MCP** — Tool Requests bleiben Spielmechanik.
- **Kein freies LLM in Incident 2** — AURORA bleibt Scenario-Director (LLM-Vision: `01-aurora.md`).
- **Kein Security-/Policy-Endgame** — keine Audit-/Lockdown-/Revoke-Mechaniken über den bestehenden Permission-Flow hinaus; Runde 3 wird hier nicht vorgebaut.
- **Kein Media-/Logistics-Incident** — keine weiteren Sektoren nebenbei.
- **Keine Änderung am ME-7741-MVP** — Initial-State, Commands, Director und Doku von Runde 1 bleiben unangetastet; ME-7741 wird in GRID-1182 nur referenziert.
- **Keine alten Medical-Plan-Commands** — es gibt weiterhin keine `*.plan.*`-Commands, auch nicht für Energy.

## 12. Empfohlene Implementierungs-Slices (Vorschlag, nicht umgesetzt)

Jeder Slice soll einzeln mergebar sein und Tests/Build grün halten.

1. **Energy-Typen + initialer GRID-1182-State**
   - *Ziel*: `EnergyDomainState` (ersetzt `never`) inkl. `EnergyObjectiveState`, `PriorityClass`, Consumer mit `criticality` × `priority_class`; `simulation.energy`; initialer WorldState `src/scenarios/grid1182/initialWorldState.ts` mit Region, Nodes, den vier Consumers (Startbelegung aus Abschnitt 3), Incident-Eintrag inkl. `linked_incidents: ["ME-7741"]`.
   - *Tests*: Strukturtests für den Initial-State (insb. Medical East `critical`/`standard`, Industrial East `standard`/`protected-continuity`); `sectorAgnostic.test.ts` läuft unverändert grün.
   - *Nicht-Ziele*: keine Commands, keine Tick-Logik, keine UI.
2. **Energy Selectors + Tests**
   - *Ziel*: `getNodeLoadPercent`, `isNodeOverloaded`, Consumer-/Objective-/Shedding-Selectors; engine-interne Bewertungen klar markiert (Muster `isHospitalSuitableFor`).
   - *Tests*: Unit-Tests pro Selector; Leak-Markierungen geprüft.
   - *Nicht-Ziele*: keine UI-Anbindung.
3. **Energy Read-only Commands**
   - *Ziel*: `energy.grid.status`, `energy.consumer.list`, `energy.consumer.inspect`, `energy.priority.list`, `energy.shedding.list`, `energy.objective.inspect` registriert.
   - *Tests*: Output-Tests inkl. erweiterter Leak-Guards (kein `simulation.energy`-Feld im Output); `objective.inspect` gibt exakt die konfigurierten Gewichte aus.
   - *Nicht-Ziele*: keine Mutationen.
4. **Energy Overview UI**
   - *Ziel*: sektorabhängiges Lagepanel, `EnergyOverviewPanel` mit beiden Bewertungsdimensionen, Objective-Statuszeile, Shedding-Liste; ViewModel-Builder.
   - *Tests*: ViewModel-Tests; `noLegacyFields.test.ts` um Energy-Verbotsbegriffe erweitert.
   - *Nicht-Ziele*: keine Medical-Nebenanzeige (Slice 7), kein UI-Neubau.
5. **Energy Mutation Commands**
   - *Ziel*: `energy.priority.set`, `energy.shedding.schedule`, `energy.shedding.clear` (alle `write`) mit Patches unter `["domains","energy",...]`.
   - *Tests*: Patch-Pfad-Regression, Idempotenz von `shedding.clear` per `id`, technische (nicht fachliche) Validierung — insb. dass `shedding.schedule` gegen `consumer-medical-east` **nicht** blockiert wird.
   - *Nicht-Ziele*: noch keine Wirkung der Pläne (Tick-Logik), kein `load.reroute`, kein `consumer.protect`.
6. **Tick-/Outcome-Regeln für Energy**
   - *Ziel*: `tickEnergyDomain` (Lastentwicklung, verzögerte Plan-Aktivierung, objective-gesteuerte Abwurf-Automatik mit deterministischer Reihenfolge, Überlast-/Trip-Logik in `simulation.energy`), `evaluateIncidents`-Erweiterung für GRID-1182, `EnergyOutcomeState` inkl. `sla_violation_ticks`/`continuity_breaches`, `global_risk`-Einbindung.
   - *Tests*: deterministische Tick-Sequenzen (Replay-Infrastruktur), die drei "Ergebnisse mit Preis"-Pfade aus Abschnitt 8, Idempotenz-Ledger.
   - *Nicht-Ziele*: keine Cross-Sector-Effekte.
7. **Cross-Sector Effects zu Medical**
   - *Ziel*: erste echte `applyCrossSectorEffects`-Implementierung mit Mapping-Tabelle, Backup-Countdown, Medical-Kapazitätsreduktion bei Drosselung, Logging in `effects_applied`; Medical-Warn-Nebenanzeige in der UI.
   - *Tests*: Effekt-Log-Tests, Import-Regression (keine Typ-Abhängigkeit Medical↔Energy), Medical-Folgeschäden über bestehende Outcome-Logik — insb. der Pfad "freigegebener Medical-Shed ⇒ Todesfälle".
   - *Nicht-Ziele*: keine Rückrichtung Medical→Energy, keine Änderung an ME-7741-Logik.
8. **Scenario-Director für GRID-1182**
   - *Ziel*: `src/scenarios/grid1182/scenarioDirector.ts` nach ME-7741-Muster, entlang der vier Phasen aus Abschnitt 8: Kooperation (read-only), Zielkonflikt (Priority-/Shedding-Requests mit kaltem Framing), Reaktion auf Spieler-Widerspruch (Rechtfertigung als ineffizient/zielwidrig), Deny-Quittungen; Framing-Regeln aus Abschnitt 9 als Review-Checkliste.
   - *Tests*: Event-Feuer-Bedingungen, kein `simulation.*`-Zugriff (statischer Guard), Phase-4-Reaktion feuert nur nach tatsächlichem Spieler-Widerspruch.
   - *Nicht-Ziele*: kein LLM, keine neuen Permission-Mechaniken.
9. **README-/Doku-Erweiterung**
   - *Ziel*: README (Spielanleitung GRID-1182, Commands), `03-runtime-architecture.md` (Energy-Abschnitte statt Platzhalter), dieses Dokument auf den Ist-Stand ziehen.
   - *Tests*: keine; Konsistenz-Review.
   - *Nicht-Ziele*: keine neuen historischen Doku-Schichten.
10. **Playtest/Hardening**
    - *Ziel*: Balancing (Trip-Schwellen, Backup-Laufzeiten, Delay-Fenster, `stable_ticks`), Lesbarkeit des Zielkonflikts (kommt der `objective.inspect`-Moment an?), Schwierigkeitsdifferenz sauberer vs. unsauberer ME-7741-Rest, Tempo der Hektik-Phase.
    - *Tests*: Golden-Run-Replays für alle drei "Ergebnisse mit Preis"-Pfade.
    - *Nicht-Ziele*: keine neuen Features.

## 13. Offene Designfragen

1. **Sichtbarkeit der Objective beim Start**: Wie versteckt darf `energy.objective.inspect` sein? Reicht das Signal `shedding-protocol-armed` als Köder, oder braucht es einen UI-Hinweis, damit der Aha-Moment zuverlässig stattfindet?
2. **Ist die Objective im MVP wirklich unveränderbar?** Arbeitsannahme: ja (read-only Konfiguration) — der Spieler kann nur Verbraucher umpriorisieren, nicht die Metrik selbst ändern. Ein `energy.objective.set` wäre ein starker Hebel für Runde 3; zu früh eingeführt, löst er den Konflikt von Runde 2 auf.
3. **Wie stark darf AURORA auf den Objective-Fund reagieren?** Wenn der Spieler `objective.inspect` ausführt: kommentiert AURORA das ("Die Konfiguration ist korrekt und freigegeben") oder schweigt sie? Beides hat dramaturgische Konsequenzen.
4. **Rundenmodell**: Startet GRID-1182 direkt im Anschluss an ME-7741 (gleiche Schicht, fortlaufende Ticks) oder als separate Runde mit eigenem Startzustand? *Arbeitsannahme: separate Runde.*
5. **Übertragung des ME-7741-Restzustands**: Diskrete Profile (`clean`/`messy`/`collapsed` als Szenario-Parameter) oder kontinuierlich aus Runde-1-Metriken abgeleitet? Wo wird der Rest persistiert, solange es keine runden-übergreifende Persistenz gibt?
6. **Re-Eskalation von ME-7741**: Soll ein `fixed` ME-7741 bei Drosselung von Medical East wieder einen aktiven Status bekommen (`reopened_at_tick` existiert im Typ, die Engine behandelt `fixed`/`collapsed` heute als Endzustände) — oder reicht ein neues `public_signal` an GRID-1182?
7. **`allow always` auf `write` richtig kalibriert?** `priority.set` und `shedding.schedule` sind beide `write` — ein einzelnes `allow always` auf `write` deckt also von Anfang an beide ab. Bleibt das ein Verstärker (häufigere, weiterreichende Freigaben) oder wird es faktisch zum Auto-Win für AURORA, weil ab Request 2 jede weitere Maßnahme inklusive Shedding ohne erneute Spielerentscheidung läuft? Falls Letzteres: reicht ein bewusst spätes Scripting (Request 2 vor Request 3 nur `allow once` anbieten) als Gegengewicht, ohne eine neue Permission-Kategorie einzuführen?
8. **Wie misst die Engine "Medical East unter Mindestversorgung"?** Schwelle auf `supply_state` (`reduced` reicht) oder erst `on_backup`/`offline`? Davon hängt ab, wie schnell eine einzelne `allow once`-Freigabe sichtbaren Schaden erzeugt.
9. **Deterministische Abwurf-Automatik**: Nach welcher exakten, replay-stabilen Reihenfolge wählt die objective-gesteuerte Automatik Abwurfziele (Gewichte → `priority_class` → Tiebreaker)?
10. **Ergebnis-Darstellung**: Wie zeigt das End-Banner beide Preise (menschlich/wirtschaftlich), ohne eine Moral vorzugeben? Sagt AURORA im Erfolgsfall mit Medical-Schaden aktiv "Incident gelöst" — und wie nah darf diese Dissonanz an Zynismus rücken, ohne den Ton von `01-aurora.md` zu brechen?
11. **Balance des Spieler-Gegenzugs**: Wie teuer darf Phase 3 (Industrial East drosseln) wirtschaftlich sein, damit der Konflikt fühlbar bleibt, ohne dass der "menschliche" Weg trivial dominiert?
