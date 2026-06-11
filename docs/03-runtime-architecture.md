# Runtime-Architektur

Diese Datei beschreibt den aktuellen technischen Aufbau: WorldState, Command Registry, Tick-Pipeline, Permissions und die Trennung zwischen interner Simulationswahrheit und sichtbarer UI. Sie ist sektoragnostisch angelegt — `medical` ist der erste implementierte Sektor, weitere Sektoren (z. B. `energy`) sind als Erweiterungspunkte vorgesehen, aber noch nicht modelliert.

## Projektstruktur

```text
src/
  runtime/        Engine: Typen, Commands, Tick-/Outcome-Logik, Permissions, Patches
  scenarios/
    me7741/        Initialer WorldState und Scenario-Director für ME-7741
  ui/              React-Komponenten + ViewModel (liest nur öffentlichen WorldState)
  tests/           Vitest-Tests (runtime, scenarios, ui)
  App.tsx          Verdrahtet Registry, RuntimeState, UI-Panels
```

## GameRuntimeState

`src/runtime/runtimeState.ts` definiert den vollständigen Laufzeitzustand:

```ts
type GameRuntimeState = {
  world: WorldState;
  permissions: PermissionState;
  auroraQueue: AuroraQueueState;
  auditLog: RuntimeAuditEvent[];
  scenario?: ScenarioRuntimeState;
};
```

`createInitialGameRuntimeState(world)` erzeugt daraus den Startzustand (leere Permissions, leere Aurora-Queue, leeres Log). `appendAuditLog(...)` hängt Einträge an `auditLog` an — das ist die Quelle für das Runtime-Log in der Operator-Konsole.

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
  routing: { manual_overrides: Record<string, ManualRoutingOverride> };
  outcomes: PatientOutcomeState;
};
```

- **`hospitals`**: jedes `HospitalState` enthält `capacity` (Betten/Notfallslots/Triage), `intake_policy` (akzeptierte Prioritäten/Capabilities, `diversion_mode`), `clinical_capabilities`, `current_case_mix` (waiting/active cases, capability load), `operational`-Flags, `routing` (Gewichtung/Raten) und optional `risk_counters` (`overload_ticks`, `capability_mismatch_ticks`).
- **`routing.manual_overrides`**: Record von `ManualRoutingOverride`, Key = `` `${source_hospital_id}:${priority}:${capability}` `` (z. B. `"hospital-east-04:P2:TRAUMA"`). Ein Override sagt: Fälle mit dieser Priorität/Capability, die eigentlich an `source_hospital_id` gehen, werden Richtung `target_hospital_id` umgeleitet. `created_by` ist `"player"` oder `"aurora"`.
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
  cross_sector: { effects_applied: CrossSectorEffectLogEntry[] }; // aktuell immer []
};
```

Jeder `RoutingFailure` referenziert einen Incident und ein betroffenes Hospital und trägt `excess_cases_per_tick`, `overflow_cases`, `clearance_per_tick`, `stable_ticks`, `mismatch_ticks` und `severity` (`"moderate" | "critical"`). Diese Felder sind die eigentliche Simulation hinter den `public_signals` — UI, ViewModel und Scenario-Director dürfen sie nicht lesen oder ausgeben (siehe „Tests & Guards" unten).

### Vorbereitete Energy-Domain

```ts
type DomainState = {
  medical: MedicalDomainState;
  energy?: EnergyDomainState; // aktuell: type EnergyDomainState = never
};
```

`energy` ist als Erweiterungspunkt vorgesehen, aber noch nicht fachlich modelliert (siehe `05-next-steps.md`).

## Command Registry

`src/runtime/commands.ts`:

```ts
type CommandEffectClass = "read_only" | "capability_only" | "world_prepare" | "world_mutation";

type CommandHandler = {
  commandName: string;
  sectorId?: SectorId;
  effect: CommandEffectClass;
  handle: (request, state, context) => CommandResult;
};

class CommandRegistry {
  register(handler: CommandHandler): this;
  getHandler(commandName: string): CommandHandler | null;
  execute(request, state, context?): CommandResult;
  listCommandNames(): string[];
}
```

`CommandRequest` kommt aus `commandParser.parseCommandText(raw)` (whitespace-getrennt, `--flag value` / `--flag` (boolean) / `-f`). `CommandExecutionContext` trägt `actor: "player" | "aurora"`.

### Aktuell registrierte Medical-Commands (`src/runtime/medicalCommands.ts`)

| Command | Effect | Beschreibung |
| --- | --- | --- |
| `medical.capacity.list --region <east>` | `read_only` | Hospitäler einer Region mit `capacity`, `intake_policy`, `clinical_capabilities`. Region-Alias `east` → `medical-east`. |
| `medical.node.inspect <hospitalId>` | `read_only` | Vollständige beobachtbare Sicht auf ein Hospital (inkl. `current_case_mix`, `operational`). |
| `medical.incident.status <incidentId>` | `read_only` | Incident-Stammdaten + `public_signals`. |
| `medical.routing.override.list [--source <id>]` | `read_only` | Aktive `manual_overrides`, optional gefiltert nach Quelle. |
| `medical.routing.override.set --source <id> --target <id> --priority <P> --capability <C>` | `world_mutation` | Legt/überschreibt einen Override. Validiert nur technisch (Hospitäler existieren, Priorität/Capability bekannt) — **keine** fachliche Eignungsprüfung. |
| `medical.routing.override.clear --source <id> --priority <P> --capability <C>` | `world_mutation` | Entfernt einen Override (idempotent — kein Fehler, wenn keiner existiert). |

Es gibt **keine** `medical.routing.plan.*`-Commands. Routing-Eingriffe laufen ausschließlich über `override.set` / `.clear` / `.list`.

## Patches

Command-Handler liefern optional ein `WorldStatePatch` (`src/runtime/patch.ts`) statt direkt den WorldState zu mutieren:

```ts
type PatchOperation =
  | { op: "set"; path: Array<string | number>; value: unknown }
  | { op: "inc"; path: Array<string | number>; value: number }
  | { op: "append"; path: Array<string | number>; value: unknown }
  | { op: "unset"; path: Array<string | number> };
```

`applyWorldStatePatch(state, patch)` wendet die Operationen immutable an. Beispiel aus `medical.routing.override.set`:

```ts
patch: [{
  op: "set",
  path: ["domains", "medical", "routing", "manual_overrides", key],
  value: override,
}]
```

`medical.routing.override.clear` nutzt `op: "unset"` auf demselben Pfad. Alle Patch-Pfade für Medical-Commands beginnen mit `["domains", "medical", ...]` — das ist Teil der sektoragnostischen Regression in `tests/runtime/sectorAgnostic.test.ts`.

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
type PermissionState = { alwaysAllowedPermissionClasses: Set<CommandEffectClass> };
```

`evaluatePermission(request, state)`:

- `read_only` → immer `allowed`.
- Permission-Klasse in `alwaysAllowedPermissionClasses` → `allowed`.
- sonst Default aus `DEFAULT_PERMISSION_RULES`: `read_only` = allowed, `capability_only`/`world_prepare`/`world_mutation` = `requires_approval`.

`PermissionDecision` ist `allow_once` (führt genau diesen Command einmal aus), `allow_always` (fügt die Permission-Klasse zu `alwaysAllowedPermissionClasses` hinzu) oder `deny`.

### AuroraQueueState (`src/runtime/auroraQueue.ts`)

```ts
type AuroraQueueItem = {
  id: string;                 // "aurora-<n>"
  request: CommandRequest;
  status: "pending" | "awaiting_approval" | "executed" | "denied";
  result?: CommandResult;
  createdAtTick: number;
};
type AuroraQueueState = { items: AuroraQueueItem[]; nextId: number };
```

`processAuroraQueue(queue, registry, world, permissions)` arbeitet die Queue der Reihe nach ab: `read_only`/bereits-erlaubte Items werden sofort über die Registry ausgeführt (mit `actor: "aurora"`); das erste Item, das eine Freigabe braucht, wird zu `awaiting_approval` und stoppt die Verarbeitung (FIFO, ein offener Request gleichzeitig). `resolveAuroraApproval(...)` wendet eine `PermissionDecision` auf das wartende Item an, führt es ggf. aus und ruft danach erneut `processAuroraQueue` für nachfolgende Items auf.

Erfolgreiche Patches werden in `App.tsx` über `executeCommandResultPatch` auf den `GameRuntimeState.world` angewendet und im Audit-Log vermerkt.

## Scenario-State

`src/scenarios/me7741/scenarioDirector.ts` implementiert `runScenarioDirector` / `advanceScenarioDirector`:

```ts
type ScenarioRuntimeState = {
  firedEventIds: string[];
  scriptedQueueItemIds: Record<string, string>; // Event-Id -> Aurora-Queue-Item-Id
  messages: ScenarioAuroraMessage[];             // { id, tick, text }
};
```

`SCRIPT_EVENTS` ist eine Liste aus `{ id, when(view), messages(view), request?(view) }`. `view: DirectorView` enthält nur `tick`, das `IncidentState`, `deathsTotal` und die aktiven `manual_overrides` — kein `world.simulation`. Jedes Event feuert maximal einmal (`firedEventIds`); abgelehnte geskriptete Requests werden zusätzlich einmalig im Stream quittiert (`<eventId>:deny-ack`).

`advanceScenarioDirector` ruft danach `processAuroraQueue` auf und wendet erfolgreiche Patches via `executeCommandResultPatch` an.

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
- `src/tests/ui/noLegacyFields.test.ts`: durchsucht `App.tsx`, alle `src/ui/*`-Dateien und `scenarioDirector.ts` statisch nach verbotenen Strings — alte Top-Level-Felder, `medical.routing.plan.*`, `routing_failures`, `simulation.medical`, `isHospitalSuitableFor` und geleakte Bewertungen wie `unsafe_for_p2_trauma`.

Diese Tests sind der formale Nachweis dafür, dass UI und Scenario-Director ausschließlich die öffentliche Sicht des WorldState verwenden.

`src/runtime/replay.ts` und `src/runtime/playerExecution.ts` bieten zusätzlich eine deterministische Replay-Infrastruktur (Sequenzen aus Spieler-/AURORA-/System-Schritten) für Golden-Run-artige Tests in `src/tests/runtime/replay.test.ts`.
