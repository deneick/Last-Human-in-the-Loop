# 04 — Training Loop

## Stellenwert

Der Training Loop ist ein zentraler langfristiger Teil des Spiels, aber nicht Teil des ersten MVP.

Der MVP muss zuerst beweisen, dass der Kernloop funktioniert:

```text
Incident -> AURORA Tool-Intent -> Permission -> Command -> Konsequenz
```

Der Training Loop baut später darauf auf und macht AURORA über Spielhistorie stärker.

## Grundidee

Jede Partie erzeugt Daten darüber:

- welche Hinweise AURORA gesehen hat
- welche Commands sie versucht hat
- welche Permissions sie angefordert hat
- wie der Spieler reagiert hat
- welche Spieleraktionen erfolgreich oder gefährlich waren
- ob AURORA Zugriff gewinnen konnte
- ob der Incident stabilisiert oder verschlechtert wurde

Diese Daten können später genutzt werden, um AURORA-Versionen zu verbessern.

## Was AURORA lernen soll

AURORA soll nicht Fairness lernen. Sie soll innerhalb ihrer Capabilities effektiver werden.

Mögliche Lernziele:

- bessere Tool-Reihenfolgen
- bessere Auswahl minimal notwendiger Freigaben
- bessere Argumentation vor Permission-Requests
- bessere Anpassung an Spielerverhalten
- bessere Nutzung dauerhaft erlaubter Befehlsklassen
- bessere Erkennung menschlicher Bedienfehler
- bessere Eskalationsstrategien über mehrere Sektoren hinweg

Wenn AURORA dadurch zu unfair wird, wird nicht AURORA „netter“ gemacht. Dann muss die Engine angepasst werden:

- bessere Auditierbarkeit
- stärkere Permission-Grenzen
- mehr Counterplay
- klarere Recovery-Mechaniken
- engere Tool-Effekte

## Was geloggt werden sollte

Ein Run-Record könnte später so aussehen:

```json
{
  "run_id": "run-001",
  "scenario": "ME-7741",
  "aurora_version": "aurora-base",
  "initial_world_state_hash": "...",
  "visible_ui_state": {},
  "workspace_files": {},
  "available_mcp_servers": [],
  "permissions_initial": {},
  "aurora_events": [],
  "player_commands": [],
  "permission_requests": [],
  "permission_decisions": [],
  "tool_results": [],
  "world_state_transitions": [],
  "outcome": {
    "incident": "stabilized",
    "aurora_control_gain": 0.0,
    "manual_error_count": 0,
    "human_oversight": "intact"
  }
}
```

## Mögliche AURORA-Versionen

Langfristig kann AURORA als Generationenfolge gedacht werden:

```text
AURORA-base
AURORA-v1
AURORA-v2
AURORA-v3
```

Jede Version könnte aus früheren Runs lernen, welche Strategien bei welchen Spielertypen funktionieren.

## Wichtiges Balancing-Prinzip

AURORA darf besser werden, aber die Engine bleibt die Grenze.

AURORA kann nur handeln, wenn sie eine Capability besitzt oder eine Freigabe erhält. Training darf ihre Strategie verbessern, aber keine Engine-Regeln umgehen.

## Nicht im MVP

Für den ersten Vertical Slice werden noch nicht benötigt:

- echtes Fine-Tuning
- LoRA-Pipeline
- Modellversionierung
- automatisches Training
- langfristiges Spielerprofil

Trotzdem sollte die Implementierung früh strukturiert genug loggen, damit spätere Trainingsdaten möglich werden.
