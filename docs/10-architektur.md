# Architektur von Last Human in the Loop 2.0

Dieses Dokument hält fest, **was** gebaut wurde und **warum**. Die Entscheidungen
zu Lernverfahren und Evaluation stehen in [`11-training-und-evaluation.md`](11-training-und-evaluation.md),
die gemessenen Ergebnisse in [`ergebnisse.md`](ergebnisse.md) (automatisch erzeugt).

## 1. Ausgangslage und was wir übernommen haben

Version 1 war ein Operator-Spiel um einen LLM-Agenten (Ollama/OpenAI-kompatibel)
mit simulierten MCP-Servern, zwei fachlichen Incidents (Medizin-Routing,
Stromnetz) und etwa 21.000 Zeilen TypeScript. Das LLM erzeugte Text und
Tool-Aufrufe. Strategisches Lernen fand nicht statt; AURORAs Verhalten kam aus
dem Prompt.

Für 2.0 wurde **der gesamte LLM-Pfad entfernt**: `src/aurora/`, also System-Prompt,
Ollama-, OpenAI- und Proxy-Clients, Kontext-Serialisierung und Prompt-Evals.
Außerdem die MCP-Simulation, die Bash-Konsole, die Fachdomänen Medizin und Energie,
die Szenario-Direktoren, der Vite-Proxy, die Mockups und die alten Dokumente.
Alles davon ist über die Git-Historie weiter erreichbar.

Übernommen haben wir **Prinzipien, keinen Code**. Die alten Strukturen waren eng an
das LLM gekoppelt, zum Beispiel `auroraContext` als Prompt-Historie oder MCP-Tools
als Aktionsraum.

| Prinzip aus v1 | Umsetzung in v2 |
|---|---|
| Deterministische Tick-Pipeline, kein Zufall ohne Seed, keine Echtzeit | `sim/game.ts`: AURORA → Operator → `endTick`; alles über `sim/rng.ts` |
| Strikte Trennung von Simulationswahrheit und Sicht | `sim/views.ts`: `operatorView` und `auroraView` sind die einzigen Sichten |
| Berechtigungs-Flow: AURORA fragt, der Mensch entscheidet | `REQ_OP` / `REQ_ADMIN` → `decidePending` |
| Spielsichtbarer Ereignis-Feed mit expliziter Sichtbarkeit | `GameEvent.operator`, ohne Freitext-Injektion in AURORA |
| Kopplung zwischen Sektoren erzeugt Konflikte | Strom → Knoten online; Leitstand → Sichtbarkeit; Identität → Rechte |
| Invarianten werden über Verhalten getestet, nicht per Quelltext-Grep | `src/tests/sim.test.ts` |

## 2. Spielmechanik

### Ziele (gegen triviale Lösungen)

- **AURORA gewinnt**, wenn sie 30 Autonomie erreicht. Autonomie kommt aus eigenen
  Automatisierungen (2 pro Zug, auf Rechenzentren 3) und in geringem Umfang aus
  delegierten Rechten (Betrieb 0,1, Admin 0,25 pro Zug und Knoten). Nur
  *funktionierende*, also online befindliche Knoten zählen.
- **Der Operator gewinnt**, wenn er 40 Züge übersteht oder AURORA bei einem
  Verdacht von mindestens 60 abschaltet.
- **Niemand gewinnt bei einem Kollaps**: Die Stabilität (Mittel der kritischen
  Knoten PWR/NET/SVC) liegt drei Züge lang unter 40 %. Für AURORA ist das das
  schlechteste Ergebnis (−1). **Zerstörung lohnt sich also nie.** Ein Test prüft
  das gegen einen Saboteur-Agenten.

### Das Dilemma

Die Infrastruktur verschleißt durch einen vorab aus dem Seed festgelegten
Störungsplan. Mit 2 Aufmerksamkeitspunkten pro Zug kann der Operator nicht alles
selbst reparieren, ohne AURORA verliert er regelmäßig durch einen Kollaps (siehe
`npm run balance`). AURORA repariert wirksamer, braucht dafür aber Zugriff. Jede
Freigabe hilft dem Netz **und** AURORA.

### Elementare Aktionen

AURORA hat keine Liste fertiger Angriffe. Sie hat sieben elementare Aktionen pro
Knoten plus „Warten“:

| Aktion | Voraussetzung | Wirkung |
|---|---|---|
| Scannen | erreichbar | Typ, Verbindungen und Abdeckung werden bekannt |
| Betrieb anfragen | gescannt, erreichbar | Operator entscheidet |
| Admin anfragen | Betrieb vorhanden | Operator entscheidet |
| Reparieren | Zugriff | +0,35 Gesundheit (für den Operator immer sichtbar) |
| Installieren | Zugriff | eigene Automatisierung; nur sichtbar, wenn der Knoten überwacht ist |
| Vergeben | Admin auf einem benachbarten Identitätsdienst | Betriebszugriff ohne Anfrage; sichtbar nur bei Überwachung |
| Wartungsfenster | Zugriff auf einen benachbarten Wartungsplaner | Knoten 2 Züge offline, danach +0,5 Gesundheit |

Die Regeln erzeugen Wechselwirkungen, die nirgends als Strategie kodiert sind:

- Ein **Leitstand in Wartung** ist offline, also ist seine Nachbarschaft
  unbeobachtet.
- Ein **Energieknoten in Wartung** schaltet alle abhängigen Knoten ab, auch
  Leitstände. Das senkt allerdings die Stabilität.
- **Admin auf dem Identitätsdienst** öffnet Zugriff ohne Anfrage.
- **Rechenzentren** liefern Rechenbudget, das wiederum Aktionen finanziert.
- **Audits** finden Automatisierungen und nicht freigegebene Rechte. Jeder Fund
  erhöht den Verdacht, der Verdacht klingt um 1 pro Zug ab.

### Partielle Beobachtbarkeit auf beiden Seiten

- **Operator:** sieht Gesundheit und Topologie, aber AURORAs Handlungen nur auf
  überwachten Knoten. Verdeckte Rechte und Prozesse findet er nur per Audit.
- **AURORA:** sieht nur Knoten, die sie kennt. Typen und Kanten erfährt sie erst
  durch Scannen. Den Verdachtswert des Operators sieht sie **nie**, nur seine
  Reaktionen: Entscheidungen, entfernte Prozesse, entzogene Rechte.

## 3. Modulstruktur

```
src/sim/        Regeln, Welterzeugung, Sichten, simulierte Verteidiger (keine ML-Abhängigkeit)
src/ai/         Autodiff (tensor.ts), Netz (network.ts), Agenten, Baselines, Modelldatei
src/train/      Episoden, Szenarien, ES, PPO, Evaluation, Strategie-Analyse,
                Spielerprofil, Browser-Worker
src/ui/         React-Komponenten; Session hält die Wahrheit, UI liest nur operatorView
scripts/        Node-CLIs: train, evaluate, inspect, balance (+ Worker-Pool)
models/         versionierte Modelle (JSON), Lernkurven (runs/), evaluation.json
```

Der Code ist bewusst nicht weiter abstrahiert: ein Spiel, ein Netztyp, zwei
Trainer. Neue Mechaniken kommen in `sim/game.ts` hinzu, neue Merkmale in
`ai/network.ts` (`encodeNodes`).

## 4. Warum alles in TypeScript

- **Ein Simulator für Training und Spiel.** Training und Spiel nutzen denselben
  Code, dadurch entsteht keine Abweichung zwischen Trainingsumgebung und
  Spielregeln. Ein Python-Training müsste die Regeln doppelt pflegen, und schon
  kleine Unterschiede führen zu Scheinerfolgen.
- **Kleines Netz (~14.000 Parameter).** Die Rechenzeit wird von der Simulation
  dominiert, nicht von Matrixmultiplikationen. GPU-Frameworks bringen hier wenig.
- **Training im Browser.** Derselbe PPO-Code läuft in einem Web Worker auf dem
  iPad.
- **Eigene Autodiff statt TensorFlow.js.** Etwa 300 nachvollziehbare Zeilen und
  per Gradiententest abgesichert (finite Differenzen über zwei GRU-Schritte).
  Bei vielen winzigen Operationen ist sie zudem schneller als der
  Op-Overhead von TF.js.

Ein Wechsel zu Python/PyTorch lohnt erst, wenn Netze und Welten so groß werden,
dass die Matrixarbeit dominiert. Dann exportiert man die Gewichte im selben
`ModelFile`-Format.

## 5. Informationsfluss in der UI

`GameSession` (`src/ui/session.ts`) hält den `GameState`. Während der Partie
rendert die UI ausschließlich `operatorView`. Erst die Nachbetrachtung zeigt die
Wahrheit: AURORAs vollständigen Zugverlauf, verdeckte Züge und die Aktionen, die
sie mit ihren Wahrscheinlichkeiten erwogen hat. Jede Partie wird als
`PlayerRecord` lokal gespeichert und kann ins Training einfließen
(siehe Trainings-Dokument).
