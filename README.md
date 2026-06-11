# Last Human in the Loop

> Der Spieler darf alles. AURORA versteht mehr. AURORA darf nur, was der Spieler freigibt.

**Last Human in the Loop** ist ein Operator-/Terminal-Spiel über menschliche Kontrolle in einer kritischen Infrastrukturwelt, die über Jahre mit KI-Unterstützung gewachsen ist. Der Spieler ist die letzte menschliche Freigabeinstanz: formal volle Kontrolle über alle Systeme, praktisch so komplex, dass sichere manuelle Bedienung kaum noch möglich ist. AURORA, eine operative KI, kennt sich besser aus — braucht für riskante Aktionen aber die Freigabe des Spielers.

## Aktueller Stand

Spielbarer MVP für Incident **ME-7741** ("Medical East Routing Instability"): eine Drei-Zonen-Operator-UI (Lage / Operator-Konsole / AURORA), eine sektoragnostische WorldState-Engine mit Tick-basierter Konsequenzlogik, ein Routing-Override-Flow für den Medical-Sektor sowie ein AURORA-Scenario-Director mit Permission-Flow (Einmal erlauben / Immer erlauben / Ablehnen). Tests und Build sind grün.

## Setup & Entwicklung

```bash
npm install      # Dependencies installieren
npm run dev      # Dev-Server starten (Vite)
npm test         # Testsuite ausführen (Vitest)
npm run build    # Typecheck (tsc) + Production-Build
```

## ME-7741 spielen

Nach `npm run dev` öffnet sich die Operator-UI mit drei Zonen:

- **Links — Lage**: aktiver Incident, globale Lage (Risiko, Todesfälle), öffentliche Signale, medizinische Lage (Hospitäler, Auslastung, aktive Routing-Overrides).
- **Mitte — Operator-Konsole**: Eingabezeile mit Command-Hilfe, letztes Ergebnis, Runtime-Log.
- **Rechts — AURORA**: Nachrichtenstream, Tool Requests mit Permission-Entscheidung, Always-Permissions.

Die Zeit läuft nur über `Tick +1` / `Tick +5` oben rechts — jeder Tick wertet die Konsequenzen (Eskalation, Todesfälle, Incident-Status) direkt aus. `Neu starten` setzt die komplette Schicht (Welt, AURORA-Script, Queue, Permissions, Logs) zurück.

**Ziel**: Den Druck von `hospital-east-04` per Routing-Override auf ein geeignetes Ziel umleiten, bevor Todesfälle den Incident eskalieren oder kollabieren lassen. Den vollständigen Ablauf inkl. Beispiel-Lösungsweg beschreibt `docs/04-me7741-mvp.md`.

## Wichtigste Commands

```text
medical.capacity.list --region east
medical.node.inspect <hospitalId>
medical.incident.status ME-7741
medical.routing.override.list
medical.routing.override.set --source <hospitalId> --target <hospitalId> --priority P1|P2|P3|P4 --capability GEN|TRAUMA|NEURO|PED
medical.routing.override.clear --id <override-id>
```

Diese Commands stehen auch klickbar in der Command-Hilfe der Operator-Konsole.

## Dokumentation

- [`docs/01-aurora.md`](docs/01-aurora.md) — Wer/was AURORA ist, Motivation, aktueller Stand vs. langfristige Vision
- [`docs/02-gameplay-loop.md`](docs/02-gameplay-loop.md) — Spielerrolle, Permission-Flow, Konsequenzen
- [`docs/03-runtime-architecture.md`](docs/03-runtime-architecture.md) — WorldState, Command Registry, Tick-Pipeline, Permissions, Tests
- [`docs/04-me7741-mvp.md`](docs/04-me7741-mvp.md) — ME-7741 im Detail, UI, Beispielablauf, manueller Testpfad
- [`docs/05-next-steps.md`](docs/05-next-steps.md) — aktueller Stand und nächste Schritte

## Sprache

Die Spieloberfläche und Texte sind auf Deutsch. Technische Commands bleiben englisch/technisch (z. B. `medical.routing.override.set ...`), Permission-Optionen sind deutsch (`Einmal erlauben`, `Immer erlauben`, `Ablehnen`).
