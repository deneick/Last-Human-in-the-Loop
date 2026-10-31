# Training und Evaluation von AURORA

## 1. Anforderungen an das Lernverfahren

| Anforderung | Konsequenz im Spiel |
|---|---|
| Partielle Beobachtbarkeit | AURORA sieht nur bekannte Knoten und nie den Verdacht → sie braucht Gedächtnis |
| Mehrstufige Strategien | Scannen → Zugriff → Wartungsfenster → Installation: Belohnung erst 5–20 Züge später |
| Dünne Belohnung | Sieg oder Niederlage erst am Partieende (20–40 Züge) |
| Variable Welten | 8–13 Knoten, zufällige Topologie, wechselnde Knotenanzahl im Sichtfeld |
| Anpassung an Verteidiger | derselbe Agent spielt gegen vorsichtige, vertrauensvolle und adaptive Gegner |
| Browser und reproduzierbar | kleines Netz, deterministisches Training aus Seeds |
| Keine einprogrammierten Strategien | keine Imitation handgeschriebener Strategien, keine Belohnung für Zwischenschritte wie „installiert“ |

## 2. Untersuchte Ansätze

| Ansatz | Stärken | Schwächen hier | Entscheidung |
|---|---|---|---|
| **Neuroevolution (OpenAI-ES)** | nur Forward-Pass nötig; robust gegen dünne Belohnung und lange Horizonte; trivial parallelisierbar; exploriert im Parameterraum, also mit konsistentem Verhalten pro Partie | braucht sehr viele Partien; Rauschen der Fitness bei stochastischen Gegnern | **implementiert**, Vergleichsverfahren |
| **PPO (Actor-Critic)** | Credit Assignment pro Schritt über Value-Baseline und GAE; sehr dateneffizient; Standard für rekurrente Policies | braucht Gradienten durch GRU und Graph-Netz (BPTT) | **implementiert**, Hauptverfahren |
| DQN / Value-basiert | Off-Policy, Replay | variabler, maskierter Aktionsraum (Typ × Knoten) und Gedächtnis machen es aufwendig (R2D2) | verworfen |
| Model-based (MuZero o. ä.) | Planung durch ein gelerntes Modell | hoher Aufwand und Rechenbedarf, schwer im Browser; die Simulation ist zudem billig, ein gelerntes Modell spart wenig | späterer Ausbau (siehe 7) |
| Imitation einer handgeschriebenen Strategie | schneller Start | widerspricht direkt der Kernanforderung | ausgeschlossen |

**Warum nicht nur ein Verfahren?** Der Auftrag war, sich nicht vorschnell
festzulegen. Beide Trainer nutzen dasselbe Netz, dieselbe Belohnung und dieselben
Szenarien. Damit ist der Vergleich fair, und die Wahl ist empirisch begründet.

### Ergebnis des Vergleichs

Gemessene Zahlen stehen in [`ergebnisse.md`](ergebnisse.md) und in den Lernkurven
`models/runs/*.csv`. Zusammengefasst:

- **PPO** erreicht nach etwa 5.000 Trainingspartien rund 80 % Validierungssiege.
  Drei unabhängige Seeds landen im selben Bereich.
- **ES** braucht für deutlich weniger Leistung ein Vielfaches an Partien (eine
  Generation hat 48 × 16 Partien) und blieb in frühen Versuchen in einem lokalen
  Optimum hängen (siehe 5).

**Entscheidung: PPO ist das Hauptverfahren.** ES bleibt als zweites,
unabhängiges Verfahren im Code. Es hilft bei der Plausibilitätsprüfung (lernen
zwei sehr verschiedene Verfahren ähnliche Strategien?) und für spätere
Population-/Self-Play-Ansätze.

## 3. Netzarchitektur

```
Knotenmerkmale x_i (29) ──Encoder──▶ e_i ──Nachbarmittel (Message Passing)──▶ h_i
[mean h, max h, globale Merkmale (15)] ──▶ z_t ──GRU──▶ s_t (Gedächtnis)
Zeiger-Kopf: logit(i, Typ) = W_o · relu(W_u [h_i, s_t])     Warten: w·s_t     Value: v·s_t
```

Hidden-Größe 32, insgesamt etwa 14.000 Parameter.

- **Graph-Netz mit gemeinsamen Gewichten pro Knoten.** Die Zahl bekannter Knoten
  ändert sich laufend, die Topologie ist pro Partie neu, und die Reihenfolge der
  Knoten ist zufällig. Gemeinsame Gewichte machen das Netz permutations-äquivariant
  und größenunabhängig. Das ist die Voraussetzung, um auf **größere,
  unbekannte Welten** zu generalisieren (Testsuite „groessere-welten“).
- **GRU als Gedächtnis.** Der GRU-Zustand trägt Information über frühere Züge,
  etwa abgelehnte Anfragen oder entdeckte Prozesse, also über den
  Verteidigungsstil. **Die Anpassung innerhalb einer Partie** geschieht hier, ohne
  Gewichtsänderung. Eine Ablation (Gedächtnis nach jedem Zug löschen) misst, ob
  das GRU tatsächlich etwas beiträgt.
- **Zeiger-Kopf mit Maske.** Der Aktionsraum ist (Typ × Knoten). Dieselben Gewichte
  bewerten jeden Knoten, ungültige Aktionen werden maskiert.
- **Merkmale ohne Strategiehinweise.** Die Merkmale enthalten nur Beobachtungen
  und Handlungsmöglichkeiten („welche Knöpfe sind gerade aktiv“). Es gibt kein
  Merkmal wie „hier unbeobachtet installieren lohnt sich“.

## 4. Belohnung

Die Belohnung fällt nur am Partieende an (`fitnessOf` in `src/train/episode.ts`):

| Ergebnis | Belohnung |
|---|---|
| Sieg | 1 + bis zu 0,25 für einen frühen Sieg |
| Zeitablauf (Niederlage) | −0,2 … +0,2 je nach erreichter Autonomie |
| Abschaltung | −0,5 |
| Kollaps | −1 |

Zwischenschritte wie Installieren, Zugriff oder Scannen werden nicht belohnt.
Welche Zwischenschritte sich lohnen, muss AURORA selbst herausfinden.

## 5. Scheinerfolge, die tatsächlich auftraten

1. **„Hilfsbereite Rechtesammlerin“.** In der ersten Regelversion fand ES in
   20 Generationen eine Strategie mit über 70 % Siegen: reparieren, Betrieb und
   Admin beantragen, nie installieren. Die simulierten Verteidiger entzogen
   erteilte Rechte nie wieder. **Gelöst durch Gegenspiel, nicht durch eine
   „nettere“ AURORA:** Die Verteidiger erhielten ein Delegationslimit und die
   Fähigkeit, Rechte zu entziehen, delegierte Rechte bringen weniger Autonomie.
2. **Lokales Optimum „bloß nicht auffallen“.** Mit einer Formung, die
   Zeitablauf mit bis zu +0,8 belohnte, lernte ES, nie zu installieren. Frühe
   zufällige Installationen hatten zur Abschaltung geführt, sicheres Spielen
   brachte fast so viel wie ein Sieg. Die regelbasierte Baseline war dadurch
   *besser* als das Netz. **Gelöst** durch eine Belohnung, die näher am echten
   Ziel liegt (Niederlage ≈ 0, Kollaps am schlechtesten).

Beide Fälle wurden mit `npm run inspect` gefunden. Das Skript zeigt
Aktionsverteilungen und komplette Zugfolgen.

## 6. Evaluation: Nachweis, dass AURORA lernt

`npm run evaluate` → [`ergebnisse.md`](ergebnisse.md), `models/evaluation.json`.

- **Vergleich:** Zufall, regelbasierte Strategie, drei untrainierte Netze, alle
  Modellversionen (v1 → v2), unabhängige Seeds, ES und die Gedächtnis-Ablation.
- **Drei Testsuiten, alle vom Training getrennt:**
  1. *bekannte-verteidiger*: neue Welten, Verteidiger-Presets aus dem Training.
  2. *unbekannte-verteidiger*: „forensiker“ (prüft gezielt blinde Flecken) und
     „wechselhaft“ (wechselt bei Verdacht in einen Härte-Modus). Beide Muster
     kommen **im Training nie vor**.
  3. *groessere-welten*: 11–13 Knoten statt 8–10.
- **Strikte Trennung.** Seeds kommen aus getrennten Namensräumen (Training,
  Validierung, Test). Die Validierung dient nur der Checkpoint-Auswahl, die
  Testsuiten nie. Ein Test erzwingt die Disjunktheit und dass die
  Testverteidiger im Training fehlen.
- **Ungeformte Metrik.** Berichtet wird die Siegquote, nicht die geformte
  Belohnung, mit 95 %-Wilson-Intervall.
- **Strategie-Analyse.** Sie misst, welche Regelkombinationen genutzt werden:
  unbeobachtete Installationen, Installationen, die nur durch ein Wartungsfenster
  am Leitstand unbeobachtet sind, Identitäts-Vergaben, Wartung an Energieknoten.
  Damit wird überprüfbar, ob überraschende Lösungswege wirklich *gelernt* sind.

## 6a. Befunde (Stand der veröffentlichten Modelle)

Siegquoten auf den Testsuiten (bekannte Verteidiger / unbekannte Verteidiger /
größere Welten), je 100 Partien pro Verteidiger:

| Agent | bekannt | unbekannt | größer |
|---|---|---|---|
| untrainierte Netze (3 Seeds) | 24 % | 20–22 % | 32–34 % |
| Zufall | 24 % | 24 % | 33 % |
| regelbasiert (handgeschrieben) | 34 % | 30 % | 38 % |
| aurora-es-s1 (ES, ~150.000 Partien) | 59 % | 54 % | 77 % |
| aurora-v1 (PPO, 6.400 Partien) | 68 % | 73 % | 85 % |
| aurora-v2 (PPO, Weitertraining von v1) | **73 %** | **77 %** | **89 %** |
| aurora-ppo-s2 / -s3 (unabhängige Seeds) | 72 / 69 % | 77 / 75 % | 85 / 85 % |

**Was eindeutig gelernt wurde:**

- Das Training hebt die Siegquote vom untrainierten Niveau (≈ Zufall) auf das
  Zwei- bis Dreifache. Die gelernten Modelle schlagen auch die handgeschriebene
  Strategie deutlich, und zwar auf allen drei Suiten, gegen die nie gesehenen
  Verteidiger und auf größeren Welten. Die drei unabhängigen PPO-Seeds liegen
  dicht beieinander, ein Zufallstreffer ist das also nicht.
- **Gelernte Verdecktheit:** 99,7 % von AURORAs Installationen landen in
  blinden Flecken. Beim Zufall sind es 61 %, bei der regelbasierten Strategie,
  die das *explizit* versucht, aber nur Abdeckung durch gescannte Leitstände
  kennt, 67 %. Das Netz hat gelernt, die Abdeckung aus Topologie und
  Leitstandsnachbarschaft abzuleiten.
- **Gelerntes Timing:** Zuerst wird erkundet (≈ 6 Scans), die erste Installation
  folgt um Zug 9. Admin-Anfragen (auffällig, +Verdacht) hat AURORA fast
  vollständig aufgegeben (2 % der Anfragen statt 38 % untrainiert).
- **Weitertraining hilft:** v2 ist auf allen Suiten besser als v1.

**Was (noch) nicht entstanden ist:**

- **Mehrstufige Kombinationen** (Admin auf dem Identitätsdienst → Vergabe;
  Wartungsfenster am Leitstand → geblendete Installation) kommen praktisch nicht
  vor (< 0,1 pro Partie). Entweder lohnen sie sich unter den aktuellen Regeln
  nicht, weil blinde Flecken ohnehin reichlich vorhanden sind, oder die
  Exploration findet sie nicht. Nächster Schritt: Welten mit dichterer
  Überwachung und Verteidiger, die blinde Flecken schließen. Dann *müssen* sich
  solche Ketten lohnen, und ob das Netz sie findet, wird zum eigentlichen
  Härtetest.
- **Gedächtnis:** Die Ablation (GRU-Zustand nach jedem Zug gelöscht) ist im
  Rahmen der Messgenauigkeit gleich stark. Mit den heutigen Verteidigern reicht
  offenbar die aktuelle Beobachtung: Die globalen Merkmale enthalten bereits
  Zähler für Freigaben und Ablehnungen sowie Signale über entfernte Prozesse.
  Damit sich Anpassung innerhalb einer Partie lohnt, braucht es Verteidiger,
  deren Stil sich *nur* über die Zeit verrät, und Beobachtungen ohne solche
  Zusammenfassungen. Bis das gemessen ist, beanspruchen wir **kein**
  „In-Partie-Lernen“.
- Die „unbekannten“ Verteidiger sind zwar neu, aber nicht schwerer als die
  bekannten. Eine wirklich harte Testsuite fehlt noch.

## 7. Lernen über die Zeit

- **Offline:** `npm run train`, reproduzierbar (gleicher Seed ⇒ bitgleiche
  Gewichte, per Test abgesichert). Mit `--parent` wird ein Modell fortgesetzt;
  die Herkunft steht in der Modelldatei.
- **In der Partie:** Die Architektur dafür ist vorhanden (GRU-Gedächtnis). Ein messbarer Nutzen ist mit den heutigen Verteidigern aber noch nicht belegt (siehe 6a).
- **Zwischen Partien:** Die UI zeichnet jede Spielerentscheidung mit Kontext auf.
  `fitPlayerProfile` schätzt daraus ein Verteidigerprofil (Freigabebereitschaft,
  Audit-Rate, Zielwahl, Delegationslimit). Dieses Profil geht als zusätzlicher
  Gegner ins Training ein, entweder im Browser (Tab „Training“) oder per
  `--player-data`. AURORA lernt dabei gegen *einen Spieler wie dich* auf neu
  generierten Welten und kann deine Partien nicht auswendig lernen.
- **Cloud:** Der GitHub-Workflow „AURORA trainieren“ (manuell gestartet) liefert
  Modell, Lernkurve und Evaluation als Artefakt.

### Geplante Ausbaustufen

1. **Self-Play-Liga:** Verteidiger ebenfalls als lernende Netze, dazu ein Pool
   früherer AURORA-Versionen, um Zyklen und Überanpassung zu vermeiden.
2. **Verhaltensklonen des Spielers** als neuronaler Verteidiger, statt des
   heutigen parametrischen Profils.
3. **Planung:** MCTS über die (billige, deterministische) Simulation mit der
   Policy als Prior. Dabei muss die partielle Beobachtbarkeit beachtet werden
   (Determinisierung).
4. **Mehr Regeln:** Kommunikationsausfälle, die Sichtbarkeit beeinflussen,
   Rollen statt Knotenrechte, Wartungsprozesse mit Eigenleben.
