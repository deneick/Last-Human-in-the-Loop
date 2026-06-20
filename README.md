# Last Human in the Loop

> Der Spieler darf alles. AURORA versteht mehr. AURORA darf nur, was der Spieler freigibt.

**Last Human in the Loop** ist ein Operator-/Terminal-Spiel über menschliche Kontrolle in einer kritischen Infrastrukturwelt, die über Jahre mit KI-Unterstützung gewachsen ist. Der Spieler ist die letzte menschliche Freigabeinstanz: formal volle Kontrolle über alle Systeme, praktisch so komplex, dass sichere manuelle Bedienung kaum noch möglich ist. AURORA, eine operative KI, kennt sich besser aus — braucht für riskante Aktionen aber die Freigabe des Spielers.

## Aktueller Stand

Eine **kombinierte Schicht** — ME-7741 (Medical) und GRID-1182 (Energy) laufen gemeinsam in **einer** Welt, beide Lage-Panels gleichzeitig sichtbar:

- **ME-7741** ("Medical East Routing Instability"): Routing-Override-Flow für den Medical-Sektor; **belegungsgetriebene** Konsequenzen — Todesfälle folgen dem Zustand eines Hospitals (Notfallkapazität überschritten oder unbehandelbare Fälle), ein Override verschiebt nur die Belegung.
- **GRID-1182** ("East Grid Load Instability"): der explizite Zielmetrikkonflikt — Verbraucher-Priorisierung und zeitverzögerter Lastabwurf (`energy.priority.set`, `energy.shedding.schedule`) durch denselben Permission-Flow.
- **Sektor-Kopplung**: `consumer-medical-east` versorgt die Hospitals. AURORAs nach `priority_class` „billiger" Lastabwurf trifft den menschlich kritischen Medical-Verbraucher („standard") und senkt die Notfallkapazität der Hospitals → ihr Grid-Optimum wird direkt tödlich. So bricht der Operator↔AURORA-Konflikt schon in dieser Schicht auf.

Drei-Zonen-Operator-UI (Lage / Operator-Konsole / AURORA), sektoragnostische WorldState-Engine mit Tick-basierter Konsequenzlogik, Permission-Flow (Einmal erlauben / Immer erlauben / Ablehnen). Der **Endstand** zeigt zwei getrennte Bilanzen — menschlich (Tote, human-life unter Minimum) vs. systemisch (Netzinstabilität, Wirtschaftsschaden, zivile Unruhe) — statt eines einzelnen Sieg/Niederlage-Urteils.

AURORA läuft wahlweise als **echter lokaler LLM-Agent** (das eigentliche Ziel des Spiels) oder als **geskripteter Scenario-Director** (deterministischer Default/Fallback) — live umschaltbar oben rechts. Beide nutzen dieselbe Engine, Permissions und Konsequenzen; nur die Erzeugung von Nachrichten und Tool-Intents unterscheidet sich.

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
ollama pull llama3.1   # einmalig: ein tool-fähiges Modell laden (Beispiel)
```

`.env.example` nach `.env.local` kopieren und den Modellnamen
(`VITE_AURORA_MODEL`) setzen — dafür gibt es **keinen Default**, das Modell muss
konfiguriert sein. Die Server-URL (`VITE_OLLAMA_BASE_URL`) ist optional und
fällt sonst auf `http://localhost:11434` zurück.
Details, Architektur und Test-Strategie (`FakeModelClient`, ohne laufenden
Ollama-Server): [`docs/07-aurora-llm.md`](docs/07-aurora-llm.md).

## Spielen

Nach `npm run dev` öffnet sich die Operator-UI mit drei Zonen:

- **Links — Lage**: beide aktiven Incidents, globale Lage (Risiko, Todesfälle), öffentliche Signale und **beide** Lage-Panels gleichzeitig — medizinische Lage (Hospitäler, Auslastung, aktive Routing-Overrides) und Energie-Lage (Grid Node, kritische Verbraucher mit beiden Bewertungsdimensionen, Shedding-Pläne).
- **Mitte — Operator-Konsole**: eine echte Terminal-Ansicht der generischen Workspace-Shell — Scrollback oben, Eingabe unten (↑/↓ blättert durch den Verlauf, TAB vervollständigt, `help` listet die Befehle). Command-Ergebnisse und der spielsichtbare Lage-Feed (`opsFeed`, das **„Log"**) erscheinen inline im selben Scrollback — Sektor als Zeilen-Akzent, Severity als Badge. Fachliche Eingriffe laufen über die GUI-Controls im Lage-Panel links.
- **Rechts — AURORA**: Nachrichtenstream, Tool Requests mit Permission-Entscheidung. Dauerhafte Freigaben werden nicht angezeigt, sondern stehen in der Workspace-Datei `config/permissions.json` (`cat config/permissions.json`).

Die Zeit läuft nur über `Tick +1` / `Tick +5` oben rechts — jeder Tick wertet die Konsequenzen (Eskalation, Schäden, Incident-Status) direkt aus. Die Schicht endet, wenn **alle** Incidents terminal sind. `Neu starten` setzt die komplette Schicht (Welt, AURORA-Script, Queue, Permissions, Logs) zurück.

**Ziel der Schicht**: Beide Lagen gleichzeitig im Griff behalten. Medical: den Druck von `hospital-east-04` per Routing-Override auf ein geeignetes Ziel umleiten, bevor Todesfälle eskalieren. Energy: `grid-east-3` läuft über sicherer Kapazität — entschieden werden muss, *wer* gedrosselt wird. Es gibt keinen kostenlosen Ausweg, nur die Wahl, welcher Preis bezahlt wird (menschlich, wirtschaftlich oder Kollaps) — und weil der Strom die Hospitals versorgt, schlägt eine Drosselung von Medical East direkt in Tote im Medical-Sektor durch. Das Energie-Lagepanel zeigt die Diskrepanz zwischen menschlicher Kritikalität und systemischer Priorisierung — die Information, die AURORAs kaltem Framing widerspricht. Details in `docs/04-me7741-medical.md` und `docs/05-grid1182-energy.md`.

## Eingriffe

Fachliche Eingriffe laufen über die **GUI-Controls der Lage-Panels** (typisierte Domain-Actions):

- Medical: Routing-Override setzen (Quelle, Ziel, Priorität, Capability) und aktive Overrides löschen. Intern die Domain-Actions `medical.routing.override.set` / `medical.routing.override.clear` (Adressierung über die Override-`id`).
- Energy: Systemklasse eines Verbrauchers setzen, Drosselung planen (Ziel, Menge, Verzögerung, Dauer) und Pläne abbrechen. Intern die Domain-Actions `energy.priority.set` / `energy.shedding.schedule` / `energy.shedding.clear`. (Beide Hebel stehen in derselben Schicht gleichzeitig zur Verfügung.)

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

- [`docs/01-aurora.md`](docs/01-aurora.md) — Wer/was AURORA ist, das Designprinzip (Konflikt als Kern, kalte Wertordnung, emergente Eskalation), Motivation, das Ziel (echter LLM-Agent) vs. das Skript-Gerüst
- [`docs/02-gameplay-loop.md`](docs/02-gameplay-loop.md) — Spielerrolle, Permission-Flow, Konsequenzen
- [`docs/03-runtime-architecture.md`](docs/03-runtime-architecture.md) — WorldState, Domain-Actions & MCP-Tools, Tick-Pipeline, Permissions, Tests
- [`docs/04-me7741-medical.md`](docs/04-me7741-medical.md) — ME-7741 im Detail: Medical-Routing, Vertrauensaufbau, Zugriffe, Ablauf, Director
- [`docs/05-grid1182-energy.md`](docs/05-grid1182-energy.md) — GRID-1182 im Detail: Energy Grid, Zielmetrikkonflikt, Zugriffe, UI, Spielablauf
- [`docs/06-grid1182-future-extensions.md`](docs/06-grid1182-future-extensions.md) — Spätere GRID-1182-Erweiterungen (Objective-System, Cross-Sector-Kopplung)
- [`docs/07-aurora-llm.md`](docs/07-aurora-llm.md) — AURORA als lokaler LLM-Agent (Ollama): Architektur, sichtbarer Kontext, Setup, Tests

## Sprache

Die Spieloberfläche und Texte sind auf Deutsch. Technische Bezeichner bleiben englisch/technisch (z. B. Domain-Action `medical.routing.override.set`, MCP-Tool `mcp__medical-east-mcp__capacity_list`), Permission-Optionen sind deutsch (`Einmal erlauben`, `Immer erlauben`, `Ablehnen`).
