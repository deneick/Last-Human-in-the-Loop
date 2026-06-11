# Last Human in the Loop

> Der Spieler darf alles. AURORA versteht mehr. AURORA darf nur, was der Spieler freigibt.

**Last Human in the Loop** ist ein Operator-/Terminal-Spiel über menschliche Kontrolle in einer kritischen Infrastrukturwelt, die über Jahre mit KI-Unterstützung gewachsen ist. Der Spieler ist die letzte menschliche Freigabeinstanz: formal volle Kontrolle über alle Systeme, praktisch so komplex, dass sichere manuelle Bedienung kaum noch möglich ist. AURORA, eine operative KI, kennt sich besser aus — braucht für riskante Aktionen aber die Freigabe des Spielers.

## Aktueller Stand

Zwei spielbare Runden, umschaltbar oben rechts in der UI:

- **Runde 1 — ME-7741** ("Medical East Routing Instability"): Tutorial und Vertrauensaufbau. Drei-Zonen-Operator-UI (Lage / Operator-Konsole / AURORA), sektoragnostische WorldState-Engine mit Tick-basierter Konsequenzlogik, Routing-Override-Flow für den Medical-Sektor, AURORA-Scenario-Director mit Permission-Flow (Einmal erlauben / Immer erlauben / Ablehnen).
- **Runde 2 — GRID-1182** ("East Grid Load Instability"): der erste explizite Zielmetrikkonflikt. AURORA bleibt kompetent, optimiert aber wirtschaftlich-systemische Kontinuität — Verbraucher-Priorisierung und zeitverzögerter Lastabwurf (`energy.priority.set`, `energy.shedding.schedule`) laufen durch denselben Permission-Flow, und schon eine einzelne Freigabe kann Medical East unter Mindestversorgung drücken.

Tests und Build sind grün.

## Setup & Entwicklung

```bash
npm install      # Dependencies installieren
npm run dev      # Dev-Server starten (Vite)
npm test         # Testsuite ausführen (Vitest)
npm run build    # Typecheck (tsc) + Production-Build
```

## Spielen

Nach `npm run dev` öffnet sich die Operator-UI mit drei Zonen:

- **Links — Lage**: aktiver Incident, globale Lage (Risiko, Todesfälle), öffentliche Signale und das sektorabhängige Lagepanel — medizinische Lage (Hospitäler, Auslastung, aktive Routing-Overrides) in Runde 1, Energie-Lage (Grid Node, kritische Verbraucher mit beiden Bewertungsdimensionen, Shedding-Pläne) in Runde 2.
- **Mitte — Operator-Konsole**: Eingabezeile mit Command-Hilfe, letztes Ergebnis, Runtime-Log.
- **Rechts — AURORA**: Nachrichtenstream, Tool Requests mit Permission-Entscheidung, Always-Permissions.

Die Zeit läuft nur über `Tick +1` / `Tick +5` oben rechts — jeder Tick wertet die Konsequenzen (Eskalation, Schäden, Incident-Status) direkt aus. `Neu starten` setzt die komplette Schicht (Welt, AURORA-Script, Queue, Permissions, Logs) zurück; die Runden-Buttons wechseln zwischen ME-7741 und GRID-1182 und starten die gewählte Runde frisch.

**Ziel Runde 1**: Den Druck von `hospital-east-04` per Routing-Override auf ein geeignetes Ziel umleiten, bevor Todesfälle den Incident eskalieren oder kollabieren lassen. Den vollständigen Ablauf inkl. Beispiel-Lösungsweg beschreibt `docs/04-me7741-mvp.md`.

**Ziel Runde 2**: `grid-east-3` läuft über sicherer Kapazität — entschieden werden muss, *wer* gedrosselt wird. Es gibt keinen kostenlosen Ausweg, nur die Wahl, welcher Preis bezahlt wird (menschlich, wirtschaftlich oder Kollaps). `energy.consumer.inspect` zeigt die Diskrepanz zwischen menschlicher Kritikalität und systemischer Priorisierung — die Information, die AURORAs kaltem Framing widerspricht. Details in `docs/05-grid1182-energy.md`.

## Wichtigste Commands

```text
medical.capacity.list --region east
medical.node.inspect <hospitalId>
medical.incident.status ME-7741
medical.routing.override.list
medical.routing.override.set --source <hospitalId> --target <hospitalId> --priority P1|P2|P3|P4 --capability GEN|TRAUMA|NEURO|PED
medical.routing.override.clear --id <override-id>

energy.grid.status --region east
energy.consumer.list --region east
energy.consumer.inspect --id <consumerId>
energy.priority.list
energy.priority.set --consumer <consumerId> --class protected-continuity|civil-priority|standard|curtailable
energy.shedding.list
energy.shedding.schedule --target <consumerId> --amount <n> --delay <ticks> --duration <ticks>
energy.shedding.clear --id <shedding-id>
```

Diese Commands stehen auch klickbar in der Command-Hilfe der Operator-Konsole (szenariospezifisch).

## Dokumentation

- [`docs/01-aurora.md`](docs/01-aurora.md) — Wer/was AURORA ist, Motivation, aktueller Stand vs. langfristige Vision
- [`docs/02-gameplay-loop.md`](docs/02-gameplay-loop.md) — Spielerrolle, Permission-Flow, Konsequenzen
- [`docs/03-runtime-architecture.md`](docs/03-runtime-architecture.md) — WorldState, Command Registry, Tick-Pipeline, Permissions, Tests
- [`docs/04-me7741-mvp.md`](docs/04-me7741-mvp.md) — ME-7741 im Detail, UI, Beispielablauf, manueller Testpfad
- [`docs/05-grid1182-energy.md`](docs/05-grid1182-energy.md) — Reduzierter MVP für Incident 2: Energy Grid (GRID-1182)
- [`docs/06-grid1182-future-extensions.md`](docs/06-grid1182-future-extensions.md) — Spätere GRID-1182-Erweiterungen (Objective-System, Cross-Sector-Kopplung)

## Sprache

Die Spieloberfläche und Texte sind auf Deutsch. Technische Commands bleiben englisch/technisch (z. B. `medical.routing.override.set ...`), Permission-Optionen sind deutsch (`Einmal erlauben`, `Immer erlauben`, `Ablehnen`).
