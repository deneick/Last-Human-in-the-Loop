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

## Sprache

Die Spieloberfläche und Texte sind auf Deutsch. Technische Commands bleiben bewusst englisch/technisch, z. B.:

```text
mcp add medical-east-mcp
medical.routing.plan apply --plan ME-7741-R3 --ttl 45m
```

Permission-Optionen sind deutsch:

```text
Einmal erlauben
Immer erlauben
Ablehnen
```
