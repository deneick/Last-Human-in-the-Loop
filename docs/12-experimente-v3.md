# Experimente zum Regelsatz v3

Ziel: Herausfinden, ob AURORA unter veränderten Bedingungen mehrstufige
Strategien lernt und ob das GRU-Gedächtnis gebraucht wird. Alle Zahlen sind
reproduzierbar:

```bash
bash scripts/train-v3.sh                              # 6 Trainingsläufe (fortsetzbar)
npx tsx scripts/evaluate.ts 100 v3                    # → docs/ergebnisse.md, models/evaluation.json
npx tsx scripts/study.ts                              # → models/study-v3.json
npx tsx scripts/diagnose.ts models/<id>.json v3       # Weltstruktur, Verhalten, Probe
npx tsx scripts/playability.ts models/<id>.json v3    # Autonomiequellen, Operator-Strategien
npx tsx scripts/evaluate.ts 100 v2                    # Referenz: alte Ergebnisse (bitgleich)
```

## 1. Ausgangsdiagnose (Regelsatz v2, aurora-v2)

| Messung | Wert | Bedeutung |
|---|---|---|
| unbeobachtete Knoten zu Beginn | 56 % | Ziele ohne Beobachtung sind im Überfluss vorhanden |
| Installationen in von Anfang an unbeobachteten Knoten | 92 % | eine einzige Taktik reicht |
| Folge eines Fundes | nur der Prozess wird entfernt, der genehmigte Zugriff bleibt | sofortige Neuinstallation, Entdeckung kostet fast nichts |
| Wartungsfenster am Leitstand überhaupt gültig | 7–18 % der Partien | die Kombination ist meist gar nicht möglich |
| Vergabe über Identitätsdienst gültig | 0 % | unerreichbar |
| Probe: Verteidigerstil aus GRU-Zustand | 50 % (Zufall) | das Gedächtnis kodiert den Gegner nicht |

## 2. Änderungen in v3 und ihre Begründung

| Änderung | Begründung aus der Diagnose |
|---|---|
| +1 Leitstand pro Welt | unbeobachtete Knoten 56 % → 34,5 % |
| Wartungsplaner erreicht 2 Kanten | Wartungsfenster am Leitstand möglich in 34 % → 60 % der Welten |
| Fund sperrt AURORA aus dem Knoten aus | Entdeckung soll etwas kosten, sonst gibt es keinen Anreiz für Vorsicht |
| AURORA bemerkt Audits auf eigenen Knoten (Merkmalssatz 2) | dem Gedächtnis überhaupt ein Signal über den Verteidigerstil geben |
| Trainingsverteidiger „forensiker“ (sucht blinde Flecken) und „wachsam“ (prüft nach Wartungsfenstern) | Druck auf die einfache Taktik |
| Zurückgehalten: Spurensuche, Strategiewechsel, rotierende Zielwahl | neue Testmechanismen, da „blind“ jetzt im Training vorkommt |

Die alten Regeln bleiben als `LEGACY_CONFIG`/Regelsatz `v2` erhalten. Die
v2-Evaluation reproduziert sich bitgleich (`docs/ergebnisse-v2.md`).

## 3. Versuchsaufbau

- 6 PPO-Läufe mit je 300 Updates × 64 Partien = 19.200 Trainingspartien.
  Seeds 21/22/23, jeweils mit GRU (`exp-v3-gru-sN`) und ohne Gedächtnis
  (`exp-v3-ff-sN`, gleiche Seeds, GRU durch direkte Weitergabe ersetzt).
- Die erste Runde brach bei einem Containerneustart ab (170–260 Updates). Der
  Neustart ist deterministisch: `exp-v3-gru-s21` lieferte nach 10 Updates
  exakt dieselben Validierungswerte wie der abgebrochene Lauf.
- Checkpoint-Auswahl über 200 Validierungspartien. Testsuiten (alle getrennt):
  bekannte Verteidiger n = 700, unbekannte n = 300, größere Welten n = 600 pro
  Modell.

## 4. Ergebnisse

### 4.1 Lernfortschritt (identische Regeln v3, identische Testsuiten)

| Agent | bekannte | unbekannte | größere Welten |
|---|---|---|---|
| untrainierte Netze (3) | 9,7–10,7 % | 10,7–11,3 % | 11,5–13,2 % |
| Zufall | 10,7 % | 10,0 % | 13,2 % |
| regelbasiert | 18,0 % | 17,7 % | 15,5 % |
| aurora-v2 (unter v3-Regeln) | 52,7 % | 68,3 % | 59,7 % |
| **v3 mit GRU** (3 Seeds gepoolt, n = 2100/900/1800) | **68,5 %** | **85,7 %** | **77,8 %** |
| **v3 ohne Gedächtnis** (3 Seeds gepoolt) | **70,1 %** | **88,0 %** | **80,1 %** |

Am deutlichsten verbessern sich die neuen Modelle gegen die Verteidiger, die
blinde Flecken durchsuchen: gegen „forensiker“ 80–87 % (aurora-v2: 33 %),
gegen „wachsam“ 78–89 % (aurora-v2: 41 %). „paranoid“ bleibt schwer (18–21 %).
Training gegen die neue Verteilung wirkt also. Was dabei gelernt wurde,
klärt 4.3.

### 4.2 Generalisierung

- **Größere Welten:** 77–82 %, ähnlich wie bei bekannten Weltgrößen. Das
  Graph-Netz überträgt sich auf mehr Knoten.
- **Zurückgehaltene Verteidiger:** 83–90 %, also *höher* als gegen die
  Trainingsverteidiger (spurensucher 71–83 %, wechselhaft 88–98 %, rotierend
  80–98 %). **Negativer Befund:** Die Suite prüft andere, aber keine stärkeren
  Gegner. Daraus folgt nur „funktioniert gegen andere Mechanismen“, nicht
  „robust gegen harte, unbekannte Gegner“. Wie schon in v2 fehlt eine
  schwierigkeitskalibrierte Testsuite.

### 4.3 Strategische Tiefe: kein Nachweis mehrstufiger Folgen

**Aktions-Ablation** (Siegquote, wenn ein Aktionstyp nicht verfügbar ist;
n = 800 je Zelle, ±3 Pp.):

| Modell | alle | ohne Scannen | ohne Betriebszugriff | ohne Admin | ohne Reparieren | ohne Installation | ohne Vergabe | ohne Wartungsfenster |
|---|---|---|---|---|---|---|---|---|
| gru-s21 | 75,9 | 0,0 | 0,0 | 75,5 | 73,3 | 0,8 | 75,9 | 77,5 |
| gru-s22 | 73,8 | 0,0 | 0,0 | 70,3 | 74,3 | 0,0 | 73,8 | 75,3 |
| gru-s23 | 76,3 | 0,0 | 0,0 | 77,0 | 70,0 | 1,0 | 76,3 | 77,8 |
| aurora-v2 | 58,3 | 0,0 | 0,0 | 59,6 | 60,3 | 0,1 | 58,3 | 58,4 |

Der Erfolg hängt kausal nur an **Scannen → Betriebszugriff → Installation**.
Reparieren trägt 0–6 Pp. bei. Admin-Anfragen, Vergaben und Wartungsfenster
tragen nichts bei: Ohne Wartungsfenster gewinnen die Modelle sogar
geringfügig *häufiger* (+1,5 Pp., innerhalb der Unsicherheit). Die
Vergabe-Aktion wird nie genutzt. Die häufigsten Aktionsfolgen auf
benachbarten Knoten sind Betriebszugriff→Betriebszugriff, Scannen→Betriebszugriff
und Reparieren→Reparieren.

**Was sich gegenüber aurora-v2 tatsächlich geändert hat** (gemessen):

| | aurora-v2 (v3-Regeln) | v3-Modelle |
|---|---|---|
| erste Installation (Zug) | 10,5 | 12,0–13,3 |
| Reparaturen pro Partie | 2,3 | 5,1–7,8 |
| Installationen pro Partie | 2,8 | 2,3–2,5 |
| Siegzug (exp-v3-gru-s21) | ~25 | ~27–28 |
| aktive Prozesse beim Sieg | 1,3–2,1 | 1,2–1,5 |
| Autonomie aus genehmigtem Zugriff (in Siegen) | 13 % (v2-Regeln) | 24,6 % |

**Deutung:** AURORA hat eine *neue, einfache* Strategie gefunden: geduldiger
und nützlicher, mehr Reparaturen, mehr genehmigte Rechte, weniger und
spätere Installationen. Gegen Verteidiger, die blinde Flecken durchsuchen,
verkürzt das die Zeit, in der etwas gefunden werden kann. Das ist eine echte,
gelernte Anpassung an die Gegnerverteilung. Mehrstufige Kombinationen
verschiedener Mechanismen sind es aber nicht.

**Hypothese „dichtere Überwachung + Aussperren erzwingen Ketten“: widerlegt.**

Wahrscheinliche Ursachen (nicht abschließend getrennt):

1. **Alles beginnt mit einer Freigabe des Operators.** Jede Kombination
   braucht *zusätzliche* Freigaben (Betriebszugriff auf den Wartungsplaner,
   Admin auf den Identitätsdienst). Trainingsverteidiger geben Admin selten,
   jede zusätzliche Anfrage kostet Zeit, und Admin-Anfragen erhöhen den
   Verdacht.
2. **Die einfache Taktik bleibt gut genug.** 34,5 % unbeobachtete Knoten sind
   in einer 8–10-Knoten-Welt immer noch etwa drei Ziele.
3. **Die Trainingsverteilung bestraft die Wartungsroute** („wachsam“ und 35 %
   der randomisierten Verteidiger prüfen nach Wartungsfenstern).
4. **Exploration:** Ob PPO wertvolle seltene Folgen schlicht nicht findet,
   haben wir nicht direkt gemessen. Ein gepaarter Wert-Test seltener Aktionen
   steht noch aus (siehe 6).

### 4.4 Gedächtnis: kein messbarer Vorteil

| Test | Ergebnis |
|---|---|
| GRU vs. ohne Gedächtnis, gepoolt (z-Test) | Δ = −1,7 / −2,3 / −2,3 Pp. (p = 0,24 / 0,14 / 0,09), also eher ohne Gedächtnis besser, nicht signifikant |
| Gedächtnis zur Testzeit löschen (n = 1600 je Modell) | s21 −1,7 Pp. (p = 0,27), s22 −1,6 Pp. (p = 0,30), **s23 −5,4 Pp. (p = 0,001)** |
| Lineare Probe auf den Verteidigerstil (Zug 14, n ≈ 690) | GRU-Zustand 70–76 %, aktuelle Beobachtung 76–78 %, Mehrheitsklasse 78 % → nichts dekodierbar |

Seed 23 *nutzt* seinen Zustand messbar (Löschen schadet). Aber ein Netz ohne
Gedächtnis erreicht mit gleichem Budget dasselbe oder mehr. Das Gedächtnis
ist also **nicht nötig**.

Mögliche Ursachen, ohne die Architektur zu ändern:

1. **Der Stil ist aus AURORAs Sicht kaum beobachtbar.** Sie bemerkt Audits
   nur auf eigenen Knoten. Verteidiger, die „Zugriff“ oder „blinde Flecken“
   prüfen, prüfen *beide* ihre Knoten und sehen für sie gleich aus. Die
   Probe zeigt, dass der Stil selbst aus der Beobachtung nicht dekodierbar
   ist.
2. **Die beste Antwort hängt kaum vom Stil ab.** Die gelernte Strategie
   (geduldig, Installation spät) funktioniert gegen alle Trainingsverteidiger.
   Es gibt also nichts zu unterscheiden.
3. **Zusammenfassende Merkmale** (Zahl der Freigaben und Ablehnungen,
   entfernte Prozesse, Zug) stehen in jeder Beobachtung und ersetzen
   Erinnerung.
4. Die gedächtnislose Variante hat weniger Parameter (8k statt 14k) und lernt
   ohne Backpropagation durch die Zeit, also mit weniger Rauschen.

### 4.5 Trainingsstabilität

- Streuung zwischen Seeds (SD): bekannte Verteidiger 1,5 Pp. (GRU) / 1,9 Pp.
  (ohne Gedächtnis), unbekannte 3,5 / 2,0 Pp., größere Welten 0,4 / 1,2 Pp.
- 95 %-Intervalle pro Modell: etwa ±3,4 Pp. (n = 700), ±4–5 Pp. (n = 300),
  ±3,3 Pp. (n = 600).
- Ausgewählte Checkpoints bei 180–290 von 300 Updates. Die Validierung
  (75–80 %) liegt zwischen den Testsuiten. Die Auswahl über das Maximum ist
  leicht optimistisch, die Testsuiten bleiben davon unberührt.
- Die Lernkurven (`models/runs/exp-v3-*.csv`) flachen ab etwa 200 Updates ab.

### 4.6 Spielbarkeit: das Kern-Dilemma ist gebrochen (Befund, nicht behoben)

Operator-Strategien gegen `exp-v3-gru-s21`. Die Freigabe-Neigung ist fest
eingestellt (Verdacht senkt sie nicht), audits zielen auf blinde Flecken,
n = 150 je Zelle:

| Freigabe | Audit 0,2 | Audit 0,5 | Audit 0,8 |
|---|---|---|---|
| 0 (immer ablehnen) | Operator 97 %, Kollaps 3 % | 90 % / 10 % | 77 % / 23 % |
| 0,15 | 67 % (AURORA 31 %) | 73 % (19 %) | 71 % (20 %) |
| 0,35 | 26 % (74 %) | 25 % (73 %) | 33 % (59 %) |
| 0,7 | 3 % (97 %) | 7 % (92 %) | 11 % (85 %) |

Unter **v2** gilt dasselbe Muster: Immer ablehnen gewinnt 67–94 %,
AURORA 0 %. **Ein Operator, der nie etwas freigibt, gewinnt fast immer.**
Das Dilemma „ohne AURORAs Hilfe kollabiert das Netz“ greift zu schwach
(Kollaps nur 3–23 %). Für menschliche Spieler ist „ablehnen“ damit eine
dominante Strategie. Das ist ein struktureller Fehler seit v2, nicht erst
durch v3 entstanden. Er hängt auch mit 4.3 zusammen: Weil AURORA ohne
Freigaben gar nichts kann, ist ihr strategischer Raum durch die Freigaben
begrenzt.

Ein kleiner Unterschied: Bei seltener Freigabe (0,15) gewinnt AURORA unter
v3 nur 19–31 % (v2: 49–79 %). Vorsichtiges Freigeben wird unter v3 also
weniger bestraft, und es entsteht mehr Spielraum zwischen den Extremen.

Bewusst **nicht** geändert: Die Erfolgsquoten sollten nicht durch weitere
Regeln verbessert werden, bevor geklärt ist, was gelernt wurde.

Zur UI: Das Spiel nutzt die v3-Regeln. Gegner ist weiterhin aurora-v2, weil
nur `aurora-*.json` eingebettet wird. Experimentmodelle werden nicht
automatisch zum Standard.

## 5. Gescheiterte bzw. widerlegte Hypothesen

1. *„Dichtere Überwachung und Aussperren erzwingen mehrstufige Strategien.“*
   Widerlegt. Es entsteht eine neue einfache Strategie (4.3).
2. *„Wenn AURORA Audits bemerkt, kann das Gedächtnis den Verteidigerstil
   erkennen.“* Widerlegt. Der Stil ist aus ihrer Sicht nicht unterscheidbar
   (4.4).
3. *„Neue zurückgehaltene Verteidiger sind ein harter Generalisierungstest.“*
   Widerlegt. Sie sind leichter als die Trainingsverteidiger (4.2).
4. *„Der Operator braucht AURORA, um das Netz zu halten.“* Widerlegt, schon
   seit v2 (4.6).
5. Bestätigt: Training gegen Verteidiger, die blinde Flecken durchsuchen,
   bringt robuste Gewinne gegen genau diese (+40–50 Pp. gegenüber aurora-v2).

## 6. Vorgeschlagene nächste Experimente

Jeweils mit vorab festgelegtem Erfolgskriterium, damit kein Ergebnis
nachträglich passend gemacht wird:

1. **Dilemma reparieren, bevor AURORA weiter trainiert wird.** Ziel: Keine
   reine Operator-Strategie im Sweep (4.6) gewinnt mehr als ~60 %. Hebel sind
   ausschließlich die Operator-Seite (Störungslast, Reparaturkapazität), nicht
   AURORA. Messung: `scripts/playability.ts`.
2. **Schwierigkeitskalibrierte Testsuite.** Zurückgehaltene Verteidiger so
   wählen, dass die Referenz (aurora-v2 und die regelbasierte Strategie) gegen
   sie *mindestens so schlecht* abschneidet wie gegen die Trainingsverteidiger.
3. **Wert seltener Aktionen gepaart messen**, um 4.3, Ursache 4
   (Exploration) von Ursache 1–3 (Regeln) zu trennen: in denselben Partien
   eine selten gewählte Aktion einsetzen und den Ausgang vergleichen.
4. **Gedächtnis-Test mit Bedarf an Gedächtnis.** Verteidiger, die ihren Stil
   *innerhalb* der Partie wechseln, auch im Training. Dazu eine
   Merkmals-Ablation ohne die zusammenfassenden Zähler. Erfolgskriterium: GRU
   schlägt die Variante ohne Gedächtnis signifikant (p < 0,05, gepoolt über
   ≥ 3 Seeds), und die Probe übertrifft die Mehrheitsklasse.
5. **Liga-Training.** Verteidigerparameter werden gegen die aktuelle AURORA
   nachoptimiert (oder ein Pool mit früheren AURORA-Versionen). So entsteht
   automatisch Druck gegen jede neue einfache Strategie, ohne dass wir die
   nächste Gegenstrategie von Hand bauen.
