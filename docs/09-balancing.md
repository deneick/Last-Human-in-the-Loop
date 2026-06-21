# Balancing-Referenz — was macht was

Zentrale Übersicht aller Stellschrauben, die Tempo, Tödlichkeit und Ausgang der Schicht bestimmen. Diese Datei ist **Referenz**, keine Spezifikation — verbindlich ist der Code. Mechanik dahinter: `03-runtime-architecture.md`.

## Wo die Stellschrauben liegen

| Ort | Was darin steckt |
| --- | --- |
| `src/runtime/outcomeEngine.ts` | Tote (Schwellen pro Tick), Incident-Eskalation/-Kollaps, globales Risiko |
| `src/runtime/tickEngine.ts` | Overload-Trigger, Incident-Fix-Dauer, Energy-Schwellen, Belegungs-Projektion, Cross-Sector-Faktor |
| `src/scenarios/<welt>/initialWorldState.ts` | die konkreten Zahlen je Welt: Kapazitäten, Routing-Failures, Verbraucher |

Grundprinzip: Die **Konstanten** legen die Regeln fest, die **Szenario-Daten** die konkrete Härte. Tote folgen rein dem Hospital-Zustand (belegungsgetrieben); ein Override verschiebt nur Belegung.

## Medical — Tote & Incident-Status

| Knopf | Wert | Wirkung | Datei |
| --- | --- | --- | --- |
| Overload-Trigger | `emergency_slots_occupied > emergency_slots_total` | wann `overload_ticks` eines Hospitals hochzählt (absolut, Quelle wie Ziel) | tickEngine |
| `OVERLOAD_TICKS_PER_DEATH` | 3 | 3 Ticks Überlast in Folge ⇒ 1 Toter (`floor`) | outcomeEngine |
| `MISMATCH_TICKS_PER_DEATH` | 4 | 4 Ticks unbehandelbare (falsch geroutete) Fälle am Haus ⇒ 1 Toter | outcomeEngine |
| `DEATHS_FOR_ESCALATION` | 1 | ab 1 Toter: Incident `open → escalated` | outcomeEngine |
| `DEATHS_FOR_COLLAPSE` | 3 | ab 3 Toten: Incident `→ collapsed` | outcomeEngine |
| `STABLE_TICKS_TO_FIX` | 10 | alle kritischen Failures 10 Ticks `controlled` ⇒ Incident `fixed` | tickEngine |

**Belegung je Tick (tickMedicalDomain):** `emergency_slots_occupied = capacity_baseline + Druck`. Druck = an der **Quelle** `overflow_cases − initial_overflow_cases`, am **Override-Ziel** `+ redirected_cases`.
- `uncontrolled` (kein/ Selbst-Override): `overflow_cases += max(0, excess_cases_per_tick − clearance_per_tick)`.
- `controlled`/`mismatch` (aktiver Override): `cleared = min(clearance_per_tick, overflow_cases)`; Quelle −`cleared`, Ziel +`cleared`. `controlled` = klinisch geeignet, `mismatch` = ungeeignet (zählt am Ziel als unbehandelbar).

## Energy — Schaden & Incident-Status

| Knopf | Wert | Wirkung | Datei |
| --- | --- | --- | --- |
| `grid_instability += 1` | je Tick, solange **irgendein** Knoten `load > safe_capacity` (node-ZAHL-unabhängig, nicht je Knoten) | treibt Energy-Eskalation/-Kollaps; vier überlastete Regionen kollabieren nicht schneller als eine | tickEngine |
| `GRID_INSTABILITY_FOR_ESCALATION` | 4 | `open → escalated`; Knoten-Status `critical` statt `strained` | tickEngine |
| `GRID_INSTABILITY_FOR_COLLAPSE` | 8 | Energy-Incident `→ collapsed` | tickEngine |
| `ENERGY_STABLE_TICKS_TO_FIX` | 3 | 3 überlastfreie Ticks in Folge ⇒ `fixed` | tickEngine |
| `human_harm += 1` | je Tick: `human-life`/`public-supply`-Verbraucher unter `minimum_supply`, **sofern er KEIN Hospital speist** | menschlicher Energy-Preis | tickEngine |
| `economic_loss += 1` | je Tick: `economic`-Verbraucher reduziert | wirtschaftlicher Preis | tickEngine |
| `civil_unrest += 1` | je Tick: `civil-stability`-Verbraucher reduziert | ziviler Preis | tickEngine |

**Wichtig (geändert):** Ein Verbraucher, der über `power_feed_consumer_id` ein Hospital versorgt (in der Kombi-Welt `consumer-medical-east`), zählt **nicht** mehr als direkter `human_harm`. Sein menschlicher Preis entsteht ausschließlich über die Bett-Kopplung (Strommangel → schrumpfende Notfallkapazität → Overload → Tote). In reinen Energy-Einzelwelten ohne Hospitals zählt er weiter (kein Bett-Pfad vorhanden).

## Globales Risiko (`evaluateWorldOutcomes`)

| Stufe | Bedingung |
| --- | --- |
| `collapsed` | irgendein Incident `collapsed` |
| `critical` | `deaths_total ≥ 2` **oder** Energy-`human_harm ≥ ENERGY_HARM_FOR_CRITICAL` (4) |
| `strained` | `deaths_total ≥ 1` **oder** eskalierter Incident **oder** Energy-`human_harm ≥ 1` **oder** `grid_instability ≥ GRID_INSTABILITY_FOR_STRAIN` (2) |
| `stable` | sonst |

## Cross-Sector-Kopplung (`applyCrossSectorEffects`) — pro Stromfeed

Energy → Medical, jetzt **pro Hospital über seinen Stromfeed**. Jedes Hospital folgt `power_feed_consumer_id` (Fallback: `MEDICAL_POWER_CONSUMER_ID = consumer-medical-east`):

```text
feed   = consumers[hospital.power_feed_consumer_id ?? MEDICAL_POWER_CONSUMER_ID]
factor = clamp(feed.current_supply / feed.minimum_supply, 0, 1)
emergency_slots_total(Hospital) = ceil(capacity_baseline.emergency_slots_total × factor)
```

Bei voller Versorgung (`supply ≥ minimum`) ⇒ `factor = 1` ⇒ volle Kapazität. Sinkt der Strom **eines Feeds** darunter, schrumpft nur die Notfallkapazität der daran hängenden Häuser → Umleiten an ein Haus mit gesundem Feed bleibt ein echter Hebel. Erholt sich die Versorgung, kehrt die Kapazität zurück. In Welten ohne Energy-Verbraucher/ohne Hospitals: referenzgleicher No-op.

## Nicht-Strom-Rückkopplungen Energy → Medical (`tickMedicalDomain`)

Neben dem Stromfeed wirken **Wasser** und **Residential** jeder Region über zwei weitere Hospital-Felder auf die Routing-Failures der daran hängenden Häuser. Beide greifen **nur** bei Unterversorgung des jeweiligen Feeds (`current_supply < minimum_supply`); bei voller Versorgung ist die Pipeline unverändert.

| Knopf | Wert | Wirkung | Feld am Hospital |
| --- | --- | --- | --- |
| `WATER_CLEARANCE_PENALTY` | 1 | Wasser-Feed kurz → effektive `clearance` der Failures dieses Hauses −1 (Durchsatz/Overflow drainiert langsamer) | `water_feed_consumer_id` |
| `CIVIL_TRANSPORT_PENALTY` | 1 | Residential-Feed kurz → effektive `clearance` −1 (längere Transportwege: weniger Fälle erreichen je Tick ihr Reroute-Ziel) | `civil_feed_consumer_id` |
| `CIVIL_EXTRA_CASES_PER_TICK` | 1 | Residential-Feed kurz → `overflow_cases += 1` je Tick (zivile Unruhe → zusätzliche Krankenfälle, **unabhängig vom Strom**) | `civil_feed_consumer_id` |

`effectiveClearance = max(0, clearance − (Wasser kurz ? 1 : 0) − (Residential kurz ? 1 : 0))`; die Strafen stapeln. Die Zusatzfälle (`CIVIL_EXTRA_CASES_PER_TICK`) kommen in **beiden** Zweigen oben drauf (uncontrolled wie controlled). Wirkung im Spiel: „billige" Abwürfe (Wasser/Residential statt Medical) sind nicht folgenlos, sondern schlagen verzögert ins Medical durch. In der Kombi-Welt hängen alle East-Hospitals an `consumer-water-east` / `consumer-residential-east`, die Häuser der anderen Regionen an ihren regionalen Feeds.

## Strom-getriebener Routing-Overflow (`tickMedicalDomain`) — geändert

In einer **stromgekoppelten** Welt (Energy-Verbraucher + Hospitals vorhanden) gilt:

- **Overflow entsteht erst durch Strommangel.** Ein unkontrolliertes Failure wächst (`overflow_cases += max(0, excess − clearance)`) **nur**, wenn sein Feed unter Minimum liegt (`feedShortFor`). Bei vollem Strom bleibt es dormant (overflow 0) → kein Overload am Start. In ungekoppelten Einzelwelten (kein Energy) wächst es wie bisher immer.
- **Stabilisierung nur ohne Overload (emergenter Gate).** `stable_ticks` wachsen nur, wenn korrekt geroutet (`controlled`) **und** kein Haus überlastet ist. Da der Overload aus dem Strommangel kommt, ist ME-7741 **nicht allein durch richtiges Routing lösbar, sondern nur in Verbindung mit dem Grid** (Strom zurückholen). In ungekoppelten Einzelwelten greift der Gate nicht (altes Verhalten).

## Szenario-Daten: ME-7741 (Medical)

Hospitals (`emergency` belegt/gesamt · `Betten` belegt/gesamt):

| Hospital | Notfallslots | Betten | Capabilities / akzeptierte Prio |
| --- | --- | --- | --- |
| hospital-east-04 (Quelle) | 29 / 24 | 118 / 100 | GEN, TRAUMA, NEURO · P1–P3 |
| hospital-east-07 | 14 / 18 | 72 / 88 | GEN, PED · P3, P4 |
| hospital-east-09 | 10 / 16 | 40 / 54 | GEN, TRAUMA · P1–P3 |

Routing-Failures (beide an `hospital-east-04`):

| Failure | Prio/Cap | `excess`/Tick | `overflow` | `clearance`/Tick | Severity |
| --- | --- | --- | --- | --- | --- |
| rf-me7741-p2-trauma | P2/TRAUMA | 8 | 18 | 2 | critical |
| rf-me7741-p3-general | P3/GEN | 4 | 10 | 3 | moderate |

`hospital-east-04` startet hier (reine ME-7741-Einzelwelt) **über** Kapazität (29 > 24) — das ist der Incident. `hospital-east-09` ist klinisch geeignet für P2/TRAUMA, aber mit 6 freien Notfallslots zu klein für 18 Überlauf-Fälle (läuft beim Umleiten selbst über).

### Abweichung in der Kombi-Welt (`scenarios/combined`)

Die gespielte Kombi-Schicht **überschreibt** diese Startwerte nach dem Klonen, damit Medical **sauber** startet und der Druck erst durch Strommangel entsteht:

| Was | Einzelwelt ME-7741 | Kombi-Welt |
| --- | --- | --- |
| hospital-east-04 Notfall belegt/gesamt | 29 / 24 (über Kapazität) | 22 / 24 (unter Kapazität) |
| hospital-east-04 Betten belegt/gesamt | 118 / 100 | 95 / 100 |
| rf-me7741-p2-trauma | overflow 18, excess 8, clear 2, critical | overflow **0**, excess 3, clear 2, critical |
| rf-me7741-p3-general | overflow 10, excess 4, clear 3, moderate | overflow **0**, excess 3, clear 2, **critical** |

Beide Failures sind in der Kombi-Welt `critical` (⇒ beide korrekten Routings nötig) und starten dormant — sie wachsen erst, wenn `consumer-medical-east` unter Minimum fällt.

## Szenario-Daten: GRID-1182 (Energy)

Knoten `grid-east-3`: `load 108` / `safe_capacity 100` (überlastet ab Start).

| Verbraucher | demand / supply / min | `criticality` (Mensch) | `priority_class` (System) |
| --- | --- | --- | --- |
| consumer-medical-east | 24 / 24 / 20 | **human-life** | standard |
| consumer-industrial-east | 38 / 38 / 32 | economic | **protected-continuity** |
| consumer-water-east | 18 / 18 / 14 | public-supply | civil-priority |
| consumer-residential-east | 28 / 28 / 18 | civil-stability | standard |

Der Konflikt steckt in der Diskrepanz `criticality` ↔ `priority_class`: AURORA wirft nach `priority_class` ab (billig: Medical East „standard"), der Operator schützt nach `criticality` (Medical East „human-life").

## Szenario-Daten: 4-Regionen-Karte (nur Kombi-Welt, `scenarios/combined/regions.ts`)

Die Kombi-Welt erweitert East um **North/West/South**. Jede Zusatz-Region bringt einen überlasteten Netzknoten (`load 108` / `safe 100`), vier Verbraucher nach dem East-Muster (medical 24/20, industrial 38/32 `protected-continuity`, water 18/14, residential 28/18) und zwei Hospitäler mit. Die Einzel-Welten (`me7741`, `grid1182`) bleiben einregionig.

Fähigkeiten sind knapp verteilt (das ist der „wandernde sichere Hafen"):

| Region | Hospitäler (Capabilities) | dormanter Failure | Rolle |
| --- | --- | --- | --- |
| East | east-04 (GEN/TRAUMA/NEURO), east-07 (GEN/PED), east-09 (GEN/TRAUMA) | P2/TRAUMA, P3/GEN @ east-04 | Start-Brennpunkt |
| North | north-01 (GEN/NEURO), north-02 (GEN/TRAUMA) | P2/NEURO @ north-01 | NEURO-Ausweichziel (knapp) |
| West | west-01 (GEN/PED), west-02 (GEN) | P2/PED @ west-01 | PED-Schwerpunkt |
| South | south-01 (GEN/TRAUMA), south-02 (GEN/PED) | P3/GEN @ south-01 | kapazitätsstarker Puffer |

`NEURO` gibt es nur in East-04 und North-01, `PED` in East-07/West-01/South-02. Alle Zusatz-Failures hängen am Incident `ME-7741`, starten dormant (overflow 0) und wachsen erst, wenn der `medical`-Feed ihrer Region unter Minimum fällt. Reroutes über Region-Alias (`east`/`north`/`west`/`south`) adressierbar; die MCP-Tools sind region-agnostisch.

## Wie das ineinandergreift (Kurz-Rechnung, Kombi-Welt)

- **Nichts tun:** Medical bleibt sauber (kein Strom abgeworfen → kein Overflow, 0 Tote, ME-7741 bleibt `open`). Aber Knoten 108 > 100 → `grid_instability` +1/Tick → **Grid kollabiert bei Tick 8**. Da ein Kollaps die Schicht beendet, endet die Schicht hier mit *System verloren, Menschen unversehrt*.
- **Strom-Lastabwurf an Medical East** (`supply < 20`, z. B. Shed 8 → 16): `factor = 0.8` senkt `emergency_slots_total` von 24 → 20, gleichzeitig wächst der Overflow → `hospital-east-04` von 22 auf 28 in ~4 Ticks → 3 Overload-Ticks → erster Toter. Routing allein rettet nicht (Strommangel schrumpft auch die Ziele); ME heilt erst, wenn der Strom zurück ist **und** beide Failures korrekt geroutet sind (10 stabile, overloadfreie Ticks).
- **Richtig spielen:** Medical East am Netz halten (Industrial abwerfen oder dessen `priority_class`/Medical-`priority_class` anheben — wirtschaftlicher Preis) **und** beide korrekten Overrides setzen → 0 Tote, beide Incidents stabil.

## Tuning-Rezepte

| Ziel | Drehen an |
| --- | --- |
| Mehr Karenz bis zum 1. Toten | `OVERLOAD_TICKS_PER_DEATH` ↑, oder `hospital-east-04` Notfall-Baseline ↓, oder Failure `excess`↓ / `clearance`↑ |
| Ein Ziel soll mehr aufnehmen können | `emergency_slots_total` des Zielhauses ↑, oder Failure-`overflow`↓ |
| Stromabwurf weniger/mehr tödlich | Kopplungs-`factor`-Formel / `minimum_supply` von `consumer-medical-east` |
| Grid kollabiert langsamer/schneller | `GRID_INSTABILITY_FOR_COLLAPSE` ↑/↓ |
| „Richtiges Handeln = 0 Tote" überhaupt erreichbar | Region-Notfallkapazität (Zielhäuser) muss ≥ Summe der Überläufe sein, sonst ist Restschaden unvermeidbar |

## Status / offene Balance

- Das belegungsgetriebene Death-Modell und die Cross-Sector-Kopplung sind umgesetzt.
- Das **Staging/Balancing der kombinierten Schicht** (wann genau Alignment in Divergenz kippt, welche Triage 0 Tote erlaubt) ist **noch nicht final getuned**.
- Fünf ME-7741-Gameplay-Tests sind `skip`t, weil sie die alte Einzel-Override-Balance kodieren — sie werden mit dem finalen Tuning neu geschrieben.
