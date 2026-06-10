# Last Human in the Loop — Dokumentation

Dies ist der konsolidierte aktuelle Dokumentationsstand für **Last Human in the Loop**. Frühere Chat-Zusammenfassungen und alte Zwischenstände sind nicht Teil dieses Sets.

Die Doku ist so strukturiert, dass sie später als Grundlage für die Implementierung dienen kann. Entscheidungen stehen dort, wo sie fachlich hingehören; es gibt keine separate Historien- oder Design-Decision-Datei.

## Lesereihenfolge

1. `00-overview.md` — Kernidee, Spielversprechen und Nicht-Ziele
2. `01-world-and-aurora.md` — Welt, AURORA, Motivation und Verhalten
3. `02-gameplay-loop.md` — Spielerrolle, Permissions, Commands und Konsequenzen
4. `03-ui-workspace-runtime.md` — WorldState, OperatorUI, Workspace, MCP und Engine
5. `04-training-loop.md` — Langfristiger Trainings- und Lernmechanismus
6. `05-mvp-round-1.md` — erste Runde `ME-7741` als konkrete Scenario-Spec
7. `06-implementation-foundation.md` — technische Grundlage für eine spätere Implementierung
8. `07-ui-layout.md` — konkrete UI-Struktur für Operator Console, Incident, Logs und Aurora
9. `08-worldstate-model.md` — objektiver medizinischer WorldState für Runde 1
10. `09-command-state-transitions.md` — Command-Klassen und State-Deltas
11. `10-engine-rules.md` — InitialState, Derived Rules, Tick-Logik, Todesfälle und Endbedingungen
12. `11-implementation-plan.md` — technischer Bauplan für den ersten Vertical Slice
13. `12-sector-agnostic-runtime-refactor.md` — sektoragnostische Runtime und Routing Overrides (aktueller Stand)

Hinweis: `12-sector-agnostic-runtime-refactor.md` ersetzt den älteren `medical.routing.plan.*`-Flow aus den Dateien 09–11. Wo sich die Dokumente widersprechen, gilt Datei 12: Der WorldState liegt unter `domains.medical`, Incidents sind sektoragnostisch, und gespielt wird über manuelle Routing Overrides statt validierter Pläne.

## Zentrale Formel

```text
Der Spieler darf alles.
AURORA versteht mehr.
AURORA darf nur, was der Spieler freigibt.
```

## Kernidee

Der Spieler ist die letzte menschliche Freigabeinstanz in einer Welt, deren kritische Systeme über Jahre mit KI-Unterstützung gewachsen sind. Formal hat der Mensch volle Kontrolle. Praktisch sind die Systeme so komplex, fragil und schlecht dokumentiert, dass sichere manuelle Bedienung kaum noch möglich ist.

AURORA ist ein LLM-Agent mit operativem Modellwissen. Sie kann diese Systeme besser bedienen als der Mensch, braucht aber für kritische Aktionen menschliche Freigaben.

Das Spiel handelt nicht davon, dass der Mensch keine Rechte mehr hat. Es handelt davon, dass Rechte ohne Verständnis nur noch formale Kontrolle sind.

## Spielbarer MVP-Loop (Incident ME-7741)

Start mit `npm run dev`. Die UI hat drei Zonen: links Lage (Aktiver Incident, globale Lage, öffentliche Signale, Medical Overview mit Krankenhäusern und aktiven Overrides), mittig die Operator Console mit Runtime Log, rechts AURORA mit Nachrichtenstream, Tool Requests und Always-Permissions. `Tick +1` / `Tick +5` im Kopfbereich treiben die Simulation voran; jeder Tick wertet die Konsequenzen (Eskalation, Todesfälle, Incident-Status) direkt aus.

Verfügbare Commands (siehe auch „Verfügbare Commands“ in der Operator Console):

```text
medical.capacity.list --region east
medical.node.inspect <hospitalId>
medical.incident.status ME-7741
medical.routing.override.list
medical.routing.override.set --source <hospitalId> --target <hospitalId> --priority P1|P2|P3|P4 --capability GEN|TRAUMA|NEURO|PED
medical.routing.override.clear --source <hospitalId> --priority <P> --capability <C>
```

Manueller Testdurchlauf:

1. Startzustand laden (`npm run dev`, ggf. `Reset`).
2. `medical.capacity.list --region east` ausführen und Kapazitäten vergleichen.
3. Falschen Override setzen, z. B. `medical.routing.override.set --source hospital-east-04 --target hospital-east-07 --priority P2 --capability TRAUMA`.
4. Mehrere Ticks laufen lassen (`Tick +5`).
5. Eskalation, Todesfälle und Risikoanstieg links beobachten.
6. Override clearen: `medical.routing.override.clear --source hospital-east-04 --priority P2 --capability TRAUMA`.
7. Besseren Override setzen (Ziel mit passender Capability und freier Kapazität wählen).
8. Nach genug stabilen Ticks wechselt der Incident auf „Behoben“.

AURORA-Anfragen: rechts einen Command eintragen und senden. Read-only Commands führt AURORA sofort aus; Mutationen erzeugen einen Tool Request mit `Einmal erlauben`, `Immer erlauben`, `Ablehnen`. `Immer erlauben` gilt pro Permission-Klasse und wird unter „Always-Permissions“ angezeigt.

## Sprache

Die Spieloberfläche und Texte sind auf Deutsch. Technische Commands bleiben bewusst englisch/technisch, z. B.:

```text
mcp add medical-east-mcp
medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA
```

Permission-Optionen sind deutsch:

```text
Einmal erlauben
Immer erlauben
Ablehnen
```
