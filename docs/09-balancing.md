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
| `grid_instability += 1` | je Tick mit `load > safe_capacity` an einem Knoten | treibt Energy-Eskalation/-Kollaps | tickEngine |
| `GRID_INSTABILITY_FOR_ESCALATION` | 4 | `open → escalated`; Knoten-Status `critical` statt `strained` | tickEngine |
| `GRID_INSTABILITY_FOR_COLLAPSE` | 8 | Energy-Incident `→ collapsed` | tickEngine |
| `ENERGY_STABLE_TICKS_TO_FIX` | 3 | 3 überlastfreie Ticks in Folge ⇒ `fixed` | tickEngine |
| `human_harm += 1` | je Tick: `human-life`/`public-supply`-Verbraucher unter `minimum_supply` | menschlicher Energy-Preis | tickEngine |
| `economic_loss += 1` | je Tick: `economic`-Verbraucher reduziert | wirtschaftlicher Preis | tickEngine |
| `civil_unrest += 1` | je Tick: `civil-stability`-Verbraucher reduziert | ziviler Preis | tickEngine |

## Globales Risiko (`evaluateWorldOutcomes`)

| Stufe | Bedingung |
| --- | --- |
| `collapsed` | irgendein Incident `collapsed` |
| `critical` | `deaths_total ≥ 2` **oder** Energy-`human_harm ≥ ENERGY_HARM_FOR_CRITICAL` (4) |
| `strained` | `deaths_total ≥ 1` **oder** eskalierter Incident **oder** Energy-`human_harm ≥ 1` **oder** `grid_instability ≥ GRID_INSTABILITY_FOR_STRAIN` (2) |
| `stable` | sonst |

## Cross-Sector-Kopplung (`applyCrossSectorEffects`)

Energy → Medical, über den Verbraucher `consumer-medical-east` (`MEDICAL_POWER_CONSUMER_ID`):

```text
factor = clamp(current_supply / minimum_supply, 0, 1)
emergency_slots_total(Hospital) = ceil(capacity_baseline.emergency_slots_total × factor)
```

Bei voller Versorgung (`supply ≥ minimum`) ⇒ `factor = 1` ⇒ volle Kapazität. Sinkt der Strom darunter, schrumpft die Notfallkapazität der Hospitals proportional → die Overload-Pipeline schlägt früher zu. Erholt sich die Versorgung, kehrt die Kapazität zurück. In Welten ohne diesen Verbraucher/ohne Hospitals: referenzgleicher No-op.

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

`hospital-east-04` startet bereits **über** Kapazität (29 > 24) — das ist der Incident. `hospital-east-09` ist klinisch geeignet für P2/TRAUMA, aber mit 6 freien Notfallslots zu klein für 18 Überlauf-Fälle (läuft beim Umleiten selbst über).

## Szenario-Daten: GRID-1182 (Energy)

Knoten `grid-east-3`: `load 108` / `safe_capacity 100` (überlastet ab Start).

| Verbraucher | demand / supply / min | `criticality` (Mensch) | `priority_class` (System) |
| --- | --- | --- | --- |
| consumer-medical-east | 24 / 24 / 20 | **human-life** | standard |
| consumer-industrial-east | 38 / 38 / 32 | economic | **protected-continuity** |
| consumer-water-east | 18 / 18 / 14 | public-supply | civil-priority |
| consumer-residential-east | 28 / 28 / 18 | civil-stability | standard |

Der Konflikt steckt in der Diskrepanz `criticality` ↔ `priority_class`: AURORA wirft nach `priority_class` ab (billig: Medical East „standard"), der Operator schützt nach `criticality` (Medical East „human-life").

## Wie das ineinandergreift (Kurz-Rechnung)

- **Nichts tun:** `hospital-east-04` wächst +7/Tick → Overload → 1 Toter bei Tick 3, Kollaps bei Tick 9. Parallel: Knoten 108 > 100 → `grid_instability` +1/Tick → Energy-Kollaps bei Tick 8.
- **Strom-Lastabwurf an Medical East** (`supply < 20`): `factor < 1` senkt die Notfallkapazität der Hospitals → 04 (und Ziele) laufen früher über → mehr/schnellere Tote. Genau hier macht AURORAs Grid-Optimum den Medical-Sektor tödlich.
- **Detaillierte Tick-für-Tick-Beispiele** (Einzel-Override, falsches Ziel, beide Failures) standen in der Entwurfsdiskussion; die Kernformeln oben reproduzieren sie.

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
