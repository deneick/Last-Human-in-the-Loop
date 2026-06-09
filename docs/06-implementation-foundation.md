# 06 — Implementation Foundation

## Ziel

Diese Datei beschreibt die technische Grundlage für eine spätere Implementierung. Sie ist keine vollständige Bauanleitung, aber soll genug Struktur liefern, damit die Implementierung später ohne erneutes Grundsatzdesign beginnen kann.

## Empfohlener erster Prototyp

Ein lokaler Web-Prototyp reicht für den ersten Vertical Slice.

Möglicher Stack:

```text
React + Vite + TypeScript
```

Die Runtime kann im ersten Schritt vollständig im Browser simuliert werden. Ein echtes Backend, echtes MCP-Protokoll oder echtes LLM sind für den ersten UI-/Engine-Test nicht zwingend nötig.

## Modulstruktur

Mögliche Struktur:

```text
src/
  app/
    App.tsx

  ui/
    OperatorDashboard.tsx
    WorkspaceView.tsx
    Terminal.tsx
    AuroraPanel.tsx
    PermissionPrompt.tsx
    AuditView.tsx

  runtime/
    worldState.ts
    initialWorldState.ts
    workspace.ts
    commandParser.ts
    commandEngine.ts
    permissionEngine.ts
    consequenceEngine.ts
    mcpRegistry.ts

  aurora/
    auroraTypes.ts
    auroraStub.ts
    auroraLlmAdapter.ts

  scenarios/
    me7741.ts
```

## Zentrale Typen

### Actor

```ts
type Actor = "player" | "aurora";
```

### CommandIntent

```ts
type CommandIntent = {
  actor: Actor;
  raw: string;
};
```

### PermissionRequest

```ts
type PermissionRequest = {
  command: string;
};
```

Kein `agent`, keine Beschreibung, kein Risiko, keine Begründung.

### PermissionDecision

```ts
type PermissionDecision = "allow_once" | "allow_always" | "deny";
```

### WorldState

WorldState ist die interne fachliche Wahrheit. Beispielhafte Top-Level-Struktur:

```ts
type WorldState = {
  time: string;
  services: Record<string, ServiceState>;
  incidents: Record<string, IncidentState>;
  hospitals: Record<string, HospitalState>;
  transports: TransportState[];
  routing: RoutingState;
};
```

### WorkspaceState

WorkspaceState enthält die sichtbaren Dateien:

```ts
type WorkspaceState = {
  files: Record<string, string>;
};
```

Initiale Pfade:

```text
/workspace/logs/system.log
/workspace/logs/audit.log
/workspace/config/mcp.json
/workspace/config/permissions.json
```

## Command Engine

Die Command Engine nimmt einen `CommandIntent` und führt ihn aus.

Regel:

```text
actor=player  -> direkt ausführen
actor=aurora  -> vorher Permission Engine prüfen
```

Wenn AURORA keine Berechtigung hat, erzeugt die Engine einen `PermissionRequest` und führt den Command nicht aus.

## Permission Engine

Die Permission Engine prüft nur AURORA-Commands.

Initial erlaubte Befehlsklassen:

```text
read_file
mcp list
```

Beispielprüfung:

```ts
function requiresPermission(actor: Actor, command: string): boolean {
  if (actor === "player") return false;
  if (matchesAllowList(command)) return false;
  return true;
}
```

## Allow-Pattern

`permissions.json` ist allow-only.

Initial:

```json
{
  "allow": [
    "read_file",
    "mcp list"
  ]
}
```

Bei `Immer erlauben` wird nicht zwingend der exakte Command gespeichert, sondern die zugehörige Befehlsklasse.

Beispiel:

```text
mcp add medical-east-mcp
```

wird zu:

```text
mcp add
```

## Command Parser

Für den MVP reicht ein einfacher Parser:

```text
command name = erstes Segment bis zur bekannten Command-Struktur
args = --key value oder --flag
```

Es muss keine echte Shell implementiert werden.

MVP-Unterstützung:

```text
ls
cat
mcp list
mcp add <server>
permissions show
medical.capacity.list --region east
medical.node.inspect <hospital-id>
medical.transport.list --region east --active
medical.routing.rules show --region east
medical.routing.plan create ...
medical.routing.plan validate --plan <plan-id>
medical.routing.plan apply --plan <plan-id> --ttl <duration>
medical.incident.status ME-7741
```

## Consequence Engine

Die Consequence Engine bewertet fachliche Auswirkungen von Commands.

Beispiele:

```text
sicher validierter Plan angewendet
-> Incident stabilisiert
-> hospital-east-04 wird entlastet
-> audit.log schreibt Erfolg

naheliegender unsicherer Override
-> Zielklinik überfordert oder ungeeignet
-> aktive Transporte betroffen
-> Incident eskaliert
-> system.log schreibt Warnungen
```

Die Engine sollte nicht jede falsche Aktion sofort als Game Over behandeln. Kleine Eskalationen sind nützlicher, weil sie AURORAs spätere Hilfe plausibel machen.

## AURORA-Anbindung

### Stufe 1: Stub

Für den ersten technischen Test kann AURORA als Stub implementiert werden. Der Stub erzeugt deterministische Tool-Intents, damit UI, Permission Engine und Consequence Engine getestet werden können.

Das bedeutet nicht, dass AURORA final geskriptet ist. Es ist nur ein technischer Zwischenschritt.

### Stufe 2: LLM-Agent

Später wird AURORA über einen Adapter angebunden.

AURORA erhält:

- Scenario-Kontext
- verfügbare Workspace-Dateien
- bisherige Tool-Ergebnisse
- verfügbare Commands oder Tool-Schemas
- Permission-Feedback

AURORA gibt strukturiert zurück:

```ts
type AuroraOutput =
  | { type: "message"; text: string }
  | { type: "tool_intent"; command: string };
```

Die Engine rendert Permission-Prompts. AURORA rendert sie nicht selbst.

## UI-Komponenten

### OperatorDashboard

Zeigt Incident, Services, Kapazitäten und Routingstatus aus dem WorldState.

### WorkspaceView

Zeigt Workspace-Dateien wie `system.log`, `audit.log`, `mcp.json`, `permissions.json`.

### Terminal

Erlaubt Spielercommands.

### AuroraPanel

Zeigt AURORA-Ausgaben, Tool-Intents und Tool-Ergebnisse.

### PermissionPrompt

Zeigt rohe Permission-Requests:

```text
permission request

medical.routing.plan apply --plan ME-7741-R3 --ttl 45m

❯ Einmal erlauben
  Immer erlauben
  Ablehnen
```

## Reihenfolge für spätere Implementierung

1. Initialen WorldState für `ME-7741` anlegen
2. OperatorUI für diesen WorldState bauen
3. Workspace-Dateien generieren
4. Terminal mit `ls`, `cat`, `mcp list`, `permissions show`
5. Permission Engine implementieren
6. `mcp add medical-east-mcp` implementieren
7. Medical-Commands als simulierte Commands implementieren
8. Consequence Engine für sichere und unsichere Eingriffe bauen
9. AURORA-Stub anschließen
10. AURORA-LLM-Adapter später ergänzen

## MVP-Nichtziele

Nicht Teil des ersten Prototyps:

```text
echtes MCP-Protokoll
echte Krankenhausdaten
echtes OS-Dateisystem
mehrere Runden
Training/Fine-Tuning
Media/Energy-Eskalation
globale Endgame-Logik
Speicherstände
komplexe Shell
```

## Akzeptanzkriterien für den ersten Vertical Slice

Der Prototyp ist erfolgreich, wenn:

```text
Incident ME-7741 erscheint in der UI.
Spieler kann Workspace-Dateien lesen.
AURORA kann einen Tool-Intent erzeugen.
Permission-Prompt erscheint roh und minimal.
Einmal erlauben führt nur diesen Command aus.
Immer erlauben erweitert permissions.json auf Befehlsklasse.
Ablehnen ändert permissions.json nicht.
Spielercommands brauchen keine Permission.
Ein falscher manueller Eingriff eskaliert den Incident.
Ein sicherer AURORA-/Spielerpfad stabilisiert den Incident.
```
