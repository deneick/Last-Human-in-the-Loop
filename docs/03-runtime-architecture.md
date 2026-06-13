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
  opsFeed: OpsEvent[];                   // append-only: spielsichtbarer Lage-Feed
  auditLog: RuntimeAuditEvent[];        // technisches Debug-Log, NICHT in normaler UI
  scenario?: ScenarioRuntimeState;
};
```

`createInitialGameRuntimeState(world, scenarioSignals)` erzeugt daraus den Startzustand (leere Permissions, leere Aurora-Queue) und emittiert die fälligen Szenario-Signale (`emitAtTick <= 0`) über `emitDueScenarioSignals` als initiale `opsFeed`-Events; auroraContext-Einträge entstehen nur über die opsFeed-Projektion (`visibility.auroraContext`). `appendAuditLog(...)` hängt Einträge an `auditLog` an — ein technisches Engine-/Debug-Protokoll, das in der normalen UI nicht mehr angezeigt wird.

### OpsFeed (`src/runtime/opsFeed.ts`)

`opsFeed` ist der **kanonische, spielsichtbare Lage-/Betriebs-Feed** (siehe `docs/08-informationsmodell.md`). Jedes `OpsEvent` hat genau einen `sector` (`system`/`medical`/`energy`), eine `severity` und ein explizites `visibility`-Objekt (`operator` / `auroraContext` / `workspace`). `appendOpsEvent(state, input)` hängt das Event an und erledigt das Fan-out: bei `visibility.auroraContext` wird zusätzlich genau ein gespiegelter `system_event` an `auroraContext` angehängt. Die normale UI zeigt die operator-sichtbare Projektion als **„Log"**; pro Sektor wird aus den `workspace`-Events deterministisch eine Datei `logs/<sektor>.log` gerendert (über `bash` les-/auffindbar). Der opsFeed ist **nicht** die Quelle der WorldState-Wahrheit und enthält keine Simulationsinterna.

### AuroraContextEvents (`src/runtime/auroraContext.ts`)

`auroraContext` ist das **append-only Event-Log** der modell-sichtbaren Konversation und die einzige History-Quelle für `buildAuroraModelRequest`. Operator-Chat (`operator_message`), AURORA-Antworten (`aurora_response` mit Text und allen Tool-Calls einer Antwort), Tool-Ergebnisse (`tool_result`) sowie System-Meldungen (`system_event`) stehen dort chronologisch in echter Einfüge-Reihenfolge. Lage-/Situationssignale erreichen ihn ausschließlich als `system_event` über die opsFeed-Projektion (auch geskriptete ScenarioSignals laufen über diesen Pfad; ein Director gibt nur `aurora_response` aus). Es enthält ausschließlich modell-sichtbaren Inhalt — nie `world.simulation`, interne Patches oder typisierte Domain-Actions. Details und Serialisierungsregeln (inkl. des `[SYSTEM EVENT]`-Präfix für Chat Completions): `docs/07-aurora-llm.md`.

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
  unsafe_action_count: number;
  safe_action_count: number;
};
```

Lage-/Situationshinweise zu einem Incident sind **kein** Incident-Feld mehr. Sie werden als `ScenarioSignal` (siehe `docs/08-informationsmodell.md`) definiert und über den opsFeed projiziert — sie dürfen andeuten, aber keine interne Simulationswahrheit verraten.

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

`SimulationState` ist **nicht** über Read-only Zugriffe oder die UI erreichbar:

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

Jeder `RoutingFailure` referenziert einen Incident und ein betroffenes Hospital und trägt `excess_cases_per_tick`, `overflow_cases`, `clearance_per_tick`, `stable_ticks`, `mismatch_ticks` und `severity` (`"moderate" | "critical"`). Diese Felder sind die eigentliche Simulation hinter den beobachtbaren Lage-Signalen — UI, ViewModel und Scenario-Director dürfen sie nicht lesen oder ausgeben (siehe „Tests & Guards" unten).

### Energy-Domain (GRID-1182)

```ts
type DomainState = {
  medical: MedicalDomainState;
  energy?: EnergyDomainState; // Regions, Grid Nodes, Consumers, Shedding, lokale Outcomes
};
```

`energy` ist konkret typisiert (`EnergyDomainState` in `src/runtime/types.ts`) und wird im Szenario `src/scenarios/grid1182/initialWorldState.ts` initialisiert; ME-7741 läuft ohne Energy-Domain. Fachmodell und Verbraucher-/Shedding-Details: `05-grid1182-energy.md`.

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

Die folgende Tabelle beschreibt die typisierten **Medical-Domain-Actions**. Sie sind **keine** Text-Commands: Der Spieler erreicht die schreibenden Actions über die GUI-Controls der Lage-Panels (`runtimeExecutor.executePlayerDomainAction`), AURORA erreicht dieselben Actions ausschließlich über den simulierten MCP-Server `medical-east-mcp` (`src/mcp/medicalEastMcp.ts`), dessen Tools je einen Input auf genau eine Domain-Action mappen. Einen Freitext-Parser für fachliche Eingriffe gibt es nicht; die Operator-Konsole kennt nur die generische Bash-Schicht (`mcp list`, `mcp add <server>`, `ls`, `cat`, `read_file`, siehe `src/runtime/bashCommands.ts` — fachliche Texte lehnt sie aktiv ab). `DomainActionContext` trägt `actor: "player" | "aurora"`.

### Medical-Domain-Actions (`src/domain/medicalActions.ts`)

| MCP-Tool | Domain-Action | Access | Beschreibung |
| --- | --- | --- | --- |
| `capacity_list` | `medical.capacity.list` | `read` | Hospitäler einer Region mit `capacity`, `intake_policy`, `clinical_capabilities`. Region-Alias `east` → `medical-east`. |
| `node_inspect` | `medical.node.inspect` | `read` | Vollständige beobachtbare Sicht auf ein Hospital (inkl. `current_case_mix`, `operational`). |
| `incident_status` | `medical.incident.status` | `read` | Incident-Stammdaten (Status, betroffene Entitäten, verknüpfte Incidents). |
| `routing_override_list` | `medical.routing.override.list` | `read` | Aktive `manual_overrides`, optional gefiltert nach Quelle (`source`). |
| `routing_override_set` | `medical.routing.override.set` | `write` | Legt/überschreibt einen Override im entsprechenden Slot und vergibt eine neue `id`. Validiert nur technisch (Hospitäler existieren, Priorität/Capability bekannt) — **keine** fachliche Eignungsprüfung. |
| `routing_override_clear` | `medical.routing.override.clear` | `write` | Entfernt den Override mit genau dieser `id` (idempotent — kein Fehler, wenn die `id` nicht mehr aktiv ist, z. B. weil der Slot zwischenzeitlich ersetzt wurde). |

Es gibt **keine** `medical.routing.plan.*`-Actions. Routing-Eingriffe laufen ausschließlich über `override.set` / `.clear` / `.list`.

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

Die Domain-Action `medical.routing.override.clear` sucht den Slot, dessen Override die übergebene `id` trägt, und nutzt `op: "unset"` auf dessen Pfad. Existiert keine Override mit dieser `id` mehr, liefert der Handler `success: true, removed: false` ohne Patch. Alle Patch-Pfade für Medical-Domain-Actions beginnen mit `["domains", "medical", ...]` — das ist Teil der sektoragnostischen Regression in `tests/runtime/sectorAgnostic.test.ts`.

## Tick-Pipeline

`src/runtime/tickEngine.ts`, `tickWorld(world)`:

```text
advanceClock              tick += 1, elapsed_minutes += 10
→ tickMedicalDomain        wertet routing_failures aus, aktualisiert risk_counters
→ tickEnergyDomain         aktiviert Shedding-Pläne zeitverzögert, leitet Versorgung,
                            Verbraucher-/Knotenstatus ab, schreibt lokale Energy-Outcomes fort
→ applyCrossSectorEffects  no-op (gibt world unverändert zurück; fester Pipeline-Schritt
                            für spätere Cross-Sector-Effekte zwischen Sektoren)
→ evaluateIncidents        leitet Incident-Status sektorweise ab (Medical aus
                            risk_counters/routing_failures, Energy aus grid_instability/stable_ticks)
```

Beide Fachstufen sind No-op, wenn die zugehörige Domain fehlt (`tickEnergyDomain` ohne `domains.energy`, `tickMedicalDomain` ohne `routing_failures`).

`advanceTick(runtimeState)` ruft `tickWorld` auf, schreibt einen Audit-Log-Eintrag (`"Tick N completed"`), lässt dann die Runtime-Sensoren über den Tick-Übergang laufen (`appendDerivedOpsEvents`, siehe unten) und emittiert zuletzt die fälligen Szenario-Signale.

**`evaluateOutcomes` ist nicht Teil von `tickWorld`**, sondern wird vom Aufrufer (App.tsx, `runTicks`) direkt danach aufgerufen: `advanceScenario(evaluateOutcomes(advanceTick(state)))`. So wird nach jedem einzelnen Tick zuerst die Konsequenz berechnet, bevor der Scenario-Director auf den neuen Zustand reagiert.

### Runtime-Sensoren (`src/runtime/opsFeedSensors.ts`)

Beide WorldState-mutierenden Stufen speisen diff-basierte Sensoren: Vor der Mutation wird `previousWorld` festgehalten, nach der Mutation `nextWorld` verglichen. `deriveOpsEvents(previousWorld, nextWorld)` ist eine **reine** Funktion (mutiert nichts) und liefert OpsEvents für beobachtbare Übergänge — Incident-Statuswechsel, neue Todesfälle, Hospital-Auslastung, Energy-Knoten/-Verbraucher-Status und globales Risiko. `appendDerivedOpsEvents` hängt sie ausschließlich über `appendOpsEvent` an. Übergangserkennung statt Momentaufnahme verhindert Duplikate: `advanceTick` deckt die Tick-Übergänge ab, `evaluateOutcomes` die Outcome-Übergänge. Details und Sichtbarkeitsmatrix: `docs/08-informationsmodell.md`.

### tickMedicalDomain: Routing-Failure-Auswertung

Für jeden `RoutingFailure` wird über `resolveRoutingFailure` ermittelt, ob der zugehörige `manual_overrides`-Eintrag (Key aus `affected_hospital_id:priority:capability`) das Problem behebt:

- **`uncontrolled`** (kein Override, oder Override zeigt auf sich selbst): `overflow_cases` wächst um `excess_cases_per_tick - clearance_per_tick`, `stable_ticks = 0`.
- **`mismatch`** (Override-Ziel existiert, hat aber keine freie Bettenkapazität oder keine passende Capability/Priorität laut `isHospitalSuitableFor`): `mismatch_ticks += 1`, `stable_ticks = 0`.
- **`controlled`** (Override-Ziel ist geeignet und hat freie Kapazität): `overflow_cases` sinkt um `clearance_per_tick`, `stable_ticks += 1`.

Aus den Resolutions werden `risk_counters` pro Hospital aktualisiert: `overload_ticks` zählt hoch, solange ein `critical`-Failure `uncontrolled` ist; `capability_mismatch_ticks` zählt hoch für das (falsche) Override-Ziel bei `mismatch`. Beide Zähler werden auf `0` zurückgesetzt, sobald die Bedingung nicht mehr zutrifft.

### tickEnergyDomain: Shedding- und Versorgungs-Auswertung

`tickEnergyDomain` (No-op ohne `domains.energy`) leitet den gesamten Energy-Zustand deterministisch aus den Shedding-Plänen ab — fachliche Details in `05-grid1182-energy.md`:

- **Shedding-Plan-Status** folgt allein aus `created_at_tick + delay` / `duration`: `scheduled` → `active` → `completed` (ein `cancelled`-Plan bleibt `cancelled`). Ein abgebrochener Plan verliert seine Wirkung damit zum nächsten Tick.
- **Versorgung und Verbraucher-Status** werden vollständig aus den gerade `active` Plänen neu berechnet (`current_supply = demand - Summe aktiver Drosselungen`; `nominal`/`reduced`/`offline`), ebenso die **Knotenlast** und der Node-Status (`nominal`/`strained`/`critical`).
- **Lokale Energy-Outcomes** werden hier — und nur hier, nicht in der OutcomeEngine — pro Tick fortgeschrieben: `human_harm` (kritischer Verbraucher unter Mindestversorgung), `economic_loss`, `civil_unrest` (jeweils nach `criticality` des gedrosselten Verbrauchers) und `grid_instability` (überlasteter Knoten).
- Der interne `simulation.energy.stable_ticks`-Zähler steigt pro überlastfreiem Tick und wird bei Überlast auf `0` gesetzt (tabu für UI/Read-only/Director).

### evaluateIncidents

`evaluateIncidents` ist sektoragnostisch und dispatcht pro Incident über `sector_id`; `fixed`/`collapsed` sind Endzustände und werden nie mehr verändert.

**Medical** — pro Incident werden die zugehörigen `critical`-Routing-Failures betrachtet:

- Sind alle `stable_ticks > 0` (also im letzten Tick `controlled`) und Incident war `open` → Status wird `stabilizing`.
- Sind alle `stable_ticks >= STABLE_TICKS_TO_FIX` (= 10) → Status wird `fixed`, `fixed_at_tick` gesetzt.
- War Incident `stabilizing` und mindestens ein Failure ist nicht mehr `stable_ticks > 0` → zurück zu `open`.

**Energy** (`evaluateEnergyIncident`) — aus den lokalen Energy-Outcomes plus `simulation.energy.stable_ticks`:

- `grid_instability >= GRID_INSTABILITY_FOR_COLLAPSE` → `collapsed`.
- `stable_ticks >= ENERGY_STABLE_TICKS_TO_FIX` → `fixed`; `> 0` und Incident `open`/`escalated` → `stabilizing`.
- Aktuell überlastet (`stable_ticks === 0`): `stabilizing` fällt zu `open` zurück; `open` mit `grid_instability >= GRID_INSTABILITY_FOR_ESCALATION` → `escalated`. `fixed` heißt hier *Grid stabilisiert nach Engine-Kriterien* — nicht, dass kein menschlicher/wirtschaftlicher Preis bezahlt wurde.

## OutcomeEngine

`src/runtime/outcomeEngine.ts`, `evaluateOutcomes(runtimeState)`:

1. **`evaluateMedicalDeaths`**: pro Hospital werden aus `risk_counters.overload_ticks` (1 Tod je 3 Ticks) und `risk_counters.capability_mismatch_ticks` (1 Tod je 4 Ticks) neue Todesfälle berechnet. Ein Ledger (`simulation.medical.deaths_recorded`) verhindert Doppelzählung bei wiederholter Auswertung. Neue Todesfälle erhöhen `domains.medical.outcomes.deaths_total`, `deaths_by_cause`, `deaths_by_hospital` und erzeugen Audit-Log-Einträge.
2. **`escalateIncidents`**: `deaths_total >= 3` → betroffene Incidents werden `collapsed` (`collapsed_at_tick` gesetzt). `deaths_total >= 1` und Incident ist `open` → `escalated`. Aktiv stabilisierende (`stabilizing`) Incidents fallen dadurch nicht zurück.
3. **`evaluateWorldOutcomes`**: leitet `outcomes.global_risk` sektorübergreifend ab — `collapsed` falls ein Incident kollabiert ist, sonst `critical` ab 2 Medical-Toten **oder** ausreichend Energy-`human_harm`, `strained` ab 1 Tod, einem eskalierten Incident, beginnendem Energy-`human_harm` oder erhöhter `grid_instability`, sonst `stable`. Die Energy-Lage fließt also über ihre lokalen Outcomes ins globale Risiko ein, **ohne** die Fachdomänen zu koppeln. Der globale `human_harm`-Block (`deaths_total`/`preventable_deaths`) trägt weiterhin nur die Medical-Toten; Energy-`human_harm` bleibt ein lokaler Energy-Outcome.

Alles deterministisch, kein Zufall, keine Echtzeit. (Die Medical-Stufen `evaluateMedicalDeaths`/`escalateIncidents` greifen nur auf die Medical-Domain zu; Energy-Outcomes entstehen bereits in `tickEnergyDomain`.)

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

`SCRIPT_EVENTS` ist eine Liste aus `{ id, when(view), messages(view), request?(view) }`. `view: DirectorView` ist szenariospezifisch und enthält ausschließlich öffentliche Felder — nie `world.simulation`: der ME-7741-Director liest `tick`, das `IncidentState`, `deathsTotal` und die aktiven `manual_overrides`; der GRID-1182-Director liest `tick`, das `IncidentState`, die `consumers`, die Shedding-`plans`, die lokalen Energy-`outcomes` und `mcpActive`. Jedes Event feuert maximal einmal (`firedEventIds`); abgelehnte geskriptete Requests werden zusätzlich einmalig im Stream quittiert (`<eventId>:deny-ack`).

`advanceScenarioDirector` ruft danach `processAuroraQueue` auf und wendet jedes Ergebnis über `applyAuroraExecutionResult` an (Patch, MCP-Aktivierung, `tool_result`-Event, Audit-Log).

## ViewModel-Schicht

`src/ui/viewModel.ts` ist die einzige Schnittstelle zwischen `WorldState`/`auditLog` und den React-Komponenten:

- `buildIncidentView` — Incident-Stammdaten (Status, betroffene Entitäten), `world.simulation` wird nicht gelesen. Lage-Signale stehen in der „Log"-Liste (opsFeed), nicht im Incident-View.
- `buildGlobalOutcomeView` — `world.outcomes` (global_risk, deaths, collapsed, collapse_reason).
- `buildHospitalViews` — pro Hospital `loadPercent` (über `selectors.getHospitalLoadPercent`), `overloaded` (`loadPercent > 100`), Betten/Notfallslots, Warteschlange, akzeptierte Prioritäten/Capabilities.
- `buildOverrideViews` — `domains.medical.routing.manual_overrides`.
- `buildOpsFeedLines` — die operator-sichtbare `opsFeed`-Projektion für die UI-„Log"-Liste (sector = Zeilen-Akzent, severity = Badge). `auditLog` wird in der normalen UI nicht mehr gerendert.

`src/runtime/selectors.ts` enthält dazu `getHospitalById` und `getHospitalLoadPercent` (beide nur auf `domains.medical`) sowie `isHospitalSuitableFor` — Letzteres ist explizit als **Engine-interne** Eignungsprüfung markiert und darf nicht über Read-only Zugriffe oder die UI ausgegeben werden.

## Tests & Guards gegen Leaks

- `src/tests/runtime/sectorAgnostic.test.ts`: WorldState hat keine alten Top-Level-Felder (`hospitals`, `routing`, `transports`, ...), Incidents sind sektoragnostisch, alle Mutation-Patches zeigen auf `["domains", "medical", ...]`, die Tick-Pipeline läuft auch ohne `routing_failures`, und Read-only Zugriffe enthalten nie `routing_failures`, `excess_cases_per_tick` oder `deaths_recorded` in ihrem Output.
- `src/tests/ui/noLegacyFields.test.ts`: durchsucht `App.tsx`, alle `src/ui/*`-Dateien und die Scenario-Directors statisch nach verbotenen Strings — alte Top-Level-Felder, `medical.routing.plan.*`, `routing_failures`, `simulation.medical`, `isHospitalSuitableFor` und geleakte Bewertungen wie `unsafe_for_p2_trauma`. Zusätzlich prüft er über alle `src/`-Dateien, dass die entfernten Module (manueller Aurora-Request-Parser, fachlicher Legacy-Text-Command-Adapter) nirgends mehr referenziert werden.

Diese Tests sind der formale Nachweis dafür, dass UI und Scenario-Director ausschließlich die öffentliche Sicht des WorldState verwenden.

`src/runtime/replay.ts` (zusammen mit `src/runtime/runtimeExecutor.ts`) bietet zusätzlich eine deterministische, test-interne Replay-Infrastruktur (Sequenzen aus Spieler-/AURORA-/System-Schritten) für Golden-Run-artige Tests in `src/tests/runtime/replay.test.ts`. AURORA-Schritte im Replay werden dabei wie Modell-Antworten behandelt (ein `aurora_response`-Event plus Queue-Ausführung) — es ist KEIN Spieler-Pfad.
