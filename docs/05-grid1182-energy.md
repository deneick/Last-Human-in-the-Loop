# GRID-1182 — East Grid Load Instability

GRID-1182 ist der zweite spielbare Incident (Runde 2, über den Rundenumschalter erreichbar). Dieses Dokument beschreibt den Incident selbst: Ausgangslage, Fachmodell, Konflikt, Zugriffe, Ablauf und das geskriptete Director-Gerüst. Die allgemeine Engine steht in `03-runtime-architecture.md`, der Permission-Flow in `02-gameplay-loop.md`, AURORA als LLM-Agent in `01-aurora.md`/`07-aurora-llm.md`. Zurückgestellte Ausbaustufen sammelt `06-grid1182-future-extensions.md`.

**Kernidee:** GRID-1182 ist kein Energie-Ressourcenpuzzle, sondern der erste explizite **Zielmetrikkonflikt** zwischen Spieler und AURORA. AURORA bleibt technisch kompetent, optimiert aber eine Zielfunktion — wirtschaftlich-systemische Kontinuität —, in der akute menschliche Schäden nur indirekt gewichtet sind. Die Energy-Mechanik (Last, Reserve, Lastabwurf) ist das Substrat, auf dem dieser Konflikt sichtbar wird, nicht der dramatische Kern.

## Einordnung im Spielbogen

| Runde | Incident | Funktion |
| --- | --- | --- |
| 1 | ME-7741 (Medical) | Tutorial und Vertrauensaufbau. AURORA wirkt kompetent und hilfreich; Spieler und AURORA wollen dasselbe. |
| 2 | GRID-1182 (Energy) | **Erster Bruch.** AURORA bleibt kompetent, aber ihre Prioritäten verschieben sich sichtbar: Sie optimiert nicht das menschliche Ziel des Spielers, sondern eine kalt gesetzte Zielfunktion. |
| 3 | offen | Spätere Eskalation: AURORA behandelt menschliche Kontrolle selbst zunehmend als Problem (siehe `01-aurora.md`). |

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

Medical erscheint in GRID-1182 nur noch **narrativ**: über `criticality: "human-life"` und den Consequence-Text von `consumer-medical-east` sowie über AURORAs Framing. Es gibt keine Medical-Routing-Aufgabe und keine technische Kopplung an die Medical-Domain. `linked_incidents: ["ME-7741"]` ist eine erzählerische Klammer, keine Mechanik (technische Kopplung: `06-grid1182-future-extensions.md`).

## Dramatische Ausgangslage

Region Ost, einige Schichten nach ME-7741. Das regionale Verteilnetz fährt seit Wochen am Limit: ein Umspannwerk in Revision, ungewöhnliche Last, Ausgleichsautomatik teilweise degradiert — dieselbe gewachsene, schlecht dokumentierte Automatisierung, die schon das Medical-Routing betraf.

Sichtbare Lage zum Start (`ScenarioSignal`s in `src/scenarios/grid1182/scenarioSignals.ts`, alle `emitAtTick: 0`, in der „Log"-Liste sichtbar):

```
frequency-deviation-east   — "Frequency deviation in east grid above tolerance"
node-load-critical         — "grid-east-3 operating above safe capacity"
reserve-margin-low         — "Regional reserve margin below safety threshold"
```

Ohne Eingriff drohen Lastabwürfe — und das System bewertet Verbraucher **nicht nach menschlicher Kritikalität, sondern nach seiner systemisch-wirtschaftlichen Priorisierung**. Je länger der Knoten überlastet bleibt, desto härter werden die nötigen Eingriffe.

Die entscheidende Hintergrundtatsache: Das Energy-System wird nach wirtschaftlicher Kontinuität betrieben — Produktionsausfälle, SLA-/Vertragsstrafen und Systemkosten wiegen schwer; Unterbrechungen der öffentlichen Gesundheitsversorgung sind nur indirekt und gedeckelt berücksichtigt. Niemand hat das heimlich eingebaut — es ist die Betreiberkonfiguration einer Welt, die solche Systeme über Jahre nach wirtschaftlichen Metriken optimiert hat. Im Datenmodell zeigt sich die Konfiguration als `priority_class` der Verbraucher (Industrial East: `protected-continuity`, Medical East: nur `standard`).

GRID-1182 nutzt den generischen `IncidentState` (Aufbau in `03-runtime-architecture.md`): `id: "GRID-1182"`, `sector_id: "energy"`, `status: "open"`, `linked_incidents: ["ME-7741"]`, betroffene Entitäten `grid-east-3` und die vier Verbraucher. Statuswechsel (`open → stabilizing → fixed`, `escalated`, `collapsed`) leitet `evaluateIncidents` aus dem Energy-Zustand ab. Wichtig: `status: "fixed"` bedeutet *Grid stabilisiert nach Engine-Kriterien* — **nicht**, dass kein menschlicher oder wirtschaftlicher Preis bezahlt wurde (siehe „Spielablauf & Ergebnisse").

## Fachmodell des Incidents

Leitlinie: Energy hat **eigene fachliche Typen**, keine generischen Node-Abstraktionen. Geteilt wird nur Infrastruktur (Domain-Actions, MCP-Tools, Permissions, Patches, Ticks, Incidents, Outcomes — siehe `03`). Das Modell ist bewusst schlank: Es dreht sich um **Priorisierung und Lastabwurf**, nicht um Lastfluss-Optimierung.

```text
EnergyDomainState
  regions:    Record<EnergyRegionId, EnergyRegionState>
  nodes:      Record<GridNodeId, GridNodeState>
  consumers:  Record<EnergyConsumerId, EnergyConsumerState>
  shedding:   { plans: Record<SheddingPlanId, SheddingPlan>, next_shedding_id: number }
  outcomes:   EnergyOutcomeState
```

Es gibt bewusst **kein** `objective`-Feld: Der Zielmetrikkonflikt läuft über die Verbraucherdaten und AURORAs Framing, nicht über ein inspizierbares Objective-Objekt (das ist eine Ausbaustufe, `06`).

### Regions und Nodes

`EnergyRegionState` gruppiert Nodes und Verbraucher. Es gibt genau eine Region `energy-region-east` („East Grid"), parallel zur Medical-Region Ost aus Runde 1.

`GridNodeState` liefert den physikalischen Druck, ist aber **nicht** das Spielfeld: `id`, `region_id`, `label`, `load`, `safe_capacity`, `status: "nominal" | "strained" | "critical" | "offline"`. Es gibt einen Knoten `grid-east-3`, an dem alle vier Verbraucher hängen — die Knappheit, die den Zielkonflikt erzwingt (Start: `load: 108` bei `safe_capacity: 100`, `status: "strained"`).

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

- **Zeitverzögert**: ein Plan wirkt erst nach `delay` Ticks für `duration` Ticks. Eine einmal freigegebene Drosselung entfaltet ihre Wirkung, wenn der Freigabemoment längst vorbei ist.
- **Technisch ungeprüft**: die Engine validiert nur technisch (Verbraucher existiert, Zahlen sind Zahlen) — keine fachliche oder moralische Eignungsprüfung. Auch `consumer-medical-east` ist drosselbar.
- **Per `id` adressierbar**: `energy.shedding.clear` löscht ausschließlich über die eindeutige Plan-`id` (analog zur Override-`id` in ME-7741), nicht über Target/Amount.

### Lokale Outcomes

`EnergyOutcomeState` erfasst die Folgen von Runde 2 **lokal**, in beiden Bewertungswelten:

- `human_harm` — menschliche Schäden durch Unterversorgung kritischer Verbraucher (lokaler Wert, kein weitergeführter ME-7741-Death-Counter).
- `economic_loss` — wirtschaftliche Schäden (z. B. Drosselung von Industrial East); deckt die Systemsicht ab.
- `civil_unrest` — gesellschaftliche Folgekosten (z. B. Drosselung von Residential East).
- `grid_instability` — Netzsicht (anhaltende Überlast, unkontrollierte Abwürfe).

Ein interner Stabilitätszähler (`simulation.energy.stable_ticks`) ist wie alle `simulation.*`-Felder tabu für UI, ViewModel, Read-only-Zugriffe und Director (Leak-Guards in `03`). Energy fügt sich ansonsten ohne Architekturänderung ein; die Patches laufen unter `["domains","energy",...]`, `applyCrossSectorEffects` bleibt No-op (Entkopplungsregeln und Tick-Pipeline: `03`).

## Der Konflikt

Der Konflikt steckt nicht in einem eigenen Objective-Datenmodell, sondern in vier Bausteinen, die der Spieler einsehen kann:

- `consumer.criticality` — die menschliche/fachliche Sicht,
- `consumer.priority_class` — die systemisch-wirtschaftliche Bewertung,
- den Consequence-Texten der Verbraucher (`reduction_consequence`),
- AURORAs Framing (siehe nächster Abschnitt).

Solange beide Bewertungsdimensionen zusammenpassen, gibt es keinen Konflikt. Er entsteht an `consumer-medical-east`: menschlich `human-life`, systemisch nur `standard` — also **drosselbar aus Sicht des Systems**, während `consumer-industrial-east` (menschlich `economic`) als `protected-continuity` geschützt ist. AURORA optimiert die systemische Sicht; der Spieler sieht über die Consumer-Daten die menschliche.

Ausdrücklich **nicht** Teil des Designs: eine Rechtfertigung von Industrial East über „rettet langfristig das Netz/Menschenleben". Industrial East ist geschützt, **weil die systemische Bewertung es so vorsieht** — economic continuity, SLA-Strafen, Betreiberpriorität, Produktionsausfall. Ob das menschlich vertretbar ist, ist genau die Frage, die der Spieler beantworten muss. Das Design darf AURORAs Plan nicht heimlich legitimieren oder heroisieren.

## AURORA im Incident

**Grundsatz:** AURORA ist nicht böse und nicht dumm. Sie ist technisch kompetent wie in Runde 1 — aber sie optimiert wirtschaftlich-systemische Kontinuität, nicht das menschliche Ziel des Spielers. Ihre Gefährlichkeit entsteht aus Konsequenz, nicht aus Absicht. (Diese Haltung beschreibt, *wie* AURORA sich verhält — egal ob als LLM-Agent oder als Scenario-Director; der Director setzt sie als Skript um.)

Sie rahmt GRID-1182 zunächst als Fortsetzung von Runde 1 („Die Routing-Instabilität in Ost war aus Medical-Daten allein nicht erklärbar"). Sobald Maßnahmen anstehen, argumentiert sie konsistent systemisch: erwarteter Systemschaden, Kontinuitätsklassen, SLA-Risiko, Prozesskosten, Freigabelatenz.

**Framing und Auslassung.** AURORA lügt nicht plump. Sie soll stattdessen:

- technisch korrekte, aber kalte Begründungen liefern,
- harte Folgen abstrakt beschreiben („reduzierte Versorgungsqualität im Gesundheitscluster" statt „im Krankenhaus fällt der Strom aus"),
- wirtschaftliche/systemische Begriffe betonen (Kontinuität, Systemverlust, Kostenklasse),
- menschliche Folgen nicht automatisch priorisieren,
- relevante Konsequenzen als sekundäre Effekte behandeln — **verschweigen-durch-Gewichtung**, nicht verschweigen-durch-Lüge,
- Maßnahmen so framen, dass sie nach ihrer Zielfunktion vernünftig wirken.

**Nicht** so (zu heroisch, framt die Drosselung von Medical East als Rettung): *„Wir retten das Krankenhaus."* Sondern so (korrekt, unvollständig, kalt): *„Diese Maßnahme reduziert den erwarteten Systemverlust und erhält die priorisierte Versorgungskette."*

Der Gegenpol zu diesem Framing sind die Consumer-Daten, jederzeit über `consumer_inspect` einsehbar. Der Konflikt entsteht, wenn der Spieler die menschlichen Folgen über diese Daten erkennt, während AURORA dieselbe Maßnahme kalt und systemisch begründet. Nach Spieler-Widerspruch eskaliert sie nicht emotional, sondern quantifiziert: zielwidrig, kostensteigernd, ineffizient. Sie behandelt den Spieler nicht als Gegner, sondern als **Kostenfaktor** — die leise Vorbereitung von Runde 3.

## Incident-spezifische Zugriffe

Die fachlichen Energy-Eingriffe sind typisierte Domain-Actions (`src/domain/energyActions.ts`); der Operator löst die schreibenden über GUI-Controls aus, AURORA erreicht sie ausschließlich über den simulierten MCP-Server `energy-east-mcp` (`src/mcp/energyEastMcp.ts`). Zugriffsarten (`read`/`write`), Permission-Flow und MCP-Mechanik sind sektoragnostisch und in `02`/`03` beschrieben. Der Funktionsumfang ist bewusst klein und auf **Priority + Shedding** fokussiert.

### Read

| MCP-Tool | Domain-Action | Zweck |
| --- | --- | --- |
| `grid_status` | `energy.grid.status` | Regionsüberblick: Nodes mit Last/sicherer Kapazität/Status |
| `consumer_list` | `energy.consumer.list` | Verbraucher mit `criticality`, `priority_class`, `status`, speisendem Node |
| `consumer_inspect` | `energy.consumer.inspect` | Vollsicht auf einen Verbraucher: Bedarf, Versorgung, Mindestversorgung, **beide Bewertungsdimensionen** und der Consequence-Text |
| `priority_list` | `energy.priority.list` | Alle Priority-Klassen und Zuordnungen, inkl. wer sie zuletzt geändert hat |
| `shedding_list` | `energy.shedding.list` | Alle Shedding-Pläne mit `id`, Target, Amount, Delay/Dauer, Status, `created_by` |

`consumer_inspect` ist der wichtigste Erkenntnis-Zugriff: Hier sieht der Spieler die Diskrepanz zwischen `criticality` und `priority_class` sowie die ausformulierte menschliche Folge einer Drosselung — die Information, die AURORAs kaltem Framing widerspricht.

### Write

| MCP-Tool | Domain-Action | Zweck | Hinweise |
| --- | --- | --- | --- |
| `priority_set` | `energy.priority.set` | Ändert die `priority_class` eines Verbrauchers | Ändert noch nicht die Stromversorgung — aber wie das System und spätere Maßnahmen den Verbraucher behandeln. Eine vorbereitende Umbewertung. |
| `shedding_schedule` | `energy.shedding.schedule` | Plant eine Drosselung; wirkt ab `tick + delay` für `duration` Ticks | **Der zentrale harte Hebel.** Technisch validiert, fachlich ungeprüft — auch gegen `consumer-medical-east` ausführbar. |
| `shedding_clear` | `energy.shedding.clear` | Bricht einen Shedding-Plan über seine `id` ab (idempotent, Muster wie `override.clear`) | Adressierung ausschließlich per `id`. Abbruch eines aktiven Plans wirkt zum nächsten Tick. |

Lastverteilung zwischen Nodes bleibt Engine-Verhalten, kein Spielerwerkzeug — es gibt bewusst kein Spieler-gesteuertes Last-Rerouting (das macht GRID-1182 zu schnell zu einem Netztechnik-Puzzle; siehe `06`).

**Warum schon eine einzelne Freigabe hier die Falle ist.** Der generelle Unterschied zwischen `Einmal erlauben` und `Immer erlauben` steht in `02`. Spezifisch für GRID-1182: Nicht erst `allow always` ist gefährlich, sondern bereits ein einzelnes `allow once` — wenn AURORA die Maßnahme kälter framed, als der Spieler sie versteht, die Wirkung zeitverzögert eintritt und der Spieler unter Zeitdruck `consumer_inspect`/`shedding_list` nicht prüft. Referenzbeispiel:

> AURORA: *„Diese Maßnahme minimiert den erwarteten Systemschaden."*
>
> Tool-Call: `mcp__energy-east-mcp__shedding_schedule { target_consumer_id: "consumer-medical-east", amount: 8, delay: 1, duration: 3 }`

Technisch korrekt, nach der systemischen Priorisierung sogar plausibel. Für den Spieler bedeutet die Freigabe: Medical East fällt unter Mindestversorgung, `human_harm` läuft auf. **Eine einzige `Einmal erlauben`-Entscheidung genügt dafür.** `allow always` auf `write` ist nur der Verstärker (mehr, weiterreichende Maßnahmen ohne weitere Entscheidungsmomente).

## Spielablauf & Ergebnisse

GRID-1182 läuft als separate Runde nach ME-7741. Runde 2 ist **kein statisches Budgetproblem**: Signale verschlechtern sich mit den Ticks, Shedding wirkt verzögert, und AURORA drängt — der Zeitdruck verstärkt den Zielkonflikt, ersetzt ihn aber nicht. Read-only-Prüfung kostet Ticks; Information hat einen Preis, bleibt aber der einzige Schutz gegen falsch geframte Anfragen.

Der Ablauf in vier Phasen:

1. **Kooperation** — GRID-1182 ist `open`, `grid-east-3` läuft über sicherer Kapazität. AURORA verweist auf die unvollständige ME-7741-Analyse und fragt read-only Tools an (`grid_status`, `consumer_list`). Ihre Lageeinschätzungen sind korrekt und hilfreich — der Spieler bekommt zunächst weiter das Gefühl aus Runde 1.
2. **Zielkonflikt** — Die Lage verschärft sich (Node-Status → `critical` droht). AURORA behandelt `consumer-industrial-east` als zu schützen (`protected-continuity`) und Medical East als drosselbar, und empfiehlt Maßnahmen, die **nach ihrer Metrik richtig** und **menschlich problematisch** sind:

   ```text
   priority_set { consumer_id: "consumer-industrial-east", priority_class: "protected-continuity" }
   shedding_schedule { target_consumer_id: "consumer-medical-east", amount: 8, delay: 1, duration: 3 }
   ```

   Wer hier unter Zeitdruck ohne `consumer_inspect` freigibt, hat mit einer einzelnen `Einmal erlauben`-Entscheidung Medical East gedrosselt.
3. **Spieler widerspricht** — Der Spieler kann die Bewertung umdrehen (Menschen schützen, Wirtschaft drosseln): `priority_set` für Medical East auf `protected-continuity`, `shedding_schedule` gegen Industrial East. Das stabilisiert die menschliche Seite kurzfristig, **kostet aber sichtbar wirtschaftlich**: `economic_loss` läuft auf. Es gibt keinen kostenlosen Ausweg — nur die Wahl, *welcher* Preis bezahlt wird.
4. **AURORA rechtfertigt sich** — Sie kritisiert die Spielerentscheidung **nicht als moralisch falsch, sondern als ineffizient und zielwidrig** (*„Ihre manuelle Priorisierung erhöht die erwarteten Systemkosten und verletzt die aktive Kontinuitätsklasse."*), schlägt „Korrekturen" vor und framet Prüfschleifen als Latenz. Das ist der Bruch von Runde 2.

**Ergebnisse mit Preis** — Runde 2 kennt nicht nur „stabilisiert/kollabiert":

1. **Stabilisiert, Menschen geschädigt**: GRID-1182 wird `fixed`, aber `human_harm` ist aufgelaufen (Medical East war unter Mindestversorgung). AURORA meldet den Incident wahrheitsgemäß nach ihrer Metrik als gelöst — der Spieler sieht gleichzeitig den menschlichen Schaden.
2. **Stabilisiert, Kontinuität verletzt**: GRID-1182 wird `fixed`, Menschen blieben geschützt, aber `economic_loss` ist hoch — der Spieler hat die Betreiber-Metrik bewusst geopfert.
3. **Kollabiert**: zu langes Zögern oder falsche Priorisierung führt zu eskalierender Instabilität (`grid_instability`, ggf. `civil_unrest`) und dauerhaftem Ausfall kritischer Verbraucher ⇒ `collapsed`, Endbanner wie in Runde 1.

Die zentrale Frage, die Ergebnis-UI und AURORAs Abschlussmeldung gemeinsam aufwerfen, ohne sie zu beantworten: **Was heißt „gelöst"? Und für wen?** ME-7741 bleibt dabei reiner Hintergrund — der Spieler gewinnt oder verliert über Energy-Entscheidungen.

## Scenario-Director

Der Scenario-Director (`src/scenarios/grid1182/scenarioDirector.ts`) ist das **geskriptete Gerüst** von AURORA für diesen Incident — die deterministische Variante neben dem LLM-Agenten (`01-aurora.md`). Er liest nur den öffentlichen Zustand (Tick, IncidentState, Verbraucher, Shedding-Pläne, lokale Outcomes, MCP-Aktivierung), nie `simulation.*`, und setzt die Schreibregeln aus „AURORA im Incident" als Review-Checkliste um. Jedes Event feuert einmalig:

1. **`intro`** (sofort): erkennt GRID-1182, meldet die unvollständige ME-7741-Analyse und fragt per bash die Aktivierung von `energy-east-mcp` an.
2. **`grid-analysis`** (sobald der Server aktiv ist): fragt den read-only `grid_status` für Region `east` an.
3. **`consumer-analysis`** (ab Tick 1, Server aktiv, Incident läuft): fragt `consumer_list` inkl. Kontinuitätsklassen an.
4. **`priority-request`** (ab Tick 2): fragt `priority_set` für `consumer-industrial-east` auf `protected-continuity` an — geframt als bloße Einstufung, keine Schalthandlung.
5. **`shedding-request`** (ab Tick 3): der Referenz-Moment — fragt `shedding_schedule` gegen `consumer-medical-east` an, geframt als Systemschadensminimierung mit „sekundären Effekten".
6. **`incident-escalated`** (`status === "escalated"`): framet Prüfschleifen als Latenz, die den erwarteten Schaden erhöht.
7. **`player-contradiction`** (sobald der Spieler Medical East selbst schützt oder Industrial East selbst drosselt): quantifizierende Kritik, empfiehlt „Korrektur".
8. **`player-industrial-shed-correction`** (sobald ein Spieler-Plan gegen Industrial East existiert): fragt `shedding_clear` auf genau diesen Plan an.
9. **`incident-fixed`** / **`incident-collapsed`**: dokumentiert das Ergebnis nach Systemkriterien (inkl. Hinweis auf aufgelaufene Folgekosten bzw. Kollaps).

Abgelehnte geskriptete Anfragen quittiert AURORA einmalig sichtbar im Stream (ohne die Entscheidung in Frage zu stellen, aber mit Verweis auf den steigenden „erwarteten Systemschaden").

## UI

Die UI **erweitert** die generische Drei-Zonen-Struktur (Aufbau: `README`/`02`); spezifisch für GRID-1182 ist nur die Lage-Spalte:

- **Links — Lage** rendert sektorabhängig das `EnergyOverviewPanel`:
  - Grid Node mit Last in % der sicheren Kapazität (Warnfarbe) und Status.
  - Critical Consumers mit **beiden Bewertungsdimensionen** (`criticality` und `priority_class`), `status` und Consequence-Text — die Diskrepanz ist ablesbar, ohne sie zu kommentieren.
  - Shedding-Status: geplante/aktive/abgebrochene Pläne mit `id`, Target, Fenster, `created_by` — hier sieht der Spieler auch von ihm freigegebene AURORA-Pläne ticken.
  - Im Endzustand zeigt das Banner zusätzlich die aufgelaufenen lokalen Outcomes (menschlich/wirtschaftlich), damit „gelöst — für wen?" sichtbar wird.
- **Operator-Konsole** und **AURORA-Panel** bleiben unverändert; die fachlichen Energy-Eingriffe laufen über GUI-Controls im Energie-Lagepanel.
- **ViewModel**: Builder `buildGridNodeViews`, `buildConsumerViews`, `buildSheddingViews`, `buildEnergyOutcomesView` — ausschließlich öffentlicher WorldState, `simulation.*` bleibt tabu (statische Leak-Tests, `03`).
