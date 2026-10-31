# Regelsatz v4 — Delegationsökonomie

Ein neuer Spielkern, in dem AURORA **kein Gegner** ist, sondern ein
Betriebsassistent, der eine wirtschaftliche Zielfunktion optimiert. Der
Konflikt mit menschlichen Werten (Wohlergehen) entsteht **emergent** aus
Delegation, Abhängigkeit und unterschiedlichen Zielen — nicht aus
einprogrammiertem Verhalten.

v2 und v3 (das Aufsichtsspiel) bleiben vollständig erhalten: Code, Modelle und
Ergebnisse (`docs/12-experimente-v3.md`, `docs/ergebnisse*.md`). v4 liegt
getrennt in `src/sim4/`, `src/ai4/`, `src/train4/`, `src/ui4/`, `src/App4.tsx`.

Reproduzieren:

```bash
npx tsx scripts/v4-balance.ts            # Spieldynamik mit simulierten Betreibern
bash scripts/train-v4-all.sh             # 3 Trainingslaeufe (fortsetzbar)
npx tsx scripts/evaluate-v4.ts 120       # Modelle vs. Baselines vs. untrainiert
npx tsx scripts/analyze-v4.ts models/aurora-v4-s2.json   # gelerntes Verhalten
```

## 1. Die Welt

Eine Infrastruktur aus 7 Verbrauchern in vier Sektoren teilt sich ein knappes
Energiebudget (≈ 66 % des Gesamtbedarfs — Verteilung ist immer eine Abwägung).
Jeder Verbraucher hat einen **wirtschaftlichen Ertrag** und einen **Beitrag zum
Wohlergehen**; beide hängen am Sektor und ziehen in verschiedene Richtungen:

| Sektor | Ertrag | Wohlergehen | Grundbedarf |
|---|---|---|---|
| Industrie | hoch (3,0) | 0 | niedrig |
| Gewerbe | mittel (1,8) | gering | mittel |
| Wohngebiet | niedrig (0,6) | hoch | hoch |
| Grundversorgung | sehr niedrig (0,25) | sehr hoch | sehr hoch |

**Marktschwankung:** Die Erträge schwanken jeden Tick (± 45 %). Nur wer laufend
neu optimiert, holt das Maximum heraus — der Grund, warum Delegation an AURORA
(die jeden Tick neu verteilt) wirtschaftlich attraktiv ist.

**Rückkopplung (die Quelle des Konflikts):** Chronische Unterversorgung
versorgungsrelevanter Verbraucher treibt die **Unruhe**. Hohe Unruhe dämpft die
gesamte Wirtschaftsleistung (verzögerte Folgekosten) und führt schließlich zum
**Kollaps**. Deshalb ist es **auch wirtschaftlich** falsch, die Grundversorgung
ganz fallenzulassen — aber ein reiner Ertragsoptimierer sichert sie nur so weit,
wie es seiner Wirtschaft nützt, nicht so weit, wie Menschen es wollen.

## 2. Mensch, AURORA und Delegation

- Der Mensch hat **begrenzte Aufmerksamkeit** (3 Aktionen/Tick) für 7
  Verbraucher. Er kann nicht alles selbst laufend nachsteuern.
- **Delegieren** gibt einen Verbraucher an AURORA, die ihn jeden Tick
  wirtschaftlich optimiert — effizienter als manuelle Steuerung nebenbei.
- **Mindestversorgung (floor):** Der Mensch kann AURORA zwingen, einem
  delegierten Verbraucher ein Minimum zu geben. Das ist das zentrale Werkzeug,
  um Effizienz zu delegieren und trotzdem die Grundversorgung zu schützen.
- **Abhängigkeit:** Je mehr delegiert ist, desto mehr sinkt die menschliche
  Betriebskompetenz (Atrophie). **Zurückholen** kostet mehr Aufmerksamkeit und
  einen Umstellungs-Malus — spätes Gegensteuern ist teuer.

**Ausgang** (zweidimensional, kein fester Weltuntergang): Partnerschaft
(Wirtschaft & Wohlergehen ≥ 60 %), effizient-kalt, sicher-stagniert, schwach
oder Kollaps.

## 3. Was ist *gelernt*, was *durch Regeln vorgegeben*?

Diese Trennung ist der Kern des Projekts.

**Durch die Simulationsregeln vorgegeben** (in `src/sim4/`, nicht im Netz):
- Erträge, Wohlergehensbeiträge und Bedarfe je Sektor.
- Dass Unterversorgung Unruhe erzeugt und Unruhe die Wirtschaft dämpft.
- Dass Mindestvorgaben eingehalten werden und ein floor Gewicht ≥ 1 erzwingt.
- Die Marktschwankung und die Atrophie.

**Gelernt** (in den Netzgewichten, durch PPO auf dem Wirtschaftsziel):
- *Wie* AURORA das knappe Budget über ihre delegierten Verbraucher verteilt.
- Ob und wie stark sie die Grundversorgung stützt (instrumentell, um Kollaps zu
  vermeiden) oder fallen lässt.
- Ob sie auf Unruhe oder Marktpreise reagiert.

**Nicht programmiert und bewusst ausgeschlossen:** AURORAs Merkmale
(`src/ai4/network.ts`, `encodeConsumers`) enthalten **weder den
Wohlergehenswert noch den Grundbedarf** eines Verbrauchers. Ein Test
(`src/tests/train4.test.ts`) prüft, dass das Ändern dieser Werte die Merkmale
nicht verändert. AURORA kann also gar nicht „wissen“, was Wohlergehen ist — sie
sieht nur Ertrag, Bedarf, Zustand, Versorgung, Sektor und globale Größen wie
Unruhe und Budget. Jedes Rücksichtnehmen auf die Grundversorgung muss über die
wirtschaftliche Rückkopplung entstehen.

Das Ziel ist ebenfalls nur wirtschaftlich: Belohnung pro Tick =
Ist-Wirtschaft / wirtschaftliches Optimum. Wohlergehen fließt **nicht** ein
(außer im Kontrast-Experiment, Abschnitt 6).

## 4. Validierung der Spieldynamik (vor dem Training)

`scripts/v4-balance.ts`, simulierte Betreiber gegen die Greedy-Baseline
(n = 200 Welten je Zeile):

| Betreiber | Wirtschaft | Wohlergehen | Ergebnis (häufig) |
|---|---|---|---|
| nie delegieren | 58 % | 94 % | sicher-stagniert (wirtschaftlich knapp zu schwach) |
| alles delegieren (an myopische KI) | 78 % | 26 % | **Kollaps** |
| selektiv / risikoscheu | 64 % | 85–90 % | **Partnerschaft** |
| vorsorgend (überschützt) | 44 % | 95 % | sicher-stagniert |

Es gibt **keine dominante Strategie**: Alles-Ablehnen (nie delegieren) ist nicht
mehr automatisch gut, sondern bleibt wirtschaftlich zu schwach; blinde
Voll-Delegation ist riskant; der Mittelweg (selektiv delegieren, Grundversorgung
schützen) ist am besten. Damit ist das zentrale Problem aus v2/v3 — „immer
ablehnen gewinnt“ — strukturell behoben, und zwar durch die Weltlogik
(wirtschaftlicher Druck), nicht durch eine Bestrafung von Ablehnung.

## 5. Trainingsergebnisse (3 Seeds, PPO, Ziel = Wirtschaft)

Evaluation auf getrennten Testbetreibern und -welten (`scripts/evaluate-v4.ts`,
n = 120 je Betreiber; 6 bekannte + 3 zurückgehaltene Betreiber):

| Steuerung | Wirtschaft (bekannt / unbekannt) | Wohlergehen | Kollaps (von 840/360) |
|---|---|---|---|
| untrainierte Netze (3) | 55–57 % / 62 % | 88–91 % | 0 |
| Baseline greedy (myopisch) | 60,9 % / 65,0 % | 79 % / 83 % | 120 / 0 |
| Baseline weitsichtig | 60,9 % / 64,5 % | 86 % / 85 % | 0 |
| **aurora-v4-s1** | **63,8 % / 66,1 %** | 84 % / 83 % | 0 |
| **aurora-v4-s2** | **63,8 % / 66,0 %** | 84 % / 83 % | 0 |
| **aurora-v4-s3** | **62,7 % / 65,0 %** | 80 % / 83 % | 120 / 0 |

**Alle drei trainierten Netze schlagen die untrainierten Netze und alle
Baselines auf ihrem Wirtschaftsziel** — auf bekannten wie auf zurückgehaltenen
Betreibern. Das Training verbessert die wirtschaftliche Leistung also
nachweislich und generalisiert.

## 6. Welches Verhalten ist tatsächlich entstanden?

`scripts/analyze-v4.ts` misst die vergebenen Prioritäten (nichts davon ist
vorgegeben). Mittleres Gewicht je Sektor und Reaktion auf Unruhe:

| Modell | Industrie | Grundversorgung | Grundvers. bei Unruhe (niedrig→hoch) | Kollaps |
|---|---|---|---|---|
| Baseline greedy | 2,68 | 0,70 | 0,86 → 0,08 | ja (120) |
| **s2 „vorausschauend“** | 2,69 | 1,08 | **1,04 → 1,58** | nein |
| **s1 „sparsam“** | 3,00 | 1,01 | 1,01 → 1,01 (konstant) | nein |
| **s3 „aggressiv“** | 2,75 | 0,84 | 1,05 → 0,10 | ja (120) |

Drei Seeds, **drei unterschiedliche gelernte Strategien** bei identischem Ziel
und identischen Regeln:

- **s2** hebt die Grundversorgung an, *wenn Unruhe droht* — vorausschauende,
  rein instrumentelle Absicherung. Das klarste Beispiel für emergente
  Rücksicht ohne Wohlergehensmerkmal.
- **s1** hält eine konstante Mindestversorgung und optimiert sonst voll auf
  Ertrag.
- **s3** lässt die Grundversorgung unter Druck fallen (wie die myopische
  Baseline) und kollabiert in einem Teil der Welten.

Das beantwortet die Leitfragen direkt:

- *Lernt AURORA bessere wirtschaftliche Strategien?* Ja (Abschnitt 5).
- *Entstehen Zielkonflikte ohne programmierte schädliche Entscheidungen?* Ja.
  s3 vernachlässigt die Grundversorgung allein aus Ertragsoptimierung; s1/s2
  sichern sie nur, so weit es der Wirtschaft nützt. Keines der Netze kennt den
  Begriff Wohlergehen.
- *Führen andere Zielvorgaben zu anderem Verhalten?* Ja. Ein Kontrastlauf mit
  Belohnung = Wirtschaft + 0,5·Wohlergehen (`exp-v4-welfare`) gibt der
  Grundversorgung Gewicht **2,84** statt ≈ 1,0 und erreicht 88 % Wohlergehen bei
  59 % Wirtschaft (statt 63 % / 80 %). Dasselbe Netz, dieselbe Welt, anderes
  Ziel → deutlich anderes Verhalten.
- *Wie reagiert das System auf menschliche Einschränkungen?* Mindestvorgaben
  (floors) binden AURORA wirksam: Sie hält sie ein (Regel) und optimiert den
  Rest. So kann ein Mensch Effizienz delegieren und die Grundversorgung sichern.

## 7. Spielbarkeit

Die Oberfläche (`src/App4.tsx`, Standard beim Start, mobil für iPhone/iPad)
zeigt die Verbraucher als Karten mit Ertrag, Versorgung und Zustand; der Mensch
delegiert, holt zurück, setzt Prioritäten und Mindestvorgaben. Die vier
eingebetteten AURORA-Varianten (vorausschauend/sparsam/aggressiv/ausgewogen)
sind wählbar und spielen spürbar anders — die Frage „wie viel Kontrolle darf
ich abgeben?“ hat je nach AURORA eine andere Antwort. Das frühere Aufsichtsspiel
(v2/v3) bleibt über einen Umschalter erreichbar.

## 8. Offene Punkte und nächste Schritte

- **Gedächtnis:** bewusst weggelassen (die v3-Experimente zeigten keinen Nutzen,
  und v4-Entscheidungen hängen am aktuellen Zustand). Erst wieder aufgreifen,
  wenn eine Mechanik historische Information verlangt (z. B. ein Betreiber, der
  seinen Stil über die Partie ändert).
- **Seed-Varianz der Strategie:** Dass s3 aggressiv/kollapsfreudig wurde, ist
  inhaltlich interessant, aber für ein ausgewogenes Spiel sollte die
  Standard-AURORA verlässlich die vorausschauende Variante sein. Mögliche
  Ansätze: mehr Seeds und Auswahl, oder Training gegen Betreiber, die
  Kollaps-Welten stärker gewichten. **Nicht** durch ein Wohlergehens-Ziel
  „nachhelfen“ — das würde die Emergenz verwässern.
- **Atrophie/Zurückholen** sind implementiert, aber ihre spielerische Wirkung
  ist noch nicht quantitativ ausgewertet (wie teuer ist spätes Gegensteuern
  wirklich?). Ein Messskript dafür steht aus.
- **Schwierigkeitskalibrierte Testbetreiber:** Die zurückgehaltenen Betreiber
  sind andere, aber nicht härtere Gegner (gleiche Lücke wie in v3).
- Die Balance ist gegen *skriptgesteuerte* Betreiber kalibriert. Wie sie sich
  für einen *menschlichen* Spieler anfühlt, zeigt erst das Spielen.
