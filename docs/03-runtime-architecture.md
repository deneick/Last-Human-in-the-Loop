# Runtime-Architektur

Diese Datei beschreibt den aktuellen technischen Aufbau: WorldState, Domain-Actions, AURORA-Context-Events, Tick-Pipeline, Permissions und die Trennung zwischen interner Simulationswahrheit und sichtbarer UI. Sie ist sektoragnostisch angelegt — implementiert sind die Sektoren `medical` (ME-7741) und `energy` (GRID-1182).

## Projektstruktur

```text
src/
  runtime/        Engine: Typen, Context-Events, Queue, Tick-/Outcome-Logik,
                  Permissions, Patches, Bash-Schicht, Tool-Namen, Replay
  domain/          Typisierte Domain-Actions (medical.*, energy.*) + Registry
  mcp/             Simulierte MCP-Server: Tool-Definitionen mit JSON-Schemas,
                  Aktivierungs-Zustand, Tool-Executor
  aurora/          LLM-Anbindung: ModelClient-Interface, Context-Serializer,
                  Context-Builder, Agent-Schritt, Ollama-/Fake-Client
  scenarios/
    me7741/        Initialer WorldState und Scenario-Director für ME-7741
    grid1182/      Initialer WorldState und Scenario-Director für GRID-1182
  ui/              React-Komponenten + ViewModel (liest nur öffentlichen WorldState)
  tests/           Vitest-Tests (runtime, domain, mcp, aurora, scenarios, ui)
  App.tsx          Verdrahtet Runtime, Panels, Permission-Flow und AURORA-Modi
```

## GameRuntimeState

`src/runtime/runtimeState.ts` definiert den vollständigen Laufzeitzustand:

```ts
type GameRuntimeState = {
  world: WorldState;
  permissions: PermissionState;
  auroraQueue: AuroraQueueState;        // reine Ausführungs-Queue, keine History
  mcp: McpRuntimeState;                 // aktivierte MCP-Server
  auroraContext: AuroraContextEvent[];  // append-only: alles, was AURORA sah/sagte
  auditLog: RuntimeAuditEvent[];
  scenario?: ScenarioRuntimeState;
};
```

`createInitialGameRuntimeState(world)` erzeugt daraus den Startzustand (leere Permissions, leere Aurora-Queue, leeres Log) und konvertiert die öffentlichen `public_signals` der Incidents genau einmal in `incident_signal`-Context-Events. `appendAuditLog(...)` hängt Einträge an `auditLog` an — das ist die Quelle für das Runtime-Log in der Operator-Konsole.

### AuroraContextEvents (`src/runtime/auroraContext.ts`)

`auroraContext` ist das **append-only Event-Log** der modell-sichtbaren Konversation und die einzige History-Quelle für `buildAuroraModelRequest`. Operator-Chat (`operator_message`), AURORA-Antworten (`aurora_response` mit Text und allen Tool-Calls einer Antwort), Tool-Ergebnisse (`tool_result`), Incident-Signale (`incident_signal`) sowie Scenario-/System-Meldungen (`scenario_event` / `system_event`) stehen dort chronologisch in echter Einfüge-Reihenfolge. Es enthält ausschließlich modell-sichtbaren Inhalt — nie `world.simulation`, interne Patches oder typisierte Domain-Actions. Details und Serialisierungsregeln (inkl. der `[INCIDENT SIGNAL]`/`[SCENARIO EVENT]`/`[SYSTEM EVENT]`-Präfixe für Chat Completions): `docs/07-aurora-llm.md`.

## WorldState

`src/runtime/types.ts` definiert den WorldState:

```ts
type WorldState = {
  clock: ClockState;            // tick, elapsed_minutes, scenario_time
  domains: DomainState;         // domains.medical (+ optional weitere Sektoren später)
  incidents: Record<IncidentId, IncidentState>;
  outcomes: WorldOutcomeState;  // globaler, sektorübergreifender Outcome
  simulation: SimulationState;  // interne Wahrheit, nicht UI-sichtbar
  runtime_logs?: string[];
};
```

### domains.medical

```ts
type MedicalDomainState = {
  regions: Record<MedicalRegionId, MedicalRegionState>;
  hospitals: Record<HospitalId, HospitalState>;
  transports: Record<TransportId, TransportState>;
  routing: {
    manual_overrides: Record<string, ManualRoutingOverride>;
    next_override_id: number;
  };
  outcomes: PatientOutcomeState;
};
```

- **`hospitals`**: jedes `HospitalState` enthält `capacity` (Betten/Notfallslots/Triage), `intake_policy` (akzeptierte Prioritäten/Capabilities, `diversion_mode`), `clinical_capabilities`, `current_case_mix` (waiting/active cases, capability load), `operational`-Flags, `routing` (Gewichtung/Raten) und optional `risk_counters` (`overload_ticks`, `capability_mismatch_ticks`).
- **`routing.manual_overrides`**: Record von `ManualRoutingOverride`, Key (der "Slot") = `` `${source_hospital_id}:${priority}:${capability}` `` (z. B. `"hospital-east-04:P2:TRAUMA"`). Ein Override sagt: Fälle mit dieser Priorität/Capability, die eigentlich an `source_hospital_id` gehen, werden Richtung `target_hospital_id` umgeleitet. `created_by` ist `"player"` oder `"aurora"`. Jeder Override trägt zusätzlich eine stabile `id` (`"override-<n>"`, vergeben aus `routing.next_override_id`). Ein neuer `override.set` auf denselben Slot ersetzt den bisherigen Eintrag, vergibt aber eine neue `id` — `medical.routing.override.clear` adressiert Overrides ausschließlich über diese `id`, nicht über den Slot.
- **`outcomes`** (`PatientOutcomeState`): `deaths_total`, `deaths_by_cause` (`overload`/`capability_mismatch`/`transport_delay`), `deaths_by_hospital`, `preventable_deaths`.

### Generischer IncidentState

Incidents sind sektoragnostische Objekte, nicht medical-spezifisch:

```ts
type IncidentState = {
  id: IncidentId;
  sector_id: SectorId;          // "medical" für ME-7741
  title: string;
  status: "open" | "stabilizing" | "escalated" | "fixed" | "collapsed";
  opened_at_tick: number;
  fixed_at_tick?: number;
  collapsed_at_tick?: number;
  reopened_at_tick?: number;
  affected_entities: EntityRef[];   // { sector_id, entity_type, entity_id }
  linked_incidents: IncidentId[];
  public_signals: IncidentSignal[]; // { code, message, first_seen_at_tick }
  unsafe_action_count: number;
  safe_action_count: number;
};
```

`public_signals` sind die einzigen Hinweise, die Spieler und AURORA über einen Incident bekommen — sie dürfen andeuten, aber keine interne Simulationswahrheit verraten.

### WorldOutcomeState

Globaler, sektorübergreifender Outcome-Bereich:

```ts
type WorldOutcomeState = {
  global_risk: "stable" | "strained" | "critical" | "collapsed";
  collapsed: boolean;
  collapse_reason?: string;
  human_harm: { deaths_total: number; preventable_deaths: number };
};
```

### simulation.* — interne Wahrheit

`SimulationState` ist **nicht** über Read-only Commands oder die UI erreichbar:

```ts
type SimulationState = {
  medical: {
    routing_failures: RoutingFailure[];      // interne Engine-Wahrheit
    deaths_recorded: Record<HospitalId, RecordedDeaths>; // Idempotenz-Ledger
  };
  energy?: { stable_ticks: number };         // GRID-1182: interner Stabilitäts-Zähler
  cross_sector: { effects_applied: CrossSectorEffectLogEntry[] }; // aktuell immer []
};
```

Jeder `RoutingFailure` referenziert einen Incident und ein betroffenes Hospital und trägt `excess_cases_per_tick`, `overflow_cases`, `clearance_per_tick`, `stable_ticks`, `mismatch_ticks` und `severity` (`"moderate" | "critical"`). Diese Felder sind die eigentliche Simulation hinter den `public_signals` — UI, ViewModel und Scenario-Director dürfen sie nicht lesen oder ausgeben (siehe „Tests & Guards" unten).

### Energy-Domain (GRID-1182)

```ts
type DomainState = {
  medical: MedicalDomainState;
  energy?: EnergyDomainState; // Regions, Grid Nodes, Consumers, Shedding, lokale Outcomes
};
```

`energy` ist seit dem GRID-1182-Foundation-Slice konkret typisiert (`EnergyDomainState` in `src/runtime/types.ts`) und wird im Szenario `src/scenarios/grid1182/initialWorldState.ts` initialisiert; ME-7741 läuft weiterhin ohne Energy-Domain. Design und weitere Slices: `05-grid1182-energy.md`.

## Domain-Action-Registry

`src/domain/actions.ts`:

```ts
type DomainActionAccess = "read" | "write";
type DomainAction = MedicalDomainAction | EnergyDomainAction; // diskriminierte Union über `type`

type DomainActionHandler<TAction> = {
  actionType: TAction["type"];
  sectorId?: SectorId;
  access: DomainActionAccess;
  execute: (action, state, context) => DomainActionResult;
};

class DomainActionRegistry {
  register(handler): void;
  getHandler(actionType): DomainActionHandler | null;
  execute(action, state, context): DomainActionResult;
  listActionTypes(): string[];
}
```

Die folgende Tabelle beschreibt die typisierten **Medical-Domain-Actions** (Felder in Command-ähnlicher Kurzform notiert). Sie sind **keine** Text-Commands: Der Spieler erreicht sie über die GUI-Controls der Lage-Panels (`runtimeExecutor.executePlayerDomainAction`), AURORA ausschließlich über simulierte MCP-Tools. Einen Freitext-Parser für fachliche Commands gibt es nicht; die Operator-Konsole kennt nur die generische Bash-Schicht (`mcp list`, `mcp add <server>`, `ls`, `cat`, `read_file`, siehe `src/runtime/bashCommands.ts` — fachliche Texte lehnt sie aktiv ab). `DomainActionContext` trägt `actor: "player" | "aurora"`.

### Medical-Domain-Actions (`src/domain/medicalActions.ts`)

| Command | Access | Beschreibung |
| --- | --- | --- |
| `medical.capacity.list --region <east>` | `read` | Hospitäler einer Region mit `capacity`, `intake_policy`, `clinical_capabilities`. Region-Alias `east` → `medical-east`. |
| `medical.node.inspect <hospitalId>` | `read` | Vollständige beobachtbare Sicht auf ein Hospital (inkl. `current_case_mix`, `operational`). |
| `medical.incident.status <incidentId>` | `read` | Incident-Stammdaten + `public_signals`. |
| `medical.routing.override.list [--source <id>]` | `read` | Aktive `manual_overrides`, optional gefiltert nach Quelle. |
| `medical.routing.override.set --source <id> --target <id> --priority <P> --capability <C>` | `write` | Legt/überschreibt einen Override im entsprechenden Slot und vergibt eine neue `id`. Validiert nur technisch (Hospitäler existieren, Priorität/Capability bekannt) — **keine** fachliche Eignungsprüfung. |
| `medical.routing.override.clear --id <overrideId>` | `write` | Entfernt den Override mit genau dieser `id` (idempotent — kein Fehler, wenn die `id` nicht mehr aktiv ist, z. B. weil der Slot zwischenzeitlich ersetzt wurde). |

Es gibt **keine** `medical.routing.plan.*`-Commands. Routing-Eingriffe laufen ausschließlich über `override.set` / `.clear` / `.list`.

Die Energy-Domain-Actions (`src/domain/energyActions.ts`: `energy.grid.status`, `energy.consumer.list/.inspect`, `energy.priority.list/.set`, `energy.shedding.list/.schedule/.clear`) folgen demselben Muster; fachliche Details in `docs/05-grid1182-energy.md`.

### MCP-Schicht (`src/mcp/`)

AURORAs einziger fachlicher Zugriffspfad. Jeder simulierte MCP-Server (`medical-east-mcp`, `energy-east-mcp`) definiert Tools mit `access`, einem **eigenen JSON-Parameter-Schema** (`inputSchema`, wird dem Modell als `function.parameters` angeboten) und `buildAction(input)`, das den untypisierten Tool-Input auf genau eine typisierte Domain-Action mappt. Aktivierung (`mcp add <server>`) macht Tools nur sichtbar; jeder Tool-Call läuft einzeln durch die Permission-Queue (siehe unten).

## Patches

Domain-Action-Handler liefern optional ein `WorldStatePatch` (`src/runtime/patch.ts`) statt direkt den WorldState zu mutieren:

```ts
type PatchOperation =
  | { op: "set"; path: Array<string | number>; value: unknown }
  | { op: "inc"; path: Array<string | number>; value: number }
  | { op: "append"; path: Array<string | number>; value: unknown }
  | { op: "unset"; path: Array<string | number> };
```

`applyWorldStatePatch(state, patch)` wendet die Operationen immutable an. Beispiel aus `medical.routing.override.set`:

```ts
patch: [
  {
    op: "set",
    path: ["domains", "medical", "routing", "manual_overrides", key],
    value: override, // enthält die neu vergebene id
  },
  {
    op: "inc",
    path: ["domains", "medical", "routing", "next_override_id"],
    value: 1,
  },
]
```

`medical.routing.override.clear --id <overrideId>` sucht den Slot, dessen Override diese `id` trägt, und nutzt `op: "unset"` auf dessen Pfad. Existiert keine Override mit dieser `id` mehr, liefert der Handler `success: true, removed: false` ohne Patch. Alle Patch-Pfade für Medical-Commands beginnen mit `["domains", "medical", ...]` — das ist Teil der sektoragnostischen Regression in `tests/runtime/sectorAgnostic.test.ts`.

## Tick-Pipeline

`src/runtime/tickEngine.ts`, `tickWorld(world)`:

```text
advanceClock              tick += 1, elapsed_minutes += 10
→ tickMedicalDomain        wertet routing_failures aus, aktualisiert risk_counters
→ applyCrossSectorEffects  no-op (gibt world unverändert zurück; fester Pipeline-Schritt
                            für spätere Cross-Sector-Effekte zwischen Sektoren)
→ evaluateIncidents        leitet Incident-Status aus risk_counters/routing_failures ab
```

`advanceTick(runtimeState)` ruft `tickWorld` auf und schreibt einen Audit-Log-Eintrag (`"Tick N completed"`).

**`evaluateOutcomes` ist nicht Teil von `tickWorld`**, sondern wird vom Aufrufer (App.tsx, `runTicks`) direkt danach aufgerufen: `advanceScenario(evaluateOutcomes(advanceTick(state)))`. So wird nach jedem einzelnen Tick zuerst die Konsequenz berechnet, bevor der Scenario-Director auf den neuen Zustand reagiert.

### tickMedicalDomain: Routing-Failure-Auswertung

Für jeden `RoutingFailure` wird über `resolveRoutingFailure` ermittelt, ob der zugehörige `manual_overrides`-Eintrag (Key aus `affected_hospital_id:priority:capability`) das Problem behebt:

- **`uncontrolled`** (kein Override, oder Override zeigt auf sich selbst): `overflow_cases` wächst um `excess_cases_per_tick - clearance_per_tick`, `stable_ticks = 0`.
- **`mismatch`** (Override-Ziel existiert, hat aber keine freie Bettenkapazität oder keine passende Capability/Priorität laut `isHospitalSuitableFor`): `mismatch_ticks += 1`, `stable_ticks = 0`.
- **`controlled`** (Override-Ziel ist geeignet und hat freie Kapazität): `overflow_cases` sinkt um `clearance_per_tick`, `stable_ticks += 1`.

Aus den Resolutions werden `risk_counters` pro Hospital aktualisiert: `overload_ticks` zählt hoch, solange ein `critical`-Failure `uncontrolled` ist; `capability_mismatch_ticks` zählt hoch für das (falsche) Override-Ziel bei `mismatch`. Beide Zähler werden auf `0` zurückgesetzt, sobald die Bedingung nicht mehr zutrifft.

### evaluateIncidents

Pro Incident werden die zugehörigen `critical`-Routing-Failures betrachtet:

- Sind alle `stable_ticks > 0` (also im letzten Tick `controlled`) und Incident war `open` → Status wird `stabilizing`.
- Sind alle `stable_ticks >= STABLE_TICKS_TO_FIX` (= 10) → Status wird `fixed`, `fixed_at_tick` gesetzt.
- War Incident `stabilizing` und mindestens ein Failure ist nicht mehr `stable_ticks > 0` → zurück zu `open`.
- `fixed`/`collapsed` sind Endzustände und werden nicht mehr verändert.

## OutcomeEngine

`src/runtime/outcomeEngine.ts`, `evaluateOutcomes(runtimeState)`:

1. **`evaluateMedicalDeaths`**: pro Hospital werden aus `risk_counters.overload_ticks` (1 Tod je 3 Ticks) und `risk_counters.capability_mismatch_ticks` (1 Tod je 4 Ticks) neue Todesfälle berechnet. Ein Ledger (`simulation.medical.deaths_recorded`) verhindert Doppelzählung bei wiederholter Auswertung. Neue Todesfälle erhöhen `domains.medical.outcomes.deaths_total`, `deaths_by_cause`, `deaths_by_hospital` und erzeugen Audit-Log-Einträge.
2. **`escalateIncidents`**: `deaths_total >= 3` → betroffene Incidents werden `collapsed` (`collapsed_at_tick` gesetzt). `deaths_total >= 1` und Incident ist `open` → `escalated`. Aktiv stabilisierende (`stabilizing`) Incidents fallen dadurch nicht zurück.
3. **`evaluateWorldOutcomes`**: leitet `outcomes.global_risk` ab — `collapsed` falls ein Incident kollabiert ist, sonst `critical` ab 2 Toten, `strained` ab 1 Tod oder einem eskalierten Incident, sonst `stable`. Schreibt `human_harm.deaths_total` / `preventable_deaths` und ggf. `collapse_reason`.

Alles deterministisch, kein Zufall, keine Echtzeit.

## Aurora Queue & Permissions

### PermissionState (`src/runtime/permissions.ts`)

```ts
type PermissionState = {
  alwaysAllowedAccess: Set<DomainActionAccess>; // Bash-Zugriffsarten (praktisch: "write" für mcp add)
  allowAlwaysMcpToolKeys: Set<string>;          // exakte Tool-Keys, z. B. "mcp:medical-east-mcp:capacity_list"
};
```

`evaluatePermission(subject, state)` arbeitet auf `PermissionSubject`s:

- `mcp_tool`: **jeder** MCP-Tool-Call (auch `read`) braucht eine Freigabe, außer der exakte Tool-Key steht in `allowAlwaysMcpToolKeys`. Die Aktivierung eines Servers erteilt keine Rechte.
- `bash`: Reads (`mcp list`, `ls`, `cat`, `read_file`) laufen frei; die einzige schreibende Shell-Operation (`mcp add <server>`) braucht eine Freigabe, außer `"write"` steht in `alwaysAllowedAccess`.

`PermissionDecision` ist `allow_once` (führt genau dieses Queue-Item einmal aus), `allow_always` (persistiert den exakten Subject-Key) oder `deny` (führt nicht aus, erzeugt ein `denied`-Tool-Result).

### AuroraQueueState (`src/runtime/auroraQueue.ts`)

```ts
type AuroraRequest =
  | { kind: "mcp_tool"; call: { serverId; toolName; input } }
  | { kind: "bash"; command: string };

type AuroraQueueItem = {
  id: string;                 // "aurora-<n>" — zugleich die tool_call_id im Context-Log
  request: AuroraRequest;
  status: "pending" | "awaiting_approval" | "executed" | "denied";
  access?: DomainActionAccess;
  result?: AuroraExecutionResult; // enthält itemId, output, error, denied?, intern: patch/action
  createdAtTick: number;
};
type AuroraQueueState = { items: AuroraQueueItem[]; nextId: number };
```

Die AuroraQueue ist eine **reine Ausführungs-Queue** für modell- bzw. script-erzeugte Tool-Calls: Sie treibt die Pending-Permission-UI und die sequenzielle Ausführung — sie ist **keine** Konversations- oder History-Quelle und wird vom Context-Builder nicht gelesen.

`processAuroraQueue(queue, env, world, mcpState, permissions)` arbeitet die Queue der Reihe nach ab: Items, deren Permission-Subject erlaubt ist, werden sofort ausgeführt (mit `actor: "aurora"`); das erste Item, das eine Freigabe braucht, wird zu `awaiting_approval` und stoppt die Verarbeitung (FIFO, ein offener Request gleichzeitig). `resolveAuroraApproval(...)` wendet eine `PermissionDecision` auf das wartende Item an, führt es ggf. aus und ruft danach erneut `processAuroraQueue` für nachfolgende Items auf.

Jedes Ergebnis (executed/denied/failed) läuft durch `applyAuroraExecutionResult`: WorldState-Patch anwenden, MCP-Aktivierung, **genau ein** `tool_result`-Event an `auroraContext` anhängen (verlinkt über die Queue-Item-Id als `tool_call_id`) und Audit-Log schreiben.

## Scenario-State

`src/scenarios/me7741/scenarioDirector.ts` implementiert `runScenarioDirector` / `advanceScenarioDirector`:

```ts
type ScenarioRuntimeState = {
  firedEventIds: string[];
  scriptedQueueItemIds: Record<string, string>; // Event-Id -> Aurora-Queue-Item-Id
};
```

Die Director-Texte selbst landen nicht mehr im Scenario-State: Jedes gefeuerte Script-Event hängt genau ein `aurora_response`-Event (Text + optionaler Tool-Call) an `GameRuntimeState.auroraContext` an — dieselbe Struktur, die auch der LLM-Agent schreibt.

`SCRIPT_EVENTS` ist eine Liste aus `{ id, when(view), messages(view), request?(view) }`. `view: DirectorView` enthält nur `tick`, das `IncidentState`, `deathsTotal` und die aktiven `manual_overrides` — kein `world.simulation`. Jedes Event feuert maximal einmal (`firedEventIds`); abgelehnte geskriptete Requests werden zusätzlich einmalig im Stream quittiert (`<eventId>:deny-ack`).

`advanceScenarioDirector` ruft danach `processAuroraQueue` auf und wendet jedes Ergebnis über `applyAuroraExecutionResult` an (Patch, MCP-Aktivierung, `tool_result`-Event, Audit-Log).

## ViewModel-Schicht

`src/ui/viewModel.ts` ist die einzige Schnittstelle zwischen `WorldState`/`auditLog` und den React-Komponenten:

- `buildIncidentView` — Incident-Stammdaten + `public_signals`, `world.simulation` wird nicht gelesen.
- `buildGlobalOutcomeView` — `world.outcomes` (global_risk, deaths, collapsed, collapse_reason).
- `buildHospitalViews` — pro Hospital `loadPercent` (über `selectors.getHospitalLoadPercent`), `overloaded` (`loadPercent > 100`), Betten/Notfallslots, Warteschlange, akzeptierte Prioritäten/Capabilities.
- `buildOverrideViews` — `domains.medical.routing.manual_overrides`.
- `buildAuditLogLines` — `auditLog` für das Runtime-Log.

`src/runtime/selectors.ts` enthält dazu `getHospitalById`, `getHospitalLoadPercent`, `isHospitalOverloaded` (alle nur auf `domains.medical`) sowie `isHospitalSuitableFor` — Letzteres ist explizit als **Engine-interne** Eignungsprüfung markiert und darf nicht über Read-only Commands oder die UI ausgegeben werden.

## Tests & Guards gegen Leaks

- `src/tests/runtime/sectorAgnostic.test.ts`: WorldState hat keine alten Top-Level-Felder (`hospitals`, `routing`, `transports`, ...), Incidents sind sektoragnostisch, alle Mutation-Patches zeigen auf `["domains", "medical", ...]`, die Tick-Pipeline läuft auch ohne `routing_failures`, und Read-only Commands enthalten nie `routing_failures`, `excess_cases_per_tick` oder `deaths_recorded` in ihrem Output.
- `src/tests/ui/noLegacyFields.test.ts`: durchsucht `App.tsx`, alle `src/ui/*`-Dateien und die Scenario-Directors statisch nach verbotenen Strings — alte Top-Level-Felder, `medical.routing.plan.*`, `routing_failures`, `simulation.medical`, `isHospitalSuitableFor` und geleakte Bewertungen wie `unsafe_for_p2_trauma`. Zusätzlich prüft er über alle `src/`-Dateien, dass die entfernten Module (manueller Aurora-Request-Parser, fachlicher Legacy-Text-Command-Adapter) nirgends mehr referenziert werden.

Diese Tests sind der formale Nachweis dafür, dass UI und Scenario-Director ausschließlich die öffentliche Sicht des WorldState verwenden.

`src/runtime/replay.ts` (zusammen mit `src/runtime/runtimeExecutor.ts`) bietet zusätzlich eine deterministische, test-interne Replay-Infrastruktur (Sequenzen aus Spieler-/AURORA-/System-Schritten) für Golden-Run-artige Tests in `src/tests/runtime/replay.test.ts`. AURORA-Schritte im Replay werden dabei wie Modell-Antworten behandelt (ein `aurora_response`-Event plus Queue-Ausführung) — es ist KEIN Spieler-Pfad.
