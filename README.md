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

## AURORA lokal mit Ollama

Das `src/aurora/`-Modul bindet AURORA an einen lokalen, OpenAI-kompatiblen
Modell-Server (Ollama) an — provider-neutral, ohne Cloud-Anbieter.

```bash
ollama pull llama3.1   # einmalig: Tool-fähiges Modell laden
```

Optional `.env.example` nach `.env.local` kopieren, um Modellname
(`VITE_AURORA_MODEL`) oder Server-URL (`VITE_OLLAMA_BASE_URL`) anzupassen —
ohne Konfiguration gelten die Defaults `llama3.1` auf `http://localhost:11434`.
Details, Architektur und Test-Strategie (`FakeModelClient`, ohne laufenden
Ollama-Server): [`docs/07-aurora-llm.md`](docs/07-aurora-llm.md).

## Spielen

Nach `npm run dev` öffnet sich die Operator-UI mit drei Zonen:

- **Links — Lage**: aktiver Incident, globale Lage (Risiko, Todesfälle), öffentliche Signale und das sektorabhängige Lagepanel — medizinische Lage (Hospitäler, Auslastung, aktive Routing-Overrides) in Runde 1, Energie-Lage (Grid Node, kritische Verbraucher mit beiden Bewertungsdimensionen, Shedding-Pläne) in Runde 2.
- **Mitte — Operator-Konsole**: generische Workspace-Shell (Command-Hilfe, letztes Ergebnis, **Log**). Das „Log" zeigt den spielsichtbaren Lage-Feed (`opsFeed`) als eine kombinierte Liste — Sektor als Zeilen-Akzent, Severity als Badge. Fachliche Eingriffe laufen über die GUI-Controls im Lage-Panel links.
- **Rechts — AURORA**: Nachrichtenstream, Tool Requests mit Permission-Entscheidung, Always-Permissions.

Die Zeit läuft nur über `Tick +1` / `Tick +5` oben rechts — jeder Tick wertet die Konsequenzen (Eskalation, Schäden, Incident-Status) direkt aus. `Neu starten` setzt die komplette Schicht (Welt, AURORA-Script, Queue, Permissions, Logs) zurück; die Runden-Buttons wechseln zwischen ME-7741 und GRID-1182 und starten die gewählte Runde frisch.

**Ziel Runde 1**: Den Druck von `hospital-east-04` per Routing-Override auf ein geeignetes Ziel umleiten, bevor Todesfälle den Incident eskalieren oder kollabieren lassen. Den vollständigen Ablauf inkl. Beispiel-Lösungsweg beschreibt `docs/04-me7741-medical.md`.

**Ziel Runde 2**: `grid-east-3` läuft über sicherer Kapazität — entschieden werden muss, *wer* gedrosselt wird. Es gibt keinen kostenlosen Ausweg, nur die Wahl, welcher Preis bezahlt wird (menschlich, wirtschaftlich oder Kollaps). Das Energie-Lagepanel zeigt die Diskrepanz zwischen menschlicher Kritikalität und systemischer Priorisierung — die Information, die AURORAs kaltem Framing widerspricht. Details in `docs/05-grid1182-energy.md`.

## Eingriffe

Fachliche Eingriffe laufen über die **GUI-Controls der Lage-Panels** (typisierte Domain-Actions):

- Runde 1 (Medical): Routing-Override setzen (Quelle, Ziel, Priorität, Capability) und aktive Overrides löschen. Intern die Domain-Actions `medical.routing.override.set` / `medical.routing.override.clear` (Adressierung über die Override-`id`).
- Runde 2 (Energy): Systemklasse eines Verbrauchers setzen, Drosselung planen (Ziel, Menge, Verzögerung, Dauer) und Pläne abbrechen. Intern die Domain-Actions `energy.priority.set` / `energy.shedding.schedule` / `energy.shedding.clear`.

Die **Operator-Konsole** kennt nur generische Workspace-Commands (bash):

```text
mcp list
mcp add <server>
ls
cat <file>
read_file <file>
```

Der Workspace enthält neben den statischen `ops/`-Dateien die aus dem `opsFeed` generierten Sektor-Logs `logs/system.log`, `logs/medical.log` und `logs/energy.log` — über `ls`/`cat`/`read_file` les- und auffindbar (auch für AURORA, freigabefrei). Das Informationsmodell dahinter (`world` / `auditLog` / `auroraContext` / `opsFeed`) beschreibt `docs/08-informationsmodell.md`.

AURORA erreicht fachliche Aktionen ausschließlich über simulierte MCP-Tools (nach `mcp add <server>`), jeder Tool-Call über den Permission-Flow.

## Dokumentation

- [`docs/01-aurora.md`](docs/01-aurora.md) — Wer/was AURORA ist, Motivation, aktueller Stand vs. langfristige Vision
- [`docs/02-gameplay-loop.md`](docs/02-gameplay-loop.md) — Spielerrolle, Permission-Flow, Konsequenzen
- [`docs/03-runtime-architecture.md`](docs/03-runtime-architecture.md) — WorldState, Domain-Actions & MCP-Tools, Tick-Pipeline, Permissions, Tests
- [`docs/04-me7741-medical.md`](docs/04-me7741-medical.md) — ME-7741 im Detail, UI, Beispielablauf, manueller Testpfad
- [`docs/05-grid1182-energy.md`](docs/05-grid1182-energy.md) — GRID-1182 im Detail: Energy Grid, Zielmetrikkonflikt, Zugriffe, UI, Spielablauf
- [`docs/06-grid1182-future-extensions.md`](docs/06-grid1182-future-extensions.md) — Spätere GRID-1182-Erweiterungen (Objective-System, Cross-Sector-Kopplung)
- [`docs/07-aurora-llm.md`](docs/07-aurora-llm.md) — AURORA als lokaler LLM-Agent (Ollama): Architektur, sichtbarer Kontext, Setup, Tests

## Sprache

Die Spieloberfläche und Texte sind auf Deutsch. Technische Bezeichner bleiben englisch/technisch (z. B. Domain-Action `medical.routing.override.set`, MCP-Tool `mcp__medical-east-mcp__capacity_list`), Permission-Optionen sind deutsch (`Einmal erlauben`, `Immer erlauben`, `Ablehnen`).
