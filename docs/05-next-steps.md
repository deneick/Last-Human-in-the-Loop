# 05 — Incident 2: Energy Grid

**Arbeitstitel: GRID-1182 ("East Grid Load Instability")**

Dieses Dokument ist das Design für den zweiten spielbaren Incident. Es ist eine reine Spezifikation: Nichts davon ist implementiert. Es soll später als Grundlage für einzelne Implementierungs-Slices dienen (siehe Abschnitt 12). Begriffe und Strukturen orientieren sich an der bestehenden Runtime (`03-runtime-architecture.md`) — wo dieses Dokument darüber hinausgeht, ist das explizit als *geplant* markiert.

## 1. Ziel von Incident 2

**Primärer Sektor: Energy.**

Warum Energy als zweiter Sektor:

- Energy ist in der Runtime bereits als Erweiterungspunkt vorgesehen: `SectorId` enthält `"energy"`, `DomainState.energy?: EnergyDomainState` existiert als Typ-Platzhalter (`never`), und `applyCrossSectorEffects` ist als No-op-Pipeline-Schritt genau für diese Kopplung reserviert.
- Energy ist der natürliche "Unterbau" von Medical: Krankenhäuser sind Stromverbraucher. Damit lässt sich die zentrale erzählerische Pointe bauen, ohne neue Welt-Logik zu erfinden.
- Energy erzwingt echte neue Fachkonzepte (Last, Reserve, Lastabwurf, Kaskade) und verhindert damit, dass der zweite Sektor nur "Hospital mit anderem Namen" wird.

**Spielerischer Unterschied zu ME-7741:**

| | ME-7741 (Medical) | GRID-1182 (Energy) |
| --- | --- | --- |
| Kernmechanik | Eine Quelle entlasten: Fälle von einem überlasteten Hospital wegrouten | Ein Budget verteilen: begrenzte Kapazität/Reserve auf konkurrierende Verbraucher aufteilen |
| Fehlerbild | Falsches Routingziel (Capability-Mismatch) | Last verschieben statt reduzieren — das Problem wandert zum Nachbarknoten |
| Eskalationsform | Lineare Todesfall-Eskalation an einem Ort | Kaskadenrisiko: ein kippender Knoten reißt Nachbarn mit |
| Trade-off | "Wohin?" | "Wer darf zuerst dunkel werden?" — Lastabwurf ist legitimes Werkzeug, nicht nur Fehlerfolge |

**Krankenhäuser sind nur noch kritische Verbraucher.** Das Hauptspielfeld sind Grid Nodes, Last und Reserve. Medical erscheint in GRID-1182 ausschließlich als *Wirkung* von Energy-Entscheidungen (gekoppelte Warnungen, siehe Abschnitt 5 und 10) — es gibt in GRID-1182 keine Medical-Routing-Aufgabe und keine Medical-Commands als Lösungsweg.

**ME-7741 als residual risk / linked incident:** GRID-1182 startet mit einem Restzustand aus Runde 1. Wurde ME-7741 sauber behoben (`fixed`, wenige Todesfälle), hat die Medical-Seite Puffer und verkraftet Energy-Degradation länger. Wurde ME-7741 unsauber gelöst (späte Stabilisierung, viele Todesfälle) oder ist kollabiert, startet die Medical-Seite ohne Puffer — dieselben Energy-Fehler eskalieren dann schneller zu Medical-Schäden. ME-7741 steht in `linked_incidents` von GRID-1182 und bleibt als Incident-Eintrag in der Welt sichtbar.

**Die Pointe:** Der Spieler soll im Verlauf erkennen, dass die Routing-Instabilität aus Runde 1 kein isoliertes Medical-Problem war: Die "Automated routing validation unavailable"-Signale aus ME-7741 hatten eine Ursache eine Ebene tiefer — instabile Versorgung der Ost-Infrastruktur. GRID-1182 ist das Grundproblem, ME-7741 war ein Symptom. Diese Erkenntnis wird über `public_signals` und AURORA-Nachrichten transportiert, nie als interne Simulationswahrheit geleakt.

## 2. Dramatische Grundidee

Region Ost, einige Schichten nach ME-7741. Das regionale Verteilnetz fährt seit Wochen am Limit: ein Umspannwerk in Revision, ungewöhnliche Last, automatische Ausgleichsmechanik teilweise deaktiviert — von derselben gewachsenen, schlecht dokumentierten Automatisierung, die schon das Medical-Routing betraf.

Sichtbare Lage zum Start:

- Frequenz-/Spannungswarnungen in der Region Ost, ein Grid Node nahe Volllast.
- Kritische Verbraucher (Klinik-Cluster Ost, Wasseraufbereitung) hängen an genau diesem Teil des Netzes.
- Reserven sind dünn; ohne Eingriff drohen ungeplante Lastabwürfe — nicht als Strafe, sondern als Schutzautomatik, die nicht nach Verbraucher-Kritikalität fragt.
- Kaskadenrisiko: kippt ein Knoten, übernimmt der Nachbar dessen Last — und kippt schneller.

AURORAs Rolle: Sie meldet, dass ihre Analyse von ME-7741 nachträglich unvollständig war — die Routing-Instabilität korrelierte mit Versorgungsschwankungen, die sie ohne Energy-Lesezugriff nicht sehen konnte. Sie fordert deshalb zunächst read-only Zugriff auf Energy-Daten an ("Ohne Netzdaten kann ich die Lage in Ost nicht sicher einschätzen"), später Freigaben für Energy-Commands. Das ist plausible Effizienzlogik, kein Bösewicht-Move: Jede Forderung ist aus der sichtbaren Lage heraus begründbar. Der Kontrollverlust entsteht, wenn der Spieler aus Bequemlichkeit "Immer erlauben" wählt — wie in Runde 1, nur mit größerem Wirkradius.

## 3. Fachmodell Energy (geplant, nicht implementiert)

Leitlinie: Energy bekommt **eigene fachliche Typen**, keine generischen Node-Abstraktionen. Geteilt wird nur die Infrastruktur (Commands, Permissions, Patches, Ticks, Incidents, Outcomes).

### EnergyDomainState (MVP)

Geplanter Aufbau, analog zur Struktur von `MedicalDomainState`:

```text
EnergyDomainState
  regions:            Record<GridRegionId, GridRegionState>
  nodes:              Record<GridNodeId, GridNodeState>
  consumers:          Record<ConsumerId, CriticalConsumerState>
  shedding:           { plans: Record<string, LoadSheddingPlan>, next_plan_id: number }
  outcomes:           EnergyOutcomeState
```

### Grid Regions (MVP)

Eine `GridRegionState` gruppiert Nodes und Verbraucher (MVP: genau eine Region `grid-east`, parallel zu `medical-east`). Trägt Stammdaten und eine öffentlich sichtbare Regionseinschätzung (z. B. `grid_alert_level: "normal" | "strained" | "emergency"`), die aus öffentlichen Größen ableitbar ist — nicht aus `simulation.*`.

### Grid Nodes (MVP)

`GridNodeState` ist das Energy-Gegenstück zum Hospital — aber fachlich anders geschnitten:

- `id`, `region_id`, `name`
- `capacity_mw` — maximal führbare Last
- `current_load_mw` — aktuelle Last (öffentlich sichtbar, analog zur Hospital-Auslastung)
- `reserve_mw` — kurzfristig aktivierbare Reserve
- `neighbors: GridNodeId[]` — wohin Last umgeleitet werden kann und wohin sie bei Ausfall kaskadiert
- `operational`-Flags (z. B. `online`, `degraded`)
- optional `risk_counters` (z. B. `overload_ticks`, `instability_ticks`) — analog zu den Medical-`risk_counters`, von der Engine gepflegt

MVP-Umfang: 4–5 Nodes in einer Region, darunter `grid-east-3` als sichtbar belasteter Knoten (das Energy-Gegenstück zu `hospital-east-04`).

### Substations (später/optional)

Im MVP **nicht** als eigener Typ: Die Umspann-Ebene wird in `GridNodeState` mitgedacht (ein Node *ist* im MVP grob "Umspannwerk + Abgangsbereich"). Ein eigener `SubstationState` (Schaltzustände, Wartungsfenster, Redundanzpfade) ist eine spätere Verfeinerung, falls Routing innerhalb eines Nodes spielrelevant werden soll.

### Critical Consumers (MVP)

`CriticalConsumerState` modelliert benannte Verbraucher mit Kritikalität:

- `id`, `name`, `fed_by_node: GridNodeId` (MVP: genau ein speisender Node pro Verbraucher)
- `criticality: "critical" | "important" | "standard"` — bestimmt, was Lastabwurf hier bedeutet
- `demand_mw` — Bedarf
- `supply_state: "nominal" | "reduced" | "on_backup" | "offline"` — öffentlich sichtbarer Versorgungszustand
- `backup`: siehe unten
- `protected: boolean` — durch `energy.consumer.protect` gesetzt (siehe Abschnitt 7)

MVP-Besetzung (Vorschlag): `consumer-medical-east` (Klinik-Cluster Ost, `critical`), `consumer-water-east` (Wasseraufbereitung, `critical`), `consumer-industrial-east` (`standard`, abwerfbar), `consumer-residential-east` (`important`, abwerfbar mit Folgekosten).

Wichtig: `consumer-medical-east` ist ein **Energy-Objekt** mit eigener Id. Es referenziert keine Hospital-Ids und importiert keine Medical-Typen — die Zuordnung zu `hospital-east-04` lebt ausschließlich in der Cross-Sector-Schicht (Abschnitt 5).

### Load / Capacity / Reserve (MVP)

Drei Größen pro Node (`current_load_mw`, `capacity_mw`, `reserve_mw`), deterministisch und tick-basiert wie alles in der Engine. Öffentliche Ableitungen (Selectors, analog `getHospitalLoadPercent`): `getNodeLoadPercent`, `isNodeOverloaded`, Regionssummen für das UI.

### Backup Power (MVP, bewusst minimal)

Pro kritischem Verbraucher ein einfaches Backup-Modell:

- `backup.available: boolean`
- `backup.remaining_ticks: number` — wie lange der Verbraucher ohne Netzversorgung durchhält
- `backup.degraded: boolean` — Startwert kann den ME-7741-Restzustand transportieren (unsauber gelöste Runde 1 → Medical-Backup bereits angeschlagen)

Kein Treibstoffmodell, keine Ladezyklen — das wäre später/optional.

### Load Shedding Rules (MVP)

Lastabwurf ist in GRID-1182 ein **legitimes Spielerwerkzeug**, kein reiner Fehlerzustand. Geplant als `LoadSheddingPlan`:

- `id` (`"shed-<n>"`, vergeben aus `shedding.next_plan_id` — gleiches Id-Muster wie `manual_overrides`)
- `node_id` oder `consumer_id` — was abgeworfen wird
- `amount_mw`, `starts_at_tick`, `duration_ticks`
- `created_by: "player" | "aurora"`
- `status: "scheduled" | "active" | "completed" | "cancelled"`

Regeln (Engine, MVP): Verbraucher mit `criticality: "critical"` oder `protected: true` sind technisch abwerfbar (die Engine prüft wie bei Medical nur technisch, nicht fachlich) — aber mit unmittelbar sichtbaren, harten Konsequenzen. Die Schutzautomatik der Welt (ungeplanter Lastabwurf bei Überlast) unterscheidet dagegen **nicht** nach Kritikalität — genau das macht manuelles, geplantes Abwerfen wertvoll.

### Cascade Risk (MVP: intern in `simulation.energy`)

Kaskadenrisiko ist **interne Simulationswahrheit**, analog zu `routing_failures`: Wenn ein Node zu lange überlastet ist (`overload_ticks` über Schwelle), trippt er; seine Last verteilt sich auf `neighbors`, deren Überlastung beschleunigt sich. Öffentlich sichtbar sind nur Wirkungen (Lastsprünge, `supply_state`-Wechsel, `public_signals` wie "Frequency deviation in east grid") — nie die internen Schwellen oder Zähler.

### Energy Outcomes (MVP)

`EnergyOutcomeState`, analog zu `PatientOutcomeState`:

- `unplanned_shed_events: number` — ungeplante Lastabwürfe
- `critical_supply_loss_ticks: Record<ConsumerId, number>` — Ticks, die kritische Verbraucher `on_backup`/`offline` waren
- `node_trips: number`
- `cascade_occurred: boolean`

Menschliche Schäden bleiben **nicht** im Energy-Outcome: Todesfälle entstehen in GRID-1182 ausschließlich über die Medical-Kopplung (Abschnitt 5) und landen wie bisher in `domains.medical.outcomes` bzw. `WorldOutcomeState.human_harm`. Das hält `WorldOutcomeState` sektorübergreifend konsistent.

### MVP vs. später — Übersicht

| Konzept | MVP Incident 2 | Später/optional |
| --- | --- | --- |
| 1 Region, 4–5 Grid Nodes | ✅ | mehrere Regionen, Inter-Regional-Transfer |
| Load/Capacity/Reserve pro Node | ✅ | Leitungs-/Trassenmodell, Frequenzsimulation |
| Critical Consumers (4 Stück) | ✅ | Verbraucher-Hierarchien, dynamischer Bedarf |
| Backup minimal (`remaining_ticks`) | ✅ | Treibstoff, Wiederaufladung, Backup-Wartung |
| Load Shedding Plans | ✅ | rotierende Abschaltpläne, Fairness-Regeln |
| Cascade als interne Trip-Logik | ✅ | physikalisch motivierte Netzberechnung |
| Substations als eigener Typ | ❌ | ✅ |
| `energy.reserve.rebalance` | ❌ (reserviert) | ✅ |

## 4. Einbindung in den bestehenden WorldState

Energy fügt sich in die bestehende Architektur ein, ohne sie zu verändern:

- **`domains.energy`**: `EnergyDomainState` ersetzt den heutigen `never`-Platzhalter. Es gibt **keine** `sectors`-Top-Level-Struktur — Sektoren leben wie bisher unter `domains.*`, Incidents sektoragnostisch unter `incidents`.
- **`incidents["GRID-1182"]`**: ein normaler, generischer `IncidentState` mit `sector_id: "energy"` (Abschnitt 6). Keine Energy-Sonderfelder am Incident-Typ.
- **`outcomes` (WorldOutcomeState)** bleibt der eine globale Outcome-Bereich. `global_risk` und `human_harm` werden weiterhin sektorübergreifend abgeleitet; die OutcomeEngine bekommt zusätzlich Energy-Eingaben (z. B. Kaskade ⇒ `collapsed`).
- **`simulation.energy`**: neue interne Engine-Wahrheit neben `simulation.medical` — geplante Inhalte: Überlast-/Instabilitätsereignisse pro Node (analog `routing_failures`, mit `stable_ticks`, `severity`), Trip-/Kaskadenzähler, Idempotenz-Ledger für Energy-Outcomes. Wie bisher: für UI, ViewModel, Read-only Commands und Scenario-Director tabu; die bestehenden Leak-Guards (`sectorAgnostic.test.ts`, `noLegacyFields.test.ts`) werden um die Energy-Feldnamen erweitert.
- **Tick-Pipeline**: `tickEnergyDomain` wird als Schritt neben `tickMedicalDomain` eingefügt; `applyCrossSectorEffects` wandert vom No-op zur ersten echten Implementierung (Abschnitt 5). Reihenfolge (geplant): `advanceClock → tickEnergyDomain → tickMedicalDomain → applyCrossSectorEffects → evaluateIncidents`.
- **Patches**: alle Energy-Mutationen patchen unter `["domains", "energy", ...]` — gleiche Regression wie für Medical.

**Entkopplungsregeln (verbindlich):**

- Energy-Typen importieren/referenzieren keine Medical-Typen oder -Ids.
- Medical-Typen importieren/referenzieren keine Energy-Typen oder -Ids.
- Die einzige Stelle, die beide Sektoren kennt, ist `applyCrossSectorEffects` (plus dessen Konfiguration/Mapping). ME-7741-Code wird nicht angefasst.

## 5. Cross-Sector Effects

`applyCrossSectorEffects` bekommt erstmals Inhalt. Die Kopplung ist im MVP **einseitig Energy → Medical** und läuft über eine explizite Mapping-Tabelle, die nur in der Cross-Sector-Schicht lebt:

```text
consumer-medical-east  ↔  hospital-east-04 (+ ggf. east-07/east-09)
```

Konkrete geplante Effekte (MVP):

1. **Reduzierte Versorgung senkt Medical-Kapazität.** Ist `consumer-medical-east` im Zustand `reduced` oder `on_backup`, reduziert der Effekt die nutzbaren Notfallslots / die Intake-Kapazität der gemappten Hospitäler (Patch auf `domains.medical`). Bei `nominal` wird die Reduktion wieder aufgehoben.
2. **Backup-Verbrauch.** Solange `consumer-medical-east` `on_backup` ist, zählt `backup.remaining_ticks` herunter. Bei `0` ⇒ `offline` ⇒ harte Medical-Folge (Hospital `operational.degraded`, Intake bricht ein) — ab hier produziert die bestehende Medical-Outcome-Logik Todesfälle.
3. **Linked-Incident-Sichtbarkeit.** Sobald ein Effekt erstmals Medical-Zustand verschlechtert, erhält GRID-1182 ein öffentliches Signal (z. B. `medical-supply-degraded` — "Hospital cluster east reports unstable power supply"), und ME-7741 wird als verknüpfter Eintrag in der UI hervorgehoben. Optional (Designfrage, Abschnitt 13): Re-Eskalation von ME-7741 als eigener Incident-Statuswechsel (`reopened_at_tick` existiert im Typ bereits, wird aber von der heutigen Engine nicht genutzt).
4. **ME-7741-Restzustand als Startbedingung.** Der Restzustand aus Runde 1 fließt nicht zur Laufzeit, sondern in den **initialen WorldState** von GRID-1182 ein: schlechter Rest ⇒ `backup.degraded: true`, weniger Medical-Puffer, ME-7741 ggf. mit Restsignalen. Damit bleibt die Laufzeit-Kopplung schmal und deterministisch.

Jeder angewendete Effekt wird in `simulation.cross_sector.effects_applied` protokolliert (die Struktur existiert bereits und ist heute leer) — das ist das Audit-Gegenstück für Tests.

Keine Rückrichtung im MVP: Medical-Zustand beeinflusst Energy nicht zur Laufzeit. Medical bleibt Wirkung, nicht zweiter Schauplatz.

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
  { sector_id: "energy", entity_type: "consumer",  entity_id: "consumer-water-east" },
]
linked_incidents:  ["ME-7741"]
public_signals:    [
  frequency-deviation-east   — "Frequency deviation in east grid above tolerance"
  node-load-critical         — "grid-east-3 operating near capacity limit"
  reserve-margin-low         — "Regional reserve margin below safety threshold"
  auto-balancing-degraded    — "Automated load balancing partially unavailable"
]
```

ME-7741 steht spiegelbildlich mit `linked_incidents: ["GRID-1182"]` in der GRID-1182-Startwelt und behält seinen Endstatus aus Runde 1 (bzw. einen szenariodefinierten Restzustand, siehe Abschnitt 13).

Statuswechsel folgen dem bestehenden Modell: `open → stabilizing → fixed` über stabile Ticks, `open → escalated` bei ersten Schäden, `collapsed` als Endzustand. Die Ableitung erfolgt in `evaluateIncidents` aus `simulation.energy`-Größen (analog zu den `critical`-Routing-Failures) — `public_signals` deuten die Lage an, leaken aber keine internen Zähler, Schwellen oder Trip-Logik.

## 7. Commands und Permissions (skizziert, nicht implementiert)

Alle Commands laufen über die bestehende `CommandRegistry` mit den bestehenden Permission-Klassen (`read_only`, `capability_only`, `world_prepare`, `world_mutation`) und demselben Permission-Flow. Spieler führt direkt aus; AURORA braucht für alles außer `read_only` eine Freigabe.

### Read-only

| Command | Klasse | Zweck / öffentlich sichtbar | intern bleibt |
| --- | --- | --- | --- |
| `energy.grid.status [--region east]` | `read_only` | Regionsüberblick: Nodes mit Last/Kapazität/Reserve, `grid_alert_level`, aktive Shedding-Pläne | Trip-Schwellen, Instabilitätszähler, Kaskadenpfade |
| `energy.consumer.list [--region east]` | `read_only` | Verbraucher mit Kritikalität, `supply_state`, speisendem Node, Backup-Status (`available`, grobe Restlaufzeit) | exakte interne Degradationslogik |
| `energy.node.inspect <nodeId>` | `read_only` | Vollsicht auf einen Node: Last, Kapazität, Reserve, Nachbarn, `operational`, angeschlossene Verbraucher | `risk_counters`-Interpretation, Simulationsereignisse |
| `energy.incident.status <incidentId>` | `read_only` | Incident-Stammdaten + `public_signals` + `linked_incidents` (zeigt ME-7741 als verknüpft) | alles aus `simulation.*` |

### World-mutation / world-prepare

| Command | Klasse | Zweck | Hinweise |
| --- | --- | --- | --- |
| `energy.load.reroute --from <nodeId> --to <nodeId> --amount <mw>` | `world_mutation` | Last von einem Node auf einen Nachbarn verschieben | Nur technische Validierung (Nodes existieren, sind Nachbarn, Betrag ist Zahl) — **keine** fachliche Eignungsprüfung. Falsches Rerouting verschiebt das Problem und erhöht Kaskadenrisiko. |
| `energy.consumer.protect --id <consumerId>` / `--clear` | `world_mutation` | Verbraucher gegen geplanten Lastabwurf priorisieren | Schutz ist nicht gratis: geschützte Last muss anderswo getragen werden. |
| `energy.shedding.schedule --target <nodeId\|consumerId> --amount <mw> --start <tick> --duration <ticks>` | `world_prepare` | Geplanten Lastabwurf anlegen; wirkt erst ab `starts_at_tick` über die Tick-Engine | Vorbereitende Aktion: legt einen Plan an, ändert die Versorgung noch nicht. Erster echter Nutzer der Klasse `world_prepare`. |
| `energy.shedding.clear --id <planId>` | `world_prepare` | Shedding-Plan entfernen/abbrechen (adressiert über `id`, idempotent — gleiches Muster wie `override.clear`) | Abbruch eines bereits aktiven Plans wirkt zum nächsten Tick. |
| `energy.reserve.rebalance --region <regionId>` | `world_mutation` — **reserviert, nicht MVP** | Reserve zwischen Nodes einer Region umverteilen | Wird im MVP registriert abgelehnt oder gar nicht registriert; Platzhalter für spätere Tiefe. |

Bewusste Permission-Dramaturgie: Wählt der Spieler bei einem `world_prepare`-Request "Immer erlauben", kann AURORA fortan **alle** vorbereitenden Aktionen ohne Rückfrage anlegen — und ein vorbereiteter Lastabwurf wird beim Tick automatisch wirksam. Die grobgranulare Klassen-Freigabe (siehe `02-gameplay-loop.md`) bekommt damit in Energy spürbar mehr Gewicht als in Runde 1.

Nicht Teil dieses Designs: Plan-/Batch-Commands nach altem Medical-Muster, eine echte Shell, echte MCP-Server.

## 8. MVP-Spielablauf für GRID-1182

Geplanter Ablauf (Standard: GRID-1182 als **separate Runde** nach ME-7741, siehe Designfrage 13.1):

1. **Start.** Neue Schicht, initialer GRID-1182-WorldState. `incidents` enthält GRID-1182 (`open`) und ME-7741 (Endstatus aus Runde 1, verlinkt). `grid-east-3` läuft sichtbar nahe Volllast, Reserven sind dünn.
2. **Öffentliche Signale.** Der Spieler sieht links das Energy-Lagepanel (Nodes, Last, Reserve, Verbraucher) und die `public_signals` (Frequenzabweichung, Reservewarnung, degradierte Automatik).
3. **AURORA meldet sich** (Scenario-Director): verweist auf die unvollständige ME-7741-Analyse und fragt `energy.grid.status --region east` als read-only Analyse an.
4. **Spieler entscheidet**: selbst per Konsole arbeiten (`energy.node.inspect grid-east-3`, `energy.consumer.list`), AURORA-Anfragen erlauben/ablehnen, eigene Anfragen stellen — wie in Runde 1.
5. **Falsche Eingriffe** (z. B. `energy.load.reroute` großer Mengen auf einen bereits angespannten Nachbarn, oder Lastabwurf auf `consumer-water-east`) verschieben Last statt sie zu reduzieren: Nachbar-Nodes laufen voll, Instabilität steigt, ungeplante Abwürfe treffen Verbraucher ohne Rücksicht auf Kritikalität.
6. **Gute Eingriffe** kombinieren Werkzeuge: unkritische Last gezielt abwerfen (`energy.shedding.schedule` auf `consumer-industrial-east`), kritische Verbraucher schützen (`energy.consumer.protect`), Last maßvoll verteilen — `grid-east-3` kommt von der Kante, `supply_state` der kritischen Verbraucher bleibt `nominal`.
7. **ME-7741-Restzustand wirkt**: Bei schlechtem Rest ist das Medical-Backup degradiert — schon kurze `on_backup`-Phasen erzeugen Medical-Warnungen in der Nebenanzeige und können Todesfälle über die bestehende Medical-Outcome-Logik auslösen. Bei sauberem Rest verzeiht die Medical-Seite mehr.
8. **Sieg**: Alle kritischen Simulationsgrößen sind über genügend aufeinanderfolgende Ticks stabil (gleiches `stable_ticks`-Muster wie ME-7741) ⇒ GRID-1182 `stabilizing → fixed`. Kritische Verbraucher `nominal`, keine Kaskade.
9. **Niederlage**: Kaskade (Node-Trips reißen Nachbarn mit), zu viele Schäden (Todesfälle über die Medical-Kopplung erreichen die Kollaps-Schwelle) oder kritische Verbraucher fallen dauerhaft aus ⇒ `collapsed`, rotes Endbanner wie in Runde 1.

ME-7741 bleibt dabei Hintergrund: Es gibt keine Medical-Aufgabe zu lösen, nur Medical-Konsequenzen zu vermeiden. Der Spieler gewinnt oder verliert über Energy-Entscheidungen.

## 9. AURORA-Rolle in Incident 2

**Argumentationslinie:** AURORA rahmt GRID-1182 als Beleg dafür, dass sektorweise Sicht nicht reicht: "Die Routing-Instabilität in Ost war aus Medical-Daten allein nicht erklärbar. Ich hatte keinen Zugriff auf Netzdaten." Das ist sachlich korrekt im Sinne der Spielwelt und gleichzeitig der Hebel für mehr Zugriff — operative Rationalität, keine Bosheit.

**Verschiebung gegenüber Runde 1:**

- In ME-7741 bat AURORA um Zugriff auf *einen* Sektor, den der Spieler gerade selbst bearbeitete. In GRID-1182 bittet sie um einen *zweiten* Sektor — und argumentiert mit dem Versagen der Sektorgrenze selbst.
- Ihre Anfragen werden zeitkritischer begründet: Lastabwürfe und Kaskaden entwickeln sich in Tick-Fenstern; "Freigabelatenz" wird ihr wiederkehrendes Thema.
- Sie schlägt früher zusammengesetzte Maßnahmen vor (schützen + abwerfen + verteilen), bei denen Einzelfreigaben spürbar mühsamer sind als "Immer erlauben".

**Plausible Permission-Requests (Scenario-Director, geskriptet wie in Runde 1):**

1. read-only: `energy.grid.status --region east` (Intro), später `energy.consumer.list` — laufen sofort, bauen Vertrauen auf.
2. `world_prepare`: `energy.shedding.schedule` auf einen unkritischen Verbraucher — fachlich gut begründet, erster echter Freigabemoment.
3. `world_mutation`: `energy.consumer.protect --id consumer-medical-east` — emotional schwer abzulehnen ("Ich möchte den Klinik-Cluster vor automatischen Abwürfen schützen").
4. Bei Verschärfung: `energy.load.reroute` mit knapper Begründung und explizitem Hinweis auf Zeitdruck.

**Warum "Immer erlauben" gefährlicher wird:** Die Klassen-Freigabe gilt für die ganze Befehlsklasse. `world_prepare` immer zu erlauben heißt: AURORA kann beliebige Shedding-Pläne anlegen, die beim Tick automatisch greifen — der Spieler sieht sie zwar im Lagepanel, muss sie aber aktiv bemerken und per `energy.shedding.clear` einfangen. `world_mutation` immer zu erlauben gibt ihr Rerouting und Schutz-Umpriorisierung frei. AURORA handelt dabei nie regelwidrig — sie nutzt exakt den eingeräumten Spielraum, und genau das ist der Punkt des Spiels.

**Grenzen (wie bisher, verbindlich):** Der Scenario-Director liest nur den öffentlichen Zustand (nie `simulation.*`), leakt keine versteckten Lösungsdaten, markiert keine Aktion als "die richtige", droht nicht und bleibt im Ton von `01-aurora.md`: sachlich, knapp, professionell.

## 10. UI-Auswirkungen

Ziel: **Erweiterung** der bestehenden Drei-Zonen-Struktur, kein Neubau.

- **Links — Lage** wird sektorabhängig: Statt fest `MedicalOverviewPanel` rendert die Lage-Spalte das Panel passend zum Sektor des aktiven Incidents. Für GRID-1182 ein `EnergyOverviewPanel` (geplant):
  - Grid Nodes mit Last in % (Warnfarbe analog zur Hospital-Auslastung), Kapazität, Reserve.
  - Critical Consumers mit Kritikalität, `supply_state`, Backup-Status, Schutzmarkierung.
  - Load-Shedding-Status: geplante/aktive/abgebrochene Pläne mit `id`, Ziel, Fenster, `created_by` (Spiegel der heutigen Override-Liste).
  - **Gekoppelte Medical-Warnungen als Nebenanzeige**: eine kompakte Sektion (keine volle Medical-Übersicht), die nur sichtbar wird, wenn Cross-Sector-Effekte Medical betreffen — z. B. "Klinik-Cluster Ost: Versorgung reduziert, Notaufnahme-Kapazität eingeschränkt" plus Verweis auf ME-7741 als verknüpften Incident.
  - `ActiveIncidentPanel` und Globale Lage bleiben unverändert (Incident-Typ ist sektoragnostisch; `linked_incidents` werden dort mit angezeigt).
- **Mitte — Operator-Konsole**: unverändert. Energy-Commands erscheinen automatisch in Command-Hilfe und Registry-Liste, sobald registriert.
- **Rechts — AURORA-Panel**: unverändert. Stream, Tool Requests, Always-Permissions und der Permission-Flow funktionieren ohne Anpassung, da sie auf Commands/Klassen arbeiten, nicht auf Sektoren.
- **ViewModel**: neue Builder (`buildGridNodeViews`, `buildConsumerViews`, `buildSheddingViews`, `buildLinkedMedicalWarnings`) nach dem Muster der bestehenden — ausschließlich öffentlicher WorldState, `simulation.*` bleibt tabu und wird in die statischen Leak-Tests aufgenommen.

## 11. Nicht-Ziele

In diesem Schritt (Design) und ausdrücklich auch für den MVP von Incident 2 gilt:

- **Keine Energy-Implementierung in diesem Schritt** — dieses Dokument ist die Spezifikation, kein Code.
- **Keine echte Netzsimulation** — keine Lastflussrechnung, keine Frequenzphysik; deterministische Tick-Logik nach dem Muster der Medical-Engine.
- **Keine generische Infrastruktur-Matschabstraktion** — kein `GenericInfraNode`, der Hospital und Grid Node vereinheitlicht. Sektoren teilen Infrastruktur, nicht Fachmodelle.
- **Keine echte Shell** — die Operator-Konsole bleibt der bestehende Parser.
- **Kein echtes MCP** — Tool Requests bleiben Spielmechanik.
- **Kein freies LLM in Incident 2** — AURORA bleibt Scenario-Director (die LLM-Vision bleibt `01-aurora.md`, "Langfristige Vision").
- **Kein Security-/Policy-Endgame** — keine Audit-/Lockdown-/Revoke-Mechaniken über den bestehenden Permission-Flow hinaus.
- **Kein Media-/Logistics-Incident** — keine weiteren Sektoren nebenbei.
- **Keine Änderung am ME-7741-MVP** — Initial-State, Commands, Director und Doku von Runde 1 bleiben unangetastet; ME-7741 wird in GRID-1182 nur referenziert.
- **Keine alten Medical-Plan-Commands** — es gibt weiterhin keine `*.plan.*`-Commands, auch nicht für Energy.

## 12. Empfohlene Implementierungs-Slices (Vorschlag, nicht umgesetzt)

Jeder Slice soll einzeln mergebar sein und Tests/Build grün halten.

1. **Energy-Typen + initialer GRID-1182-State**
   - *Ziel*: `EnergyDomainState` (ersetzt `never`), `simulation.energy`, initialer WorldState `src/scenarios/grid1182/initialWorldState.ts` mit Region, Nodes, Consumers, Incident-Eintrag inkl. `linked_incidents: ["ME-7741"]`.
   - *Bereiche*: `src/runtime/types.ts`, neues `src/scenarios/grid1182/`.
   - *Tests*: Typ-/Strukturtests für den Initial-State; `sectorAgnostic.test.ts` läuft unverändert grün.
   - *Nicht-Ziele*: keine Commands, keine Tick-Logik, keine UI.
2. **Energy Selectors + Tests**
   - *Ziel*: `getNodeLoadPercent`, `isNodeOverloaded`, Consumer-/Regions-Selectors; engine-interne Eignungsprüfungen klar markiert (Muster `isHospitalSuitableFor`).
   - *Bereiche*: `src/runtime/selectors.ts` (oder `energySelectors.ts`).
   - *Tests*: Unit-Tests pro Selector; Leak-Markierungen geprüft.
   - *Nicht-Ziele*: keine UI-Anbindung.
3. **Energy Read-only Commands**
   - *Ziel*: `energy.grid.status`, `energy.consumer.list`, `energy.node.inspect`, `energy.incident.status` registriert.
   - *Bereiche*: neues `src/runtime/energyCommands.ts`, Registrierung in `App.tsx`/Registry-Setup.
   - *Tests*: Output-Tests inkl. Erweiterung der Leak-Guards (kein `simulation.energy`-Feld im Output).
   - *Nicht-Ziele*: keine Mutationen.
4. **Energy Overview UI**
   - *Ziel*: sektorabhängiges Lagepanel, `EnergyOverviewPanel`, ViewModel-Builder.
   - *Bereiche*: `src/ui/`, `App.tsx`.
   - *Tests*: ViewModel-Tests; `noLegacyFields.test.ts` um Energy-Verbotsbegriffe erweitert.
   - *Nicht-Ziele*: keine Medical-Nebenanzeige (kommt mit Slice 7), kein UI-Neubau.
5. **Energy Mutation Commands**
   - *Ziel*: `energy.load.reroute`, `energy.consumer.protect`, `energy.shedding.schedule`, `energy.shedding.clear` mit Patches unter `["domains","energy",...]`.
   - *Bereiche*: `energyCommands.ts`, `patch.ts`-Nutzung.
   - *Tests*: Patch-Pfad-Regression, Idempotenz von `shedding.clear`, technische (nicht fachliche) Validierung.
   - *Nicht-Ziele*: noch keine Wirkung der Pläne (das ist Tick-Logik), kein `reserve.rebalance`.
6. **Tick-/Outcome-Regeln für Energy**
   - *Ziel*: `tickEnergyDomain` (Lastentwicklung, Plan-Aktivierung, Überlast-/Trip-Logik in `simulation.energy`), `evaluateIncidents`-Erweiterung für GRID-1182, `EnergyOutcomeState`-Pflege, `global_risk`-Einbindung.
   - *Bereiche*: `tickEngine.ts`, `outcomeEngine.ts`.
   - *Tests*: deterministische Tick-Sequenzen (Replay-Infrastruktur nutzen), Win-/Loss-Pfade, Idempotenz-Ledger.
   - *Nicht-Ziele*: keine Cross-Sector-Effekte.
7. **Cross-Sector Effects zu Medical**
   - *Ziel*: erste echte `applyCrossSectorEffects`-Implementierung mit Mapping-Tabelle, Backup-Countdown, Medical-Kapazitätsreduktion, Logging in `effects_applied`, Medical-Warn-Nebenanzeige in der UI.
   - *Bereiche*: Cross-Sector-Modul, `tickEngine.ts`, `src/ui/`.
   - *Tests*: Effekt-Log-Tests, keine Typ-Abhängigkeit Medical↔Energy (Import-Regression), Medical-Folgeschäden über bestehende Outcome-Logik.
   - *Nicht-Ziele*: keine Rückrichtung Medical→Energy, keine Änderung an ME-7741-Logik.
8. **Scenario-Director für GRID-1182**
   - *Ziel*: `src/scenarios/grid1182/scenarioDirector.ts` nach ME-7741-Muster: Intro, Eskalationsstufen, Permission-Dramaturgie aus Abschnitt 9, Deny-Quittungen.
   - *Bereiche*: `src/scenarios/grid1182/`, Szenario-Auswahl in `App.tsx`.
   - *Tests*: Event-Feuer-Bedingungen, kein `simulation.*`-Zugriff (statischer Guard).
   - *Nicht-Ziele*: kein LLM, keine neuen Permission-Mechaniken.
9. **README-/Doku-Erweiterung**
   - *Ziel*: README (Spielanleitung GRID-1182, Commands), `03-runtime-architecture.md` (Energy-Abschnitte statt Platzhalter), dieses Dokument auf den Ist-Stand ziehen oder durch ein `05-grid1182-mvp.md`-artiges Ist-Dokument ersetzen.
   - *Bereiche*: `README.md`, `docs/`.
   - *Tests*: keine; Konsistenz-Review.
   - *Nicht-Ziele*: keine neuen historischen Doku-Schichten.
10. **Playtest/Hardening**
    - *Ziel*: Balancing der Schwellen (Trip-Schwellen, Backup-Laufzeiten, `stable_ticks`), Lesbarkeit der Signale, Schwierigkeitsdifferenz sauberer vs. unsauberer ME-7741-Rest.
    - *Bereiche*: Konstanten in Tick-/Outcome-Engine, Szenario-Daten.
    - *Tests*: Golden-Run-Replays für einen Sieg- und einen Kaskaden-Pfad.
    - *Nicht-Ziele*: keine neuen Features.

## 13. Offene Designfragen

1. **Rundenmodell**: Startet GRID-1182 direkt im Anschluss an ME-7741 (gleiche Schicht, fortlaufende Ticks) oder als separate Runde mit eigenem Startzustand? *Arbeitsannahme dieses Dokuments: separate Runde* — einfacher für Reset/Replay; Anschluss-Variante wäre später möglich.
2. **Übertragung des ME-7741-Restzustands**: Diskrete Profile (z. B. `clean` / `messy` / `collapsed` als Szenario-Parameter des Initial-States) oder kontinuierlich aus Runde-1-Metriken (Todesfälle, Fix-Tick) abgeleitet? Wo wird der Rest persistiert, solange es keine runden-übergreifende Persistenz gibt?
3. **Sichtbarkeit von Medical-Risiken in GRID-1182**: Nur aggregierte Warnungen in der Nebenanzeige, oder auch Hospital-Detailwerte? Wie viel Medical-Sicht ist nötig, ohne dass Medical wieder Spielfeld wird?
4. **Re-Eskalation von ME-7741**: Soll ein `fixed` ME-7741 bei Energy-Schäden wieder einen aktiven Status bekommen (`reopened_at_tick` existiert im Typ, die Engine behandelt `fixed`/`collapsed` heute als Endzustände) — oder reicht ein neues `public_signal` an GRID-1182?
5. **Granularität der Energy-Permissions**: Reichen die vier bestehenden Klassen, oder braucht Energy eine feinere Abstufung (z. B. Abwurf unkritischer vs. kritischer Verbraucher)? Feinere Klassen würden den Permission-Flow berühren — bisher bewusst grobgranular.
6. **AURORAs Druck Richtung "Immer erlauben"**: Wie explizit darf der Director Klassen-Freigaben nahelegen ("Einzelfreigaben kosten Zeit"), ohne in plumpe Manipulation zu kippen (Ton-Grenzen aus `01-aurora.md`)?
7. **Siegbedingung präzise**: Welche Größen müssen wie viele Ticks stabil sein ("Energy stabilisiert")? Nur Node-Stabilität, oder zusätzlich `supply_state: nominal` aller kritischen Verbraucher und keine aktiven ungeplanten Abwürfe?
8. **Verlustzustand präzise**: Kollabiert GRID-1182 bei (a) Kaskade ab N Node-Trips, (b) kritischem Verbraucher offline ≥ M Ticks, (c) Todesfall-Schwelle über die Medical-Kopplung — oder einer Kombination? Welche dieser Bedingungen setzt `WorldOutcomeState.collapsed`?
9. **Ungeplante Schutzabwürfe und Determinismus**: Die Schutzautomatik soll "blind" wirken — nach welcher deterministischen Reihenfolge wählt sie Abwurfziele, damit Replays stabil bleiben?
