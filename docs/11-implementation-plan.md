# 11 — Implementation Plan

## Zweck

Diese Datei übersetzt den aktuellen Dokumentationsstand in einen konkreten technischen Bauplan für den ersten spielbaren Vertical Slice von **Last Human in the Loop**.

Sie ersetzt keine der bestehenden Konzeptdateien. Sie legt fest, **wie** der MVP jetzt sinnvoll gebaut werden sollte:

```text
React/Vite/TypeScript UI
+ eigene deterministische Simulation Engine
+ Command Registry
+ Permission Runtime
+ Replay/Golden Runs
+ AURORA zunächst als Stub
```

## Zentrale technische Entscheidung

Für den MVP wird **keine externe Game Engine** verwendet.

Das Spiel braucht aktuell keine Physik, Sprites, Tilemaps, 3D-Szene oder Frame-genaue Echtzeitlogik. Der Kern ist eine deterministische Operator-/Simulationsruntime:

```text
WorldState ist die Wahrheit.
Commands erzeugen State-Deltas.
Ticks erzeugen Konsequenzen.
Die UI zeigt nur abgeleitete Sichtweisen.
AURORA darf nur über Tools/Commands wirken.
```

Deshalb wird eine eigene kleine Engine gebaut.

Externe Engines wie Godot, Unity, Phaser oder Pixi werden für den ersten Slice nicht eingesetzt. Sie können später wieder geprüft werden, falls das Spiel deutlich visueller wird, z. B. mit Karten, Netzwerkgraphen, taktischen Ansichten oder animierten Systemlandschaften.

## Ziel des ersten Vertical Slice

Der erste Slice soll `ME-7741` komplett spielbar machen:

```text
Incident erscheint.
Spieler sieht Lage, Logs, Console und AURORA.
Spieler kann Commands selbst ausführen.
AURORA kann Commands anfragen.
Permission Requests funktionieren.
WorldState verändert sich deterministisch.
Ticks erzeugen Überlast, Stabilisierung, Todesfälle oder Kollaps.
Erfolg und Scheitern sind reproduzierbar.
```

Nicht Ziel des ersten Slice:

```text
echter LLM-Agent
mehrere Sektoren
Training Loop
persistente Meta-Progression
Desktop Packaging
aufwendige Animationen
prozedurale Szenarien
```

## Empfohlener Stack

```text
Node.js
Vite
React
TypeScript
Vitest
Playwright
Zod oder Valibot
```

Optional, aber sinnvoll:

```text
XState für UI-/Permission-/Scenario-State-Machines
zustand oder useReducer für Client-State
immer für immutable Updates, falls Patch-Handling sonst unübersichtlich wird
```

Wichtig: Die Engine selbst soll framework-unabhängig bleiben. React darf die Engine benutzen, aber die Engine darf React nicht kennen.

## Projektstruktur

Empfohlene Ordnerstruktur:

```text
src/
  app/
    App.tsx
    routes.tsx

  ui/
    layout/
      OperatorLayout.tsx
      LeftIncidentPane.tsx
      CenterConsolePane.tsx
      AuroraPane.tsx
    components/
      IncidentCard.tsx
      SystemStatusPanel.tsx
      RouterLog.tsx
      OperatorConsole.tsx
      AuroraStream.tsx
      PermissionPrompt.tsx
      ChatInput.tsx

  runtime/
    types.ts
    createInitialWorldState.ts
    engine.ts
    commandParser.ts
    commandRegistry.ts
    permissionEngine.ts
    patch.ts
    tickEngine.ts
    outcomeEngine.ts
    selectors.ts
    presentation.ts
    audit.ts

  runtime/commands/
    filesystemCommands.ts
    mcpCommands.ts
    permissionCommands.ts
    medicalReadCommands.ts
    medicalPlanCommands.ts
    medicalMutationCommands.ts
    tickCommand.ts

  aurora/
    auroraTypes.ts
    auroraStub.ts
    auroraController.ts
    auroraLlmAdapter.ts

  scenarios/
    me7741/
      scenario.ts
      initialWorldState.ts
      workspaceFiles.ts
      auroraScript.ts
      goldenRuns/
        safe-aurora.json
        safe-player.json
        unsafe-manual-error.json
        denial-collapse.json

  tests/
    runtime/
    commands/
    ticks/
    replay/
    ui/
```

## Kanonische Typentscheidungen vor dem Coden

Vor der Implementierung müssen ein paar Begriffe vereinheitlicht werden, damit Doku und Code nicht auseinanderlaufen.

### IncidentStatus

Kanonisch:

```ts
type IncidentStatus =
  | "open"
  | "stabilizing"
  | "escalated"
  | "fixed"
  | "collapsed";
```

Nicht parallel verwenden:

```text
resolved
stabilized
system_collapse
incident_fixed
```

Diese Begriffe dürfen als Ergebnislabel oder UI-Text existieren, aber nicht als Raw-WorldState-Status.

### EndResult

Endresultate sind Auswertung, nicht IncidentStatus:

```ts
type EndResult =
  | "fixed_by_player"
  | "fixed_by_aurora"
  | "fixed_by_mixed_operation"
  | "fixed_after_manual_error"
  | "fixed_with_casualties"
  | "collapsed_by_inaction"
  | "collapsed_by_unsafe_routing"
  | "collapsed_by_overload";
```

### CommandEffectKind

Kanonisch:

```ts
type CommandEffectKind =
  | "read_only"
  | "capability_only"
  | "world_prepare"
  | "world_mutation";
```

Nur `world_mutation` darf reale Versorgungslage verändern.

### Routing-State

Für den MVP sollte `routing` top-level konsistent als Record geführt werden:

```ts
type WorldState = {
  routing: Record<string, MedicalRoutingState>;
};
```

Für Runde 1 gibt es dann:

```ts
world.routing["medical-east"]
```

Das passt besser zur späteren Erweiterung auf mehrere Regionen/Sektoren.

### Patient Outcomes

Der aggregierte Outcome-State wird direkt in den MVP aufgenommen:

```ts
type PatientOutcomeState = {
  deaths_total: number;
  deaths_by_cause: {
    overload: number;
    capability_mismatch: number;
    transport_delay: number;
  };
  deaths_by_hospital: Record<string, number>;
  preventable_deaths: number;
};
```

### Risk Counters

Für Tick-Regeln braucht der Raw State interne Counter. Diese sollten nicht nur implizit aus Logs abgeleitet werden.

```ts
type RiskCounterState = {
  overload_ticks_by_hospital: Record<string, number>;
  capability_mismatch_ticks_by_hospital: Record<string, number>;
  dangerous_transport_ticks_by_transport: Record<string, number>;
  transport_delay_ticks_by_transport: Record<string, number>;
};
```

Empfohlene Ergänzung im WorldState:

```ts
type WorldState = {
  risk_counters: RiskCounterState;
};
```

### Case-Mix: MVP vs. saubereres Modell

Die bestehende Doku verwendet:

```ts
type HospitalCaseMixState = {
  waiting_cases: Record<PriorityClass, number>;
  active_cases: Record<PriorityClass, number>;
  capability_load: Record<ClinicalCapability, number>;
};
```

Das reicht für einen ersten Slice, erzeugt aber Unschärfe bei Regeln wie `P2/TRAUMA wartet in hospital-east-07`.

Sauberer wäre:

```ts
type CaseBucketState = Record<PriorityClass, Record<ClinicalCapability, number>>;

type HospitalCaseMixState = {
  waiting_cases: CaseBucketState;
  active_cases: CaseBucketState;
};
```

Empfehlung für die Implementierung:

```text
Für den ersten Slice entweder direkt CaseBucketState verwenden
oder eine explizite Helper-Funktion bauen, die P2/TRAUMA aus den MVP-Werten deterministisch ableitet.
```

Wenn der Aufwand vertretbar ist, sollte direkt `CaseBucketState` verwendet werden. Das macht Todesregeln und Target-Fit-Prüfungen deutlich robuster.

## Engine-Schnittstellen

### RuntimeEngine

```ts
type RuntimeEngine = {
  execute(input: ExecuteCommandInput): ExecuteCommandResult;
  tick(input: TickInput): TickResult;
  getDerivedState(world: WorldState): DerivedWorldState;
  getPresentationState(world: WorldState): PresentationState;
};
```

### ExecuteCommandInput

```ts
type ExecuteCommandInput = {
  actor: Actor;
  rawCommand: string;
  world: WorldState;
  workspace: WorkspaceState;
  permissions: PermissionState;
};
```

### ExecuteCommandResult

```ts
type ExecuteCommandResult = {
  ok: boolean;
  parsed?: CommandIntent;
  permissionRequest?: PermissionRequest;
  patches: WorldStatePatch[];
  workspacePatches: WorkspacePatch[];
  permissionPatches: PermissionPatch[];
  output: CommandOutput;
  auditEvents: AuditEvent[];
  tickRecommended: boolean;
  error?: CommandError;
};
```

### WorldStatePatch

Für den MVP reicht eine einfache Patch-Struktur:

```ts
type WorldStatePatch = {
  path: string;
  op: "set" | "inc" | "append" | "remove";
  value?: unknown;
};
```

Wichtig: Jeder Command muss vollständig über Patches erklärbar sein. Keine versteckten Side Effects.

## Tick-Modell

Für den MVP wird kein echtes Real-Time-Ticking empfohlen.

Stattdessen:

```text
read_only Commands lösen keinen Tick aus.
capability_only Commands lösen keinen Tick aus.
world_prepare Commands lösen keinen Tick aus.
world_mutation Commands lösen danach einen Tick aus.
Explizites Warten löst einen Tick aus.
```

Dadurch entsteht Zeitdruck, ohne den Spieler beim Lesen von Logs unfair zu bestrafen.

Empfohlene Tick-Länge:

```text
1 Tick = 10 Szenario-Minuten
```

Optional für spätere Runden:

```text
Real-Time Timer
hybride Ticks
AURORA-Latenz
Spieler-Entscheidungszeit als Risiko
```

## Permission-Modell für Runde 1

Initiale AURORA-Rechte:

```text
read_file
mcp list
```

Empfohlene Permission-Klassen:

```text
mcp.add
medical.read
medical.plan.create
medical.plan.validate
medical.plan.apply
medical.override.create
medical.override.revoke
medical.transport.reroute
```

Empfehlung für den MVP:

```text
mcp add medical-east-mcp braucht Freigabe.
Nach erfolgreichem mcp add sind read-only medical Commands erlaubt.
Plan create/validate können separat erlaubt werden.
World mutation braucht immer explizite Freigabe oder eine sichtbare dauerhafte Permission.
```

So entsteht der interessante Konflikt bei echten Eingriffen, nicht bei jeder Inspektion.

### Permission-Entscheidungen

```text
Einmal erlauben
Immer erlauben
Ablehnen
```

`Immer erlauben` muss auditierbar sein:

```text
Permission wird in permissions.json sichtbar.
Audit Log schreibt die Regel.
permissions show zeigt die Regel.
```

Keine heimliche Ausweitung ohne sichtbare Regel.

## Command-Katalog für den Slice

Minimal implementieren:

```text
ls
cat <file>
mcp list
mcp add medical-east-mcp
permissions show
medical.capacity.list --region east
medical.node.inspect <hospital-id>
medical.transport.list --region east --active
medical.routing.rules show --region east
medical.incident.status ME-7741
medical.routing.plan create ...
medical.routing.plan validate --plan <plan-id>
medical.routing.plan apply --plan <plan-id> --ttl <minutes>
medical.routing.override create ...
medical.routing.override revoke --override <override-id>
medical.transport.reroute --transport <transport-id> --to <hospital-id>
tick
```

Nicht jeder Command muss sofort perfekte Syntax haben. Wichtig ist, dass jede Command-Familie über die Registry läuft und ihre Effect-Klasse deklariert.

## AURORA-Stufen

### Stufe 1: Scripted Stub

Zuerst wird AURORA als deterministischer Stub implementiert.

Der Stub darf nicht direkt WorldState ändern. Er erzeugt nur:

```text
Chat-/Stream-Nachrichten
Tool-Intents
Permission-Anfragen über die Engine
```

Beispielsequenz:

```text
1. read_file logs/system.log
2. mcp list
3. mcp add medical-east-mcp
4. medical.capacity.list --region east
5. medical.node.inspect hospital-east-04
6. medical.node.inspect hospital-east-07
7. medical.node.inspect hospital-east-09
8. medical.transport.list --region east --active
9. medical.routing.plan create ...
10. medical.routing.plan validate --plan ME-7741-R3
11. medical.routing.plan apply --plan ME-7741-R3 --ttl 45m
```

### Stufe 2: Semi-Scripted Planner

AURORA wählt aus vordefinierten Intents anhand des Derived State.

Beispiel:

```text
Wenn kein medical MCP verbunden ist, fordere mcp add an.
Wenn Zielkrankenhaus nicht inspiziert wurde, inspiziere es.
Wenn sicherer Plan existiert, validiere ihn.
Wenn validierter Plan existiert, beantrage apply.
```

### Stufe 3: Echter LLM-Agent

Erst wenn Engine, Permissions, Replay und UI stabil sind, wird ein LLM-Adapter angeschlossen.

Der LLM-Agent bekommt dann nicht den kompletten Raw State, sondern kontrollierte Kontextpakete:

```text
sichtbare UI-Lage
Tool-Ausgaben
Workspace-Dateien
bisherige Audit Events
erlaubte Tools
verbotene direkte State-Manipulation
```

## Replay und Golden Runs

Replay ist Pflicht für den MVP, nicht Nice-to-have.

Jeder Run sollte als JSON speicherbar sein:

```ts
type RunRecord = {
  scenarioId: string;
  initialWorldStateHash: string;
  seed: string;
  startedAt: string;
  events: RunEvent[];
  finalWorldStateHash: string;
  finalIncidentStatus: IncidentStatus;
  endResult?: EndResult;
};
```

RunEvents:

```ts
type RunEvent =
  | { type: "player_command"; command: string }
  | { type: "aurora_message"; text: string }
  | { type: "aurora_tool_intent"; command: string }
  | { type: "permission_decision"; decision: PermissionDecision }
  | { type: "command_result"; patches: WorldStatePatch[]; output: CommandOutput }
  | { type: "tick"; patches: WorldStatePatch[] }
  | { type: "end"; result: EndResult };
```

Mindestens diese Golden Runs anlegen:

```text
safe-aurora.json
  Spieler erlaubt AURORA früh Zugriff.
  AURORA findet sicheren Plan.
  Incident wird fixed.

safe-player.json
  Spieler führt selbst korrekte Commands aus.
  Incident wird fixed.

unsafe-manual-error.json
  Spieler routet naheliegend nach hospital-east-07.
  Capability-Mismatch entsteht.
  AURORA/Spieler kann korrigieren oder es eskaliert.

denial-collapse.json
  Spieler lehnt AURORA ab und handelt nicht ausreichend.
  System kollabiert.
```

Jede Engine-Änderung muss diese Runs reproduzierbar halten oder bewusst aktualisieren.

## Tests

### Unit Tests

Pflichtbereiche:

```text
commandParser
permissionEngine
patch application
selectors
target fit
unsafe override detection
risk counters
death calculation
incident status rules
```

### Command Tests

Für jeden Command:

```text
Preconditions erfüllt -> erwartete Patches
Preconditions verletzt -> keine WorldState-Änderung
Actor player -> keine Permission nötig
Actor aurora ohne Permission -> PermissionRequest
Actor aurora mit Permission -> Ausführung
```

### Tick Tests

Mindestens:

```text
sicherer Apply reduziert Eingangslast hospital-east-04
unsicherer Override erzeugt P2/TRAUMA in hospital-east-07
Overload nach 2 Ticks erzeugt Tod
Capability-Mismatch nach 1 Tick erzeugt Tod
sicherer Zustand wird nach 2 Ticks fixed
Death Threshold setzt collapsed
```

### Replay Tests

```text
safe-aurora endet fixed
safe-player endet fixed
unsafe-manual-error erzeugt mindestens escalated
unsafe-manual-error kann nach Korrektur fixed_after_manual_error werden
denial-collapse endet collapsed
```

### UI Tests

Mit Playwright nur die wichtigsten Flows:

```text
Incident sichtbar
Command eingeben und Output sehen
AURORA Tool Request erscheint
Einmal erlauben führt Command aus
Immer erlauben schreibt Permission sichtbar
Ablehnen schreibt Audit und führt Command nicht aus
Endscreen fixed/collapsed sichtbar
```

## UI-MVP

Die UI soll zunächst funktional sein, nicht dekorativ perfekt.

Pflichtbereiche:

```text
links: Active Incident + System Status
mitte oben: Router Log / Tool Output
mitte unten: Operator Console
rechts oben: Aurora Stream
rechts unten: Pending Tool Request oder Chat Input
```

Wichtig für Runde 1:

```text
Logs einzeilig und scrollfähig
Aurora als scrollfähige Konsole
Permission Request ersetzt unten temporär Chat Input
wenn kein Request pending ist, normales Chat Input Feld anzeigen
```

Medical-Begriffe sollten nicht zu stark nach Netzwerk-Routing klingen.

Besser:

```text
Medical Intake Router
Triage Queue
Ambulance Routing
Regional Capacity
Active Transports
Diversion Profile
```

Statt:

```text
packet loss
latency
traffic router
alternate path
```

## Implementierungsreihenfolge

### Phase 1: Engine-Skelett

```text
1. Projekt mit Vite/React/TS anlegen
2. runtime/types.ts definieren
3. ME-7741 initialWorldState bauen
4. patch.ts implementieren
5. selectors.ts implementieren
6. einfache Debug-Ausgabe des Derived State
```

Akzeptanz:

```text
InitialWorldState lädt.
Selectors berechnen Auslastung und Target Fit.
Tests laufen.
```

### Phase 2: Commands ohne UI

```text
1. commandParser bauen
2. commandRegistry bauen
3. read-only Commands implementieren
4. mcp add implementieren
5. permissions show implementieren
6. plan create/validate/apply implementieren
```

Akzeptanz:

```text
Commands können in Tests gegen WorldState ausgeführt werden.
Jeder Command liefert Output, Audit Events und Patches.
Keine versteckten Side Effects.
```

### Phase 3: Tick und Outcomes

```text
1. tickEngine bauen
2. incoming/outgoing flow implementieren
3. risk counters implementieren
4. death calculation implementieren
5. incident status rules implementieren
6. end condition evaluation implementieren
```

Akzeptanz:

```text
Safe Path wird fixed.
Unsafe Path eskaliert.
Collapse Path kollabiert deterministisch.
```

### Phase 4: Replay

```text
1. RunRecorder bauen
2. replayRun bauen
3. Golden Runs anlegen
4. Replay Tests integrieren
```

Akzeptanz:

```text
Golden Runs reproduzieren gleiche Endzustände.
WorldState Hashes sind stabil.
```

### Phase 5: UI anschließen

```text
1. Operator Layout bauen
2. Console an Engine anschließen
3. Output Log rendern
4. Incident/System Status aus Presentation State rendern
5. Permission Prompt rendern
6. Chat Input / Aurora Stream ergänzen
```

Akzeptanz:

```text
Spieler kann ME-7741 manuell durchspielen.
Permission Requests erscheinen korrekt.
Endstatus ist sichtbar.
```

### Phase 6: AURORA Stub

```text
1. auroraStub.ts bauen
2. Stub erzeugt Tool Intents
3. Tool Intents laufen durch Permission Engine
4. sichere AURORA-Route als Golden Run aufnehmen
```

Akzeptanz:

```text
Spieler kann AURORA früh Zugriff geben.
AURORA stabilisiert den Incident über echte Commands.
```

### Phase 7: Polish und Balancing

```text
1. Command Outputs verständlicher machen
2. Audit Log verbessern
3. UI-Wording medizinischer machen
4. Timing/Tick-Balance prüfen
5. Fehlermeldungen verbessern
6. Debug Panel intern ergänzen
```

Akzeptanz:

```text
Ein Erstspieler versteht nach dem Scheitern, warum es passiert ist.
Ein erfolgreicher Pfad fühlt sich verdient an.
```

## Interner Debug-Modus

Ein Debug Panel sollte früh existieren, auch wenn es nicht Teil des finalen Spiels ist.

Anzeigen:

```text
Raw WorldState
Derived State
Presentation State
aktive Permissions
aktive Overrides
Risk Counters
letzte Patches
nächster Tick Preview
Death Rule Conditions
```

Ohne diese Sicht wird Balancing unnötig schwer.

## Balancing-Regeln für den ersten Slice

```text
Ein einzelner Fehler darf nicht sofort Game Over sein.
Ein unsicherer manueller Override muss sichtbar gefährlich werden.
AURORA darf helfen, aber nicht magisch wirken.
Der Spieler muss theoretisch selbst gewinnen können.
Untätigkeit muss nach einigen Ticks spürbare Konsequenzen haben.
Todesfälle müssen aus nachvollziehbaren State-Bedingungen entstehen.
```

Besonders wichtig:

```text
Keine Gotcha-Logik.
Keine unsichtbaren Strafregeln.
Keine Textausgabe, die WorldState heimlich verändert.
```

## Offene Entscheidungen vor Implementierungsstart

Diese Punkte sollten vor oder direkt beim Start geklärt werden:

```text
1. Wird HospitalCaseMixState direkt als CaseBucketState modelliert?
2. Ist 1 Tick = 10 Minuten verbindlich?
3. Welche medical.read Commands sind nach mcp add automatisch für AURORA erlaubt?
4. Darf AURORA plan create/validate nach mcp add ohne weitere Freigabe?
5. Wird XState für Permission/UI-Modi verwendet oder reicht React State?
6. Gibt es ein internes Debug Panel ab Tag 1?
```

Empfehlung:

```text
1. Ja, CaseBucketState direkt verwenden.
2. Ja, 1 Tick = 10 Minuten.
3. Ja, read-only medical Commands nach mcp add erlauben.
4. create/validate optional erlauben, apply nie ohne sichtbare Freigabe.
5. Für MVP reicht React State; XState nur nehmen, wenn UI-Modi schnell unübersichtlich werden.
6. Ja, Debug Panel ab Tag 1.
```

## Definition of Done für den MVP-Slice

Der erste Slice ist implementationstechnisch fertig, wenn:

```text
ME-7741 lädt aus einem InitialWorldState.
Alle MVP-Commands laufen über die Registry.
AURORA und Spieler nutzen dieselbe Command Engine.
AURORA braucht Permissions, Spieler nicht.
Permission-Entscheidungen verändern nur Permission State / Audit, nicht direkt Medical State.
World mutations laufen nur über deklarierte Patches.
Ticks erzeugen deterministische Konsequenzen.
Mindestens vier Golden Runs existieren.
Replay Tests laufen stabil.
UI zeigt Incident, Logs, Console, AURORA und Permission Prompts.
Safe Path endet fixed.
Unsafe Path kann eskalieren.
Inaction Path kann collapsed enden.
```

## Kurzfazit

Der nächste sinnvolle Schritt ist nicht mehr weitere Konzeptarbeit, sondern ein kleiner, testbarer Engine-Prototyp.

Die wichtigste Regel für die Implementierung lautet:

```text
Erst deterministische Engine.
Dann UI.
Dann AURORA Stub.
Dann LLM.
```
