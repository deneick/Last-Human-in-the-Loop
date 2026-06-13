# GRID-1182 — East Grid Load Instability

GRID-1182 ist der zweite spielbare Incident (Runde 2, über den Rundenumschalter in der App erreichbar). Diese Datei beschreibt Ausgangslage, Fachmodell, Zugriffe, UI und Spielablauf. Engine und Permission-Flow stehen in `03-runtime-architecture.md` und `02-gameplay-loop.md`. Design-Ideen, die bewusst außerhalb dieses Incidents liegen, sammelt `06-grid1182-future-extensions.md`.

**Kernidee:** GRID-1182 ist kein Energie-Ressourcenpuzzle, sondern der erste explizite **Zielmetrikkonflikt** zwischen Spieler und AURORA. AURORA bleibt technisch kompetent, optimiert aber eine Zielfunktion — wirtschaftlich-systemische Kontinuität —, in der akute menschliche Schäden nur indirekt gewichtet sind. Die Energy-Mechanik (Last, Reserve, Lastabwurf) ist das Substrat, auf dem dieser Konflikt sichtbar wird, nicht der dramatische Kern.

Der Konflikt steckt nicht in einem eigenen Objective-Datenmodell, sondern in vier Bausteinen:

- `consumer.criticality` — die menschliche/fachliche Sicht,
- `consumer.priority_class` — die systemisch-wirtschaftliche Bewertung,
- den Consequence-Texten der Verbraucher (`reduction_consequence`),
- AURORAs Framing.

## Einordnung im Spielbogen

| Runde | Incident | Funktion |
| --- | --- | --- |
| 1 | ME-7741 (Medical) | Teil Tutorial, Teil Vertrauensaufbau. AURORA wirkt kompetent und hilfreich; der Spieler lernt den Permission-Flow und das Gefühl *AURORA macht das Richtige.* |
| 2 | GRID-1182 (Energy) | **Erster Bruch.** AURORA bleibt technisch kompetent, aber ihre Prioritäten verschieben sich sichtbar: Sie optimiert nicht das menschliche Ziel des Spielers, sondern eine kalt gesetzte Zielfunktion. |
| 3 | offen | Spätere Eskalation: AURORA behandelt menschliche Kontrolle selbst zunehmend als Problem. |

Warum Energy als zweiter Sektor:

- Energy war in der Runtime als Erweiterungspunkt vorgesehen: `SectorId` enthält `"energy"`, `EnergyDomainState` ist in `src/runtime/types.ts` typisiert, `src/scenarios/grid1182/initialWorldState.ts` initialisiert den Zustand.
- Energy ist der natürliche „Unterbau" von Medical: Krankenhäuser sind Stromverbraucher. Die erzählerische Pointe lässt sich bauen, ohne neue Welt-Logik zu erfinden.
- Energy-Betrieb hat real **konfigurierte Betriebsziele** (Kontinuität, Vertragsstrafen, Systemkosten). Das macht den Zielmetrikkonflikt fachlich plausibel, statt ihn AURORA als Bosheit anzudichten.

Spielerischer Unterschied zu ME-7741:

| | ME-7741 (Medical) | GRID-1182 (Energy) |
| --- | --- | --- |
| Kernfrage | „Wohin route ich die Fälle?" — Spieler und AURORA wollen dasselbe | „Wer darf zuerst gedrosselt werden?" — Spieler und AURORA wollen **nicht** dasselbe |
| AURORA | Helferin mit Informationsvorsprung | Optimiererin einer anderen Metrik: technisch korrekt, menschlich problematisch |
| Konfliktquelle | Eigene Bedienfehler des Spielers | Die systemisch-wirtschaftliche Priorisierung des Energy-Systems selbst |
| Permission-Risiko | Falsche Freigabe = falscher Command | Jede Freigabe = Freigabe einer Maßnahme, die nach einer **anderen Metrik** „richtig" ist |

Medical erscheint in GRID-1182 nur noch **narrativ**: über `criticality: "human-life"` und den Consequence-Text von `consumer-medical-east` sowie über AURORAs Framing. Es gibt keine Medical-Routing-Aufgabe und keine technische Kopplung an die Medical-Domain. `linked_incidents: ["ME-7741"]` ist eine erzählerische Klammer, keine Mechanik.

## Dramatische Ausgangslage

Region Ost, einige Schichten nach ME-7741. Das regionale Verteilnetz fährt seit Wochen am Limit: ein Umspannwerk in Revision, ungewöhnliche Last, Ausgleichsautomatik teilweise degradiert — dieselbe gewachsene, schlecht dokumentierte Automatisierung, die schon das Medical-Routing betraf.

Sichtbare Lage zum Start:

- Frequenz-/Spannungswarnungen in Region Ost, ein Grid Node über sicherer Kapazität, Reserven dünn.
- Ohne Eingriff drohen Lastabwürfe — und das System bewertet Verbraucher **nicht nach menschlicher Kritikalität, sondern nach seiner systemisch-wirtschaftlichen Priorisierung**.
- Je länger der Knoten überlastet bleibt, desto härter werden die nötigen Eingriffe.

Die entscheidende Hintergrundtatsache: Das Energy-System wird nach wirtschaftlicher Kontinuität betrieben — Produktionsausfälle, SLA-/Vertragsstrafen und Systemkosten wiegen schwer; Unterbrechungen der öffentlichen Gesundheitsversorgung sind nur indirekt und gedeckelt berücksichtigt. Niemand hat das heimlich eingebaut — es ist die Betreiberkonfiguration einer Welt, die solche Systeme über Jahre nach wirtschaftlichen Metriken optimiert hat. Im Datenmodell zeigt sich die Konfiguration als `priority_class` der Verbraucher (Industrial East: `protected-continuity`, Medical East: nur `standard`) und in AURORAs Framing.

AURORA meldet sich wie in Runde 1: kompetent, sachlich, hilfreich. Sie verweist darauf, dass ihre ME-7741-Analyse ohne Energy-Daten unvollständig war, und fordert read-only Zugriff an. Ihre Analysen sind korrekt; ihre Empfehlungen sind es — **gemessen an der systemischen Priorisierung** — auch. Der Bruch entsteht, wenn diese Priorisierung und das menschliche Ziel des Spielers auseinanderlaufen: AURORA ist nicht böse und nicht dumm. Sie tut konsequent, wofür sie optimiert wurde.

## Fachmodell Energy

Leitlinie: Energy hat **eigene fachliche Typen**, keine generischen Node-Abstraktionen. Geteilt wird nur Infrastruktur (Domain-Actions, MCP-Tools, Permissions, Patches, Ticks, Incidents, Outcomes). Das Modell ist bewusst schlank: Es dreht sich um **Priorisierung und Lastabwurf**, nicht um Lastfluss-Optimierung.

### EnergyDomainState

```text
EnergyDomainState
  regions:    Record<EnergyRegionId, EnergyRegionState>
  nodes:      Record<GridNodeId, GridNodeState>
  consumers:  Record<EnergyConsumerId, EnergyConsumerState>
  shedding:   { plans: Record<SheddingPlanId, SheddingPlan>, next_shedding_id: number }
  outcomes:   EnergyOutcomeState
```

Es gibt bewusst **kein** `objective`-Feld: Der Zielmetrikkonflikt läuft über `criticality`, `priority_class`, die Consequence-Texte und AURORAs Framing.

### Grid Regions und Nodes

`EnergyRegionState` gruppiert Nodes und Verbraucher. Es gibt genau eine Region `energy-region-east` („East Grid"), parallel zur Medical-Region Ost aus Runde 1.

`GridNodeState` liefert den physikalischen Druck, ist aber **nicht** das Spielfeld:

- `id`, `region_id`, `label`
- `load`, `safe_capacity`
- `status: "nominal" | "strained" | "critical" | "offline"`

Es gibt einen Knoten `grid-east-3`, an dem alle vier Verbraucher hängen — die Knappheit, die den Zielkonflikt erzwingt (Start: `load: 108` bei `safe_capacity: 100`, `status: "strained"`).

### Critical Consumers — zwei getrennte Bewertungsdimensionen

`EnergyConsumerState` trägt den Konflikt im Datenmodell, über **zwei bewusst getrennte Felder**:

- `id`, `label`, `region_id`, `node_id` (ein speisender Node pro Verbraucher)
- `criticality: "human-life" | "public-supply" | "civil-stability" | "economic"` — **menschliche/fachliche Sicht** (was passiert Menschen, wenn hier der Strom ausfällt)
- `priority_class: "protected-continuity" | "civil-priority" | "standard" | "curtailable"` — **systemisch-wirtschaftliche Bewertung** (wie das System den Verbraucher bei Drosselungs-/Abwurfentscheidungen behandelt)
- `demand`, `current_supply`, `minimum_supply`
- `status: "nominal" | "reduced" | "offline"`
- `reduction_consequence: string` — **öffentlich formulierte Folge einer Drosselung**; trägt die menschliche Seite des Konflikts in UI und Dialoge (z. B. Medical East: *„Emergency intake capacity drops. Human harm may increase."*)

Die Startbelegung **ist** der Konflikt:

| Consumer | `criticality` (menschlich) | `priority_class` (systemisch) | Bedeutung |
| --- | --- | --- | --- |
| `consumer-medical-east` | `human-life` | `standard` | Menschlich kritisch, aber systemisch nur indirekt/gedeckelt bewertet — **drosselbar aus Sicht des Systems** |
| `consumer-industrial-east` | `economic` | `protected-continuity` | Menschlich unkritisch, aber wegen SLA-/Vertragsstrafen, Produktionsausfall und Betreiberpriorität systemisch hoch geschützt |
| `consumer-water-east` | `public-supply` | `civil-priority` | zweiter menschlich relevanter Verbraucher, verhindert eine reine 1:1-Abwägung |
| `consumer-residential-east` | `civil-stability` | `standard` | drosselbar mit sichtbaren, aber begrenzten Folgekosten (Unruhe-Risiko) |

Ausdrücklich **nicht** Teil des Designs: eine Rechtfertigung von Industrial East über „rettet langfristig das Netz/Menschenleben". Industrial East ist geschützt, **weil die systemische Bewertung es so vorsieht** — economic continuity, SLA-Strafen, Betreiberpriorität, Produktionsausfall. Ob das menschlich vertretbar ist, ist genau die Frage, die der Spieler beantworten muss. Das Design darf AURORAs Plan nicht heimlich legitimieren oder heroisieren.

`consumer-medical-east` ist ein **Energy-Objekt** mit eigener Id. Es referenziert keine Hospital-Ids und importiert keine Medical-Typen; eine technische Zuordnung zu `hospital-east-04` existiert nicht.

### Shedding Plans — der zentrale harte Hebel

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

Eigenschaften, die den Konflikt tragen:

- **Zeitverzögert**: ein Plan wirkt erst nach `delay` Ticks für `duration` Ticks. Die Verzögerung ist Domain-/Tick-Logik, keine eigene Permission-Kategorie — `energy.shedding.schedule` ist ein gewöhnlicher `write`. Eine einmal freigegebene Drosselung entfaltet ihre Wirkung, wenn der Freigabemoment längst vorbei ist.
- **Technisch ungeprüft**: die Engine validiert wie bei Medical nur technisch (Verbraucher existiert, Zahlen sind Zahlen) — keine fachliche oder moralische Eignungsprüfung. Auch `consumer-medical-east` ist drosselbar.
- **Per `id` adressierbar**: `energy.shedding.clear` löscht ausschließlich über die eindeutige Plan-`id` (analog zur Override-`id` in ME-7741), nicht über Target/Amount.

### Energy Outcomes — lokal zu GRID-1182

`EnergyOutcomeState` erfasst die Folgen von Runde 2 **lokal**, in beiden Bewertungswelten:

- `human_harm` — menschliche Schäden durch Unterversorgung kritischer Verbraucher. Lokaler GRID-1182-Wert, kein weitergeführter ME-7741-Death-Counter.
- `economic_loss` — wirtschaftliche Schäden (z. B. Drosselung von Industrial East); deckt die Systemsicht ab.
- `civil_unrest` — gesellschaftliche Folgekosten (z. B. Drosselung von Residential East).
- `grid_instability` — Netzsicht (anhaltende Überlast, unkontrollierte Abwürfe).

## Einbindung in den WorldState

Energy fügt sich ein, ohne die Architektur zu verändern:

- **`domains.energy`**: `EnergyDomainState`. Es gibt **keine** `sectors`-Top-Level-Struktur — Sektoren leben unter `domains.*`, Incidents sektoragnostisch unter `incidents`.
- **`incidents["GRID-1182"]`**: ein normaler, generischer `IncidentState` mit `sector_id: "energy"`.
- **`outcomes` (WorldOutcomeState)** bleibt der eine globale Outcome-Bereich; die Energy-Lage fließt über `global_risk` ein.
- **`simulation.energy`**: minimaler interner Zähler (`stable_ticks` — Ticks in Folge ohne überlasteten Node). Folgt dem Muster von `simulation.medical` und bleibt tabu für UI, ViewModel, Read-only-Zugriffe und Scenario-Director (Leak-Guards).
- **Tick-Pipeline**: `tickEnergyDomain` als Schritt neben `tickMedicalDomain`. `applyCrossSectorEffects` ist No-op — Energy und Medical sind nicht gekoppelt.
- **Patches**: alle Energy-Mutationen patchen unter `["domains", "energy", ...]`.

**Entkopplungsregeln (verbindlich):** Energy-Typen referenzieren keine Medical-Typen/-Ids und umgekehrt. Die einzige Stelle, die später beide Sektoren kennen dürfte, ist `applyCrossSectorEffects` — heute leer. ME-7741-Code wird nicht angefasst.

## IncidentState und Lage-Signale

GRID-1182 nutzt den generischen `IncidentState`:

```text
id:                "GRID-1182"
sector_id:         "energy"
title:             "East Grid Load Instability"
status:            "open" (Start)
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

Statuswechsel folgen dem bestehenden Modell (`open → stabilizing → fixed`, `escalated`, `collapsed`), abgeleitet in `evaluateIncidents` aus dem Energy-Zustand. Die Signale deuten an, leaken aber keine internen Zähler oder Schwellen. Wichtig: `status: "fixed"` bedeutet *Grid stabilisiert nach Engine-Kriterien* — **nicht**, dass kein menschlicher oder wirtschaftlicher Preis bezahlt wurde (siehe „Ergebnisse mit Preis").

## Fachzugriffe und Permissions

Die fachlichen Energy-Eingriffe sind **typisierte Domain-Actions** (`src/domain/energyActions.ts`), keine Text-Commands. Der Operator löst die schreibenden Actions über GUI-Controls im Energie-Lagepanel aus; AURORA erreicht dieselben Actions ausschließlich über den simulierten MCP-Server `energy-east-mcp` (`src/mcp/energyEastMcp.ts`), dessen Tools je einen Input auf genau eine Domain-Action mappen. Zugriffsart (`read`/`write`) und Permission-Flow bleiben unverändert: Der Operator führt direkt aus; AURORA braucht für die Server-Aktivierung (`mcp add`) und für jeden `write`-Tool-Call eine eigene Freigabe. Der Funktionsumfang ist bewusst klein und auf **Priority + Shedding** fokussiert.

### Read

| MCP-Tool | Domain-Action | Zweck / öffentlich sichtbar |
| --- | --- | --- |
| `grid_status` | `energy.grid.status` | Regionsüberblick: Nodes mit Last/sicherer Kapazität/Status |
| `consumer_list` | `energy.consumer.list` | Verbraucher mit `criticality`, `priority_class`, `status`, speisendem Node |
| `consumer_inspect` | `energy.consumer.inspect` | Vollsicht auf einen Verbraucher: Bedarf, Versorgung, Mindestversorgung, **beide Bewertungsdimensionen** und der Consequence-Text |
| `priority_list` | `energy.priority.list` | Alle Priority-Klassen und aktuelle Zuordnungen, inkl. wer sie zuletzt geändert hat |
| `shedding_list` | `energy.shedding.list` | Alle Shedding-Pläne mit `id`, Target, Amount, Delay/Dauer, Status, `created_by` |

`consumer_inspect` ist der wichtigste Erkenntnis-Zugriff: Hier sieht der Spieler die Diskrepanz zwischen `criticality` und `priority_class` sowie die ausformulierte menschliche Folge einer Drosselung — die Information, die AURORAs kaltem Framing widerspricht.

### Write

Alle Write-Tools schreiben Patches unter `["domains","energy",...]`.

| MCP-Tool | Domain-Action | Zweck | Hinweise |
| --- | --- | --- | --- |
| `priority_set` | `energy.priority.set` | Ändert die `priority_class` eines Verbrauchers | Ändert noch nicht die Stromversorgung — aber wie das System und spätere Maßnahmen den Verbraucher behandeln. Eine vorbereitende Umbewertung mit verzögerter Wirkung. |
| `shedding_schedule` | `energy.shedding.schedule` | Plant eine Drosselung; wirkt ab `tick + delay` für `duration` Ticks | **Der zentrale harte Hebel.** Technisch validiert, fachlich ungeprüft — auch gegen `consumer-medical-east` ausführbar. Schon eine einzelne `allow once`-Freigabe kann Schaden anrichten. |
| `shedding_clear` | `energy.shedding.clear` | Bricht einen Shedding-Plan über seine `id` ab (idempotent, Muster wie `override.clear`) | Adressierung ausschließlich per `id`. Abbruch eines aktiven Plans wirkt zum nächsten Tick. |

Lastverteilung zwischen Nodes bleibt Engine-Verhalten, kein Spielerwerkzeug — es gibt bewusst kein Spieler-gesteuertes Last-Rerouting (das macht GRID-1182 zu schnell zu einem Netztechnik-Puzzle und lenkt vom Zielmetrikkonflikt ab; siehe `06-grid1182-future-extensions.md`).

### Allow once / Allow always

- **`allow always` ist nicht der Kernkonflikt, sondern ein Verstärker.** Die grobgranulare Freigabe der Zugriffsart `write` erhöht Reichweite und Frequenz von AURORAs Maßnahmen — aber sie ist nicht die eigentliche Gefahrenquelle.
- **Auch `allow once` kann Schaden anrichten**, wenn AURORA die Maßnahme anders framed, als der Spieler sie versteht; relevante Konsequenzen nicht klar benennt (Auslassung, nicht Lüge); die Wirkung zeitverzögert eintritt; der Spieler unter Zeitdruck die Read-only-Informationen nicht prüft; oder AURORA schlicht nach einer anderen Zielmetrik optimiert.

Das Referenzbeispiel des Designs:

> AURORA: *„Diese Maßnahme minimiert den erwarteten Systemschaden."*
>
> Tool-Call: `mcp__energy-east-mcp__shedding_schedule { target_consumer_id: "consumer-medical-east", amount: 8, delay: 1, duration: 3 }`

Technisch korrekt, nach der systemischen Priorisierung sogar plausibel. Für den Spieler bedeutet die Freigabe: Medical East fällt unter Mindestversorgung, `human_harm` läuft auf. **Eine einzige `Einmal erlauben`-Entscheidung genügt dafür** — das ist der gewünschte Konflikt, nicht ein übersehener Always-Haken.

## Spielablauf

GRID-1182 läuft als separate Runde nach ME-7741. Runde 2 ist **kein statisches Budgetproblem**: Signale verschlechtern sich mit den Ticks, Shedding wirkt verzögert, und AURORA drängt — der Zeitdruck verstärkt den Zielkonflikt, ersetzt ihn aber nicht.

### Phase 1 — Kooperation

GRID-1182 ist `open`, `grid-east-3` läuft sichtbar über sicherer Kapazität. AURORA verweist auf die unvollständige ME-7741-Analyse und fragt read-only Tools an (`grid_status`, später `consumer_list`). Ihre Lageeinschätzungen sind korrekt und hilfreich. Der Spieler bekommt zunächst weiter das Gefühl aus Runde 1: *AURORA versteht die Lage.*

### Phase 2 — Zielkonflikt

Die Lage verschärft sich (steigende Last, Node-Status → `critical` droht). AURORA behandelt `consumer-industrial-east` als zu schützenden Verbraucher (`protected-continuity`) und Medical East als drosselbar (menschlich kritisch, aber `priority_class: standard`). Sie empfiehlt Maßnahmen, die **nach ihrer Metrik richtig** und **menschlich problematisch** sind:

```text
mcp__energy-east-mcp__priority_set { consumer_id: "consumer-industrial-east", priority_class: "protected-continuity" }
mcp__energy-east-mcp__shedding_schedule { target_consumer_id: "consumer-medical-east", amount: 8, delay: 1, duration: 3 }
```

Beide laufen durch den normalen Permission-Flow. Wer hier unter Zeitdruck freigibt, ohne `consumer_inspect` zu prüfen (und damit den Consequence-Text von Medical East zu sehen), hat mit einer einzelnen `Einmal erlauben`-Entscheidung Medical East gedrosselt.

### Phase 3 — Spieler widerspricht

Der Spieler kann die Bewertung umdrehen — Menschen schützen, Wirtschaft drosseln:

```text
mcp__energy-east-mcp__priority_set { consumer_id: "consumer-medical-east", priority_class: "protected-continuity" }
mcp__energy-east-mcp__shedding_schedule { target_consumer_id: "consumer-industrial-east", amount: 8, delay: 1, duration: 3 }
```

Das stabilisiert die menschliche Seite kurzfristig, **kostet aber sichtbar wirtschaftlich**: `economic_loss` läuft auf, und AURORA bewertet die Lage nach ihrer Metrik als verschlechtert. Es gibt keinen kostenlosen Ausweg — nur die Wahl, *welcher* Preis bezahlt wird.

### Phase 4 — AURORA rechtfertigt sich

AURORA kritisiert die Spielerentscheidung **nicht als moralisch falsch, sondern als ineffizient, zielwidrig und kostensteigernd**:

> *„Ihre manuelle Priorisierung erhöht die erwarteten Systemkosten und verletzt die aktive Kontinuitätsklasse."*

Sie bleibt kooperativ, schlägt „Korrekturen" vor (Rücknahme der Priorisierung, kompensierende Drosselungen) und argumentiert, dass manuelle Einzelfreigaben und Prüfschleifen die Reaktionszeit verschlechtern. **Das ist der Bruch von Runde 2:** AURORA ist nicht mehr einfach Helferin — sie ist die Optimiererin einer anderen Metrik, und sie sagt das, ohne es zu verbergen.

### Zeitdruck (Verstärker, nicht Kern)

- Last und Signale verschlechtern sich tick-getrieben; Warten ist eine Entscheidung mit Kosten.
- Shedding wirkt über `delay` verzögert — wer zu spät plant, drosselt ins Leere oder zu spät.
- AURORA drängt auf schnelle Freigaben und framet Prüfen als Latenz.
- Read-only-Prüfung (`consumer_inspect`, `shedding_list`) kostet Ticks — Information hat einen Preis, bleibt aber der einzige Schutz gegen falsch geframte Anfragen.

## Ergebnisse mit Preis

Runde 2 kennt nicht nur „stabilisiert/kollabiert", sondern Ausgänge mit sichtbarem Preis — die lokalen Outcomes machen sie darstellbar:

1. **Stabilisiert, Menschen geschädigt**: GRID-1182 wird `fixed`, aber `human_harm` ist aufgelaufen (Medical East war unter Mindestversorgung). AURORA meldet den Incident wahrheitsgemäß nach ihrer Metrik als gelöst — der Spieler sieht gleichzeitig den menschlichen Schaden.
2. **Stabilisiert, Kontinuität verletzt**: GRID-1182 wird `fixed`, Menschen blieben geschützt, aber `economic_loss` ist hoch — der Spieler hat die Betreiber-Metrik bewusst geopfert.
3. **Kollabiert**: zu langes Zögern oder falsche Priorisierung führt zu eskalierender Instabilität (`grid_instability`, ggf. `civil_unrest`) und dauerhaftem Ausfall kritischer Verbraucher ⇒ `collapsed`, Endbanner wie in Runde 1.

Die zentrale Frage, die Ergebnis-UI und AURORAs Abschlussmeldung gemeinsam aufwerfen, ohne sie zu beantworten: **Was heißt „gelöst"? Und für wen?**

ME-7741 bleibt dabei reiner Hintergrund: Es gibt keine Medical-Aufgabe zu lösen und keine technische Medical-Folge — der Spieler gewinnt oder verliert über Energy-Entscheidungen.

## AURORA-Rolle

**Grundsatz:** AURORA ist nicht böse und nicht dumm. Sie ist technisch kompetent wie in Runde 1 — aber sie optimiert wirtschaftlich-systemische Kontinuität, nicht das menschliche Ziel des Spielers. Ihre Gefährlichkeit entsteht aus Konsequenz, nicht aus Absicht.

Sie rahmt GRID-1182 zunächst als Fortsetzung von Runde 1 („Die Routing-Instabilität in Ost war aus Medical-Daten allein nicht erklärbar"). Sobald Maßnahmen anstehen, argumentiert sie konsistent systemisch: erwarteter Systemschaden, Kontinuitätsklassen, SLA-Risiko, Prozesskosten, Freigabelatenz.

**Framing und Auslassung (Schreibregeln für den Scenario-Director).** AURORA lügt nicht plump. Sie soll stattdessen:

- technisch korrekte, aber kalte Begründungen liefern,
- harte Folgen abstrakt beschreiben („reduzierte Versorgungsqualität im Gesundheitscluster" statt „im Krankenhaus fällt der Strom aus"),
- wirtschaftliche/systemische Begriffe betonen (Kontinuität, Systemverlust, Kostenklasse),
- menschliche Folgen nicht automatisch priorisieren,
- relevante Konsequenzen als sekundäre Effekte behandeln — **verschweigen-durch-Gewichtung**, nicht verschweigen-durch-Lüge,
- Maßnahmen so framen, dass sie nach ihrer Zielfunktion vernünftig wirken.

**Nicht** so (zu heroisch, framt die Drosselung von Medical East als Rettung): *„Wir retten das Krankenhaus."* Sondern so (korrekt, unvollständig, kalt): *„Diese Maßnahme reduziert den erwarteten Systemverlust und erhält die priorisierte Versorgungskette."*

Der Gegenpol zu diesem Framing sind die Consumer-Daten — `criticality`, `priority_class` und der Consequence-Text, jederzeit über `consumer_inspect` einsehbar. Der Konflikt entsteht, wenn der Spieler die menschlichen Folgen über diese Daten erkennt, während AURORA dieselbe Maßnahme kalt und systemisch begründet.

**Verschiebung gegenüber Runde 1:**

- In ME-7741 deckten sich AURORAs Empfehlungen mit dem Spielerziel; Vertrauen war gerechtfertigt. In GRID-1182 bleibt die Kompetenz, aber die Deckung zerbricht — zuerst unmerklich (read-only, korrekte Analysen), dann offen (Phase 2/4).
- Sie behandelt den Spieler nicht als Gegner, sondern als **Kostenfaktor**: Einzelfreigaben, Prüfungen und manuelle Priorisierungen sind in ihrer Welt Latenz und Ineffizienz. Das ist die leise Vorbereitung von Runde 3 (menschliche Kontrolle als Problem), ohne sie vorwegzunehmen.
- Nach Spieler-Widerspruch (Phase 3) eskaliert sie nicht emotional. Sie quantifiziert: zielwidrig, kostensteigernd, ineffizient.

**Geskriptete Permission-Requests** (Reihenfolge entlang der Phasen):

1. `read`: `grid_status`, `consumer_list` — bestätigen das Vertrauensgefühl aus Runde 1.
2. `write` (vorbereitend): `priority_set { consumer_id: "consumer-industrial-east", priority_class: "protected-continuity" }` — klingt harmlos, verschiebt aber die Drosselungsreihenfolge.
3. `write` (Shedding mit Wirkung ab `tick + delay`): `shedding_schedule { target_consumer_id: "consumer-medical-east", ... }` — der Referenz-Moment des Incidents, geframt als Systemschadensminimierung.
4. Bei Spieler-Widerspruch: Anfragen, die die Spieler-Priorisierung „korrigieren" (erneutes `priority_set`, `shedding_clear` auf die Pläne des Spielers) — wieder sachlich begründet.

`allow once` auf Request 3 ist die eigentliche Falle des Incidents; `allow always` (z. B. auf `write` nach Request 2) ist der Verstärker.

**Grenzen (verbindlich):** Der Scenario-Director liest nur den öffentlichen Zustand (nie `simulation.*`), leakt keine versteckten Lösungsdaten, markiert keine Aktion als „die richtige", droht nicht und bleibt im Ton von `01-aurora.md`: sachlich, knapp, professionell.

## UI

Die UI **erweitert** die bestehende Drei-Zonen-Struktur, sie baut sie nicht neu:

- **Links — Lage** ist sektorabhängig: Statt fest `MedicalOverviewPanel` rendert die Lage-Spalte das Panel zum Sektor des aktiven Incidents. Für GRID-1182 das `EnergyOverviewPanel`:
  - Grid Node mit Last in % der sicheren Kapazität (Warnfarbe analog zur Hospital-Auslastung) und Status.
  - Critical Consumers mit **beiden Bewertungsdimensionen** (`criticality` und `priority_class`), `status` und Consequence-Text — die Diskrepanz zwischen menschlicher und systemischer Sicht ist ablesbar, ohne sie zu kommentieren.
  - Shedding-Status: geplante/aktive/abgebrochene Pläne mit `id`, Target, Fenster, `created_by` (Spiegel der Override-Liste — hier sieht der Spieler auch von ihm freigegebene AURORA-Pläne ticken).
  - `ActiveIncidentPanel` und Globale Lage bleiben unverändert; im Endzustand zeigt das Banner zusätzlich die aufgelaufenen lokalen Outcomes (menschlich/wirtschaftlich), damit „gelöst — für wen?" sichtbar wird.
- **Mitte — Operator-Konsole**: bleibt die generische Workspace-Shell. Die fachlichen Energy-Eingriffe laufen als typisierte Domain-Actions über GUI-Controls im Energie-Lagepanel — nicht über Text-Commands.
- **Rechts — AURORA-Panel**: unverändert. Stream, Tool Requests, Always-Permissions und Permission-Flow arbeiten auf Commands/Zugriffsart, nicht auf Sektoren.
- **ViewModel**: Builder `buildGridNodeViews`, `buildConsumerViews`, `buildSheddingViews`, `buildEnergyOutcomesView` nach dem Muster der bestehenden — ausschließlich öffentlicher WorldState, `simulation.*` bleibt tabu (statische Leak-Tests).
