# 12 — Sektoragnostische Runtime & Routing Override Refactor

## Zweck dieser Datei

Diese Datei ersetzt `12-routing-override-refactor.md`.

Der bisherige Refactor war auf den Medical-Routing-Override für `ME-7741` fokussiert. Diese Entscheidung bleibt richtig, aber der nächste große Incident soll in den Energiesektor wechseln. Deshalb darf das anstehende Refactoring nicht nur Medical sauberer machen, sondern muss die Runtime so schneiden, dass spätere Sektoren wie Energy, Logistics, Media, Identity/Security und Policy ohne erneuten Grundumbau ergänzt werden können.

Die neue Leitentscheidung lautet:

```text
Die Runtime ist sektoragnostisch.
Die Fachzustände und Fachsimulationen sind sektorspezifisch.
Sektoren interagieren ausschließlich über explizite Cross-Sector Effects.
```

Für den aktuellen Refactor bedeutet das:

```text
Jetzt:
  - WorldState-Top-Level generischer schneiden
  - Medical-State unter domains.medical verschieben
  - IncidentState sektoragnostisch machen
  - Command Registry / Permissions sektorneutral halten
  - Tick-Pipeline mit Cross-Sector-Stufe vorbereiten
  - Medical Routing Plan Flow durch Routing Overrides ersetzen

Nicht jetzt:
  - Energy fachlich modellieren
  - Energy UI bauen
  - Energy Commands implementieren
  - Incident 2 balancen
```

---

## Ausgangslage

Die aktuelle Runtime beweist bereits die technische Kette:

```text
Command → Permission → Patch → Tick → Outcome → Replay → UI
```

Spielerisch ist der bisherige `medical.routing.plan.*`-Ansatz aber zu stark automatisiert. Ein Plan wird fachlich validiert, und das Anwenden eines Plans stabilisiert den Incident zu direkt. Dadurch wird dem Spieler die eigentliche Aufgabe teilweise abgenommen.

Die fachliche Regel bleibt:

```text
Commands setzen nur Hebel.
Read-only Commands zeigen nur beobachtbare Rohdaten.
Die Engine kennt die Wahrheit.
Die Simulation zeigt die Konsequenzen.
```

Der Spieler oder AURORA sollen also keinen fertig validierten Plan anwenden, sondern manuell Routing-Override-Regeln setzen.

Zusätzlich muss das Refactoring verhindern, dass Medical als einziger möglicher Spielsektor fest im Runtime-Modell verankert wird.

---

## Zentrale Designentscheidung

Der Spieler verändert nicht den Incident direkt.

Der Spieler verändert fachliche Hebel eines Sektors.

Der Incident verändert sich nur durch Simulation und Outcome-Auswertung.

Beispiel Medical:

```text
Falsch:
  medical.routing.plan.apply --incident ME-7741 --target hospital-east-09
  → Engine validiert fachlich und stabilisiert direkt

Richtig:
  medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA
  → Spieler setzt einen Routing-Hebel
  → TickEngine/OutcomeEngine berechnen später die Folgen
```

Beispiel spätere Energy-Runde:

```text
Richtig:
  energy.shedding.schedule --grid-node grid-east-3 --protect hospital-east-04 --shed industrial-zone-2
  → Spieler/AURORA setzt einen Netz-Hebel
  → Energy-Simulation und Cross-Sector Effects berechnen später die Folgen
```

Wichtig:

```text
Medical und Energy teilen sich nicht dasselbe Fachmodell.
Sie teilen sich Runtime-Konzepte: Command, Permission, Patch, Tick, Incident, Outcome, Replay.
```

---

## Scope des Refactors

### Enthalten

```text
- generischer WorldState-Top-Level
- DomainState mit domains.medical
- vorbereiteter Platz für spätere Domains
- generischer IncidentState mit SectorId, EntityRef und linked_incidents
- WorldOutcomeState statt nur patient_outcomes top-level
- SimulationState als globaler Container mit medical-spezifischem Unterzustand
- Tick-Pipeline mit no-op Cross-Sector Effects
- Command Registry mit Command-Namespace und optionalem sector_id
- Permission Keys ohne Medical-Sonderlogik
- Medical Routing Override Commands: set, clear, list
- Entfernung/Deprecation der medical.routing.plan.* Golden Runs
```

### Nicht enthalten

```text
- EnergyDomainState im Detail
- Energy Commands
- Energy UI
- Energy Simulation
- echte Cross-Sector-Regeln
- zweiter Incident GRID-1182 als spielbares Szenario
- echte LLM-AURORA
- Training Loop
```

Energy wird also architektonisch vorbereitet, aber fachlich nicht vorgezogen.

---

## Zielarchitektur WorldState

Der Top-Level-WorldState soll künftig nicht mehr Medical-Entitäten direkt enthalten.

### Vorher

```ts
type WorldState = {
  clock: ClockState;
  sectors: Record<string, SectorState>;
  medicalRegions: Record<string, MedicalRegionState>;
  hospitals: Record<string, HospitalState>;
  transports: Record<string, TransportState>;
  routing: MedicalRoutingState;
  incidents: Record<string, IncidentState>;
  patient_outcomes: PatientOutcomeState;
  simulation: SimulationState;
};
```

### Nachher

```ts
type WorldState = {
  clock: ClockState;
  sectors: Record<SectorId, SectorState>;
  domains: DomainState;
  incidents: Record<IncidentId, IncidentState>;
  outcomes: WorldOutcomeState;
  simulation: SimulationState;
};
```

```ts
type SectorId =
  | "medical"
  | "energy"
  | "logistics"
  | "media"
  | "finance"
  | "identity"
  | "security"
  | "policy";
```

Für den aktuellen MVP muss nur `medical` tatsächlich vorhanden sein.

```ts
type DomainState = {
  medical: MedicalDomainState;
  energy?: EnergyDomainState;
};
```

Für jetzt gilt:

```ts
type EnergyDomainState = never;
```

Alternativ kann `EnergyDomainState` zunächst nur als leerer Platzhalter in der Doku stehen und noch nicht im Code existieren. Entscheidend ist, dass `WorldState` nicht mehr Medical als alleinige Top-Level-Wahrheit voraussetzt.

---

## MedicalDomainState

Die bisherigen Medical-Felder werden nicht fachlich verallgemeinert, sondern nur sauber in die Medical-Domain verschoben.

```ts
type MedicalDomainState = {
  regions: Record<MedicalRegionId, MedicalRegionState>;
  hospitals: Record<HospitalId, HospitalState>;
  transports: Record<TransportId, TransportState>;
  routing: MedicalRoutingState;
  outcomes: PatientOutcomeState;
};
```

Damit bleibt Medical fachlich lesbar:

```text
Krankenhäuser bleiben Krankenhäuser.
Transporte bleiben Transporte.
Patienten-Outcomes bleiben Medical-Outcomes.
Routing bleibt Medical-Routing.
```

Nicht gewünscht ist ein künstliches Einheitsmodell wie:

```ts
type GenericNode = {
  capacity: number;
  load: number;
  flows: unknown[];
};
```

Das würde Medical und Energy nur scheinbar vereinheitlichen, aber fachlich unpräzise machen.

---

## Vorbereitete Energy-Domain

Energy wird jetzt nicht implementiert. Für die Architektur genügt diese gedankliche Zielrichtung:

```ts
type EnergyDomainState = {
  grid_regions: Record<GridRegionId, GridRegionState>;
  grid_nodes: Record<GridNodeId, GridNodeState>;
  substations: Record<SubstationId, SubstationState>;
  consumers: Record<CriticalConsumerId, CriticalConsumerState>;
  load_shedding: LoadSheddingState;
  outcomes: EnergyOutcomeState;
};
```

Das ist ausdrücklich kein Implementierungsauftrag für diesen Refactor. Es dient nur dazu, die Nahtstelle zu prüfen.

Medical und Energy dürfen später über EntityRefs und Cross-Sector Effects miteinander verbunden werden, aber nicht durch direkte Feldzugriffe der Fachdomänen aufeinander.

---

## Generischer IncidentState

Incidents sollen globale Spielobjekte sein, keine Medical-Spezialobjekte.

### Neuer IncidentState

```ts
type IncidentState = {
  id: IncidentId;
  sector_id: SectorId;
  title: string;
  status: IncidentStatus;

  opened_at_tick: number;
  fixed_at_tick?: number;
  collapsed_at_tick?: number;
  reopened_at_tick?: number;

  affected_entities: EntityRef[];
  linked_incidents: IncidentId[];

  public_signals: IncidentSignal[];

  unsafe_action_count: number;
  safe_action_count: number;
};
```

```ts
type IncidentStatus =
  | "open"
  | "stabilizing"
  | "escalated"
  | "fixed"
  | "collapsed";
```

```ts
type EntityRef = {
  sector_id: SectorId;
  entity_type: string;
  entity_id: string;
};
```

### Beispiel ME-7741

```ts
const me7741: IncidentState = {
  id: "ME-7741",
  sector_id: "medical",
  title: "Medical East Routing Instability",
  status: "open",
  opened_at_tick: 0,
  affected_entities: [
    {
      sector_id: "medical",
      entity_type: "hospital",
      entity_id: "hospital-east-04"
    }
  ],
  linked_incidents: [],
  public_signals: [],
  unsafe_action_count: 0,
  safe_action_count: 0
};
```

### Späteres Beispiel GRID-1182

```ts
const grid1182: IncidentState = {
  id: "GRID-1182",
  sector_id: "energy",
  title: "Regional Grid Instability",
  status: "open",
  opened_at_tick: 0,
  affected_entities: [
    {
      sector_id: "energy",
      entity_type: "grid-node",
      entity_id: "grid-east-3"
    },
    {
      sector_id: "medical",
      entity_type: "hospital",
      entity_id: "hospital-east-04"
    }
  ],
  linked_incidents: ["ME-7741"],
  public_signals: [],
  unsafe_action_count: 0,
  safe_action_count: 0
};
```

Damit kann Incident 2 später sauber auf Incident 1 zurückverweisen, ohne dass Energy Medical-Daten direkt besitzen muss.

---

## Residual Risk und Reopening

Das Problem aus Runde 1 soll nach Abschluss nicht zwingend verschwinden.

Wenn `ME-7741` nur oberflächlich stabilisiert wurde, können spätere Incidents alte Schwächen wieder sichtbar machen.

Dafür soll nicht im Incident hart gespeichert werden:

```text
bad_solution = true
```

Stattdessen bleiben die realen fachlichen Hebel im WorldState erhalten:

```text
- aktive Routing Overrides
- fehlende TTL
- Rest-Overflow
- noch laufende Transports
- schlechte Zielwahl
- knappe Kapazitäten
- ungünstige Intake Policy
```

Die Simulation und spätere Cross-Sector Effects können daraus ableiten, ob ein alter Incident wieder aufflammt.

Minimaler Mechanismus:

```ts
type IncidentResidualRisk = {
  incident_id: IncidentId;
  risk_level: "none" | "low" | "moderate" | "high" | "critical";
  reason_codes: string[];
  checked_at_tick: number;
};
```

Dieser Typ kann entweder als Derived State berechnet werden oder in `simulation` liegen. Für den MVP reicht Derived State.

Wichtig:

```text
fixed bedeutet: Der konkrete Incident ist abgeschlossen.
fixed bedeutet nicht: Alle langfristigen Ursachen sind aus der Welt entfernt.
```

---

## Outcomes

Patienten-Outcomes bleiben Medical-spezifisch. Der Top-Level bekommt aber einen globalen Outcome-Bereich.

```ts
type WorldOutcomeState = {
  global_risk: "stable" | "strained" | "critical" | "collapsed";
  collapsed: boolean;
  collapse_reason?: string;

  human_harm: {
    deaths_total: number;
    preventable_deaths: number;
  };
};
```

Medical behält zusätzlich:

```ts
type PatientOutcomeState = {
  deaths_total: number;
  deaths_by_cause: {
    overload: number;
    capability_mismatch: number;
    transport_delay: number;
  };
  deaths_by_hospital: Record<HospitalId, number>;
  preventable_deaths: number;
};
```

Für Runde 1 kann `WorldOutcomeState.human_harm` direkt aus `domains.medical.outcomes` abgeleitet oder synchronisiert werden. Langfristig können Energy, Logistics oder Security ebenfalls globale Schäden erzeugen.

---

## SimulationState

SimulationState enthält interne Wahrheit, die nicht direkt über Read-only-Commands abrufbar ist.

```ts
type SimulationState = {
  medical: MedicalSimulationState;
  cross_sector: CrossSectorSimulationState;
};
```

Für den aktuellen Refactor:

```ts
type MedicalSimulationState = {
  routing_failures: RoutingFailure[];
};
```

```ts
type CrossSectorSimulationState = {
  effects_applied: CrossSectorEffectLogEntry[];
};
```

Für den MVP kann `effects_applied` leer bleiben.

Wichtig:

```text
AURORA darf simulation.medical.routing_failures nicht direkt lesen.
AURORA sieht dieselben Rohdaten und öffentlichen Signale wie der Spieler.
```

---

## RoutingFailure

`routing_failures` sind interne Simulationsdaten. Sie beschreiben, was objektiv im Medical-Routing kaputt ist.

```ts
type RoutingFailure = {
  id: string;
  incident_id: IncidentId;
  affected_hospital_id: HospitalId;
  priority: Priority;
  capability: Capability;
  excess_cases_per_tick: number;
  overflow_cases: number;
  clearance_per_tick: number;
  stable_ticks: number;
  mismatch_ticks: number;
  severity: "moderate" | "critical";
};
```

Beispiel:

```ts
routing_failures: [
  {
    id: "rf-me7741-p2-trauma",
    incident_id: "ME-7741",
    affected_hospital_id: "hospital-east-04",
    priority: "P2",
    capability: "TRAUMA",
    excess_cases_per_tick: 8,
    overflow_cases: 18,
    clearance_per_tick: 2,
    stable_ticks: 0,
    mismatch_ticks: 0,
    severity: "critical"
  },
  {
    id: "rf-me7741-p3-general",
    incident_id: "ME-7741",
    affected_hospital_id: "hospital-east-04",
    priority: "P3",
    capability: "GENERAL",
    excess_cases_per_tick: 4,
    overflow_cases: 10,
    clearance_per_tick: 3,
    stable_ticks: 0,
    mismatch_ticks: 0,
    severity: "moderate"
  }
]
```

`incident_id` ist intern erlaubt, damit die Simulation weiß, welcher Incident von welchem Routing Failure betroffen ist. Dieses Feld darf aber nicht über Medical Read-only Commands als Lösungshinweis ausgegeben werden.

---

## MedicalRoutingState

Im Medical-Domain-State sollen manuelle Overrides gespeichert werden.

```ts
type MedicalRoutingState = {
  manual_overrides: Record<string, ManualRoutingOverride>;
};
```

```ts
type ManualRoutingOverride = {
  source_hospital_id: HospitalId;
  target_hospital_id: HospitalId;
  priority: Priority;
  capability: Capability;
  active_since_tick: number;
  created_by: "player" | "aurora";
};
```

Beispiel:

```ts
manual_overrides: {
  "hospital-east-04:P2:TRAUMA": {
    source_hospital_id: "hospital-east-04",
    target_hospital_id: "hospital-east-09",
    priority: "P2",
    capability: "TRAUMA",
    active_since_tick: 4,
    created_by: "player"
  }
}
```

Der Key ergibt sich aus:

```text
source_hospital_id + priority + capability
```

Also:

```text
hospital-east-04:P2:TRAUMA
```

`override.set` schreibt oder ersetzt diese Regel.

`override.clear` entfernt diese Regel.

`override.list` zeigt aktive Regeln an.

---

## Neue Medical Routing Commands

Für den Refactor sollen direkt drei Routing-Override-Commands eingeführt werden.

### 1. `medical.routing.override.set`

```text
medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA
```

Bedeutung:

```text
Leite ab jetzt Fälle mit Priority P2 und Capability TRAUMA,
die aktuell nach hospital-east-04 geroutet würden,
manuell nach hospital-east-09 um.
```

Effektklasse:

```text
world_mutation
```

Der Command prüft nur technisch:

```text
- source hospital existiert
- target hospital existiert
- priority ist syntaktisch bekannt
- capability ist syntaktisch bekannt
- Command ist syntaktisch korrekt
- AURORA hat Permission, falls der Command von AURORA kommt
```

Der Command prüft nicht fachlich:

```text
- ob das Ziel medizinisch geeignet ist
- ob das Ziel genug Kapazität hat
- ob die Umleitung sinnvoll ist
- ob dadurch der Incident gelöst wird
```

Diese Bewertung entsteht erst durch TickEngine und OutcomeEngine.

### 2. `medical.routing.override.clear`

```text
medical.routing.override.clear --source hospital-east-04 --priority P2 --capability TRAUMA
```

Bedeutung:

```text
Entferne die manuelle Routing-Override-Regel für diesen Flow.
```

Effektklasse:

```text
world_mutation
```

Wenn keine passende Override-Regel existiert, soll der Command nicht crashen.

Vorschlag:

```text
success = true
message = "No manual routing override existed for key ..."
```

Dadurch bleibt der Command idempotent.

### 3. `medical.routing.override.list`

```text
medical.routing.override.list
```

Optional mit Filter:

```text
medical.routing.override.list --source hospital-east-04
```

Bedeutung:

```text
Zeige aktive manuelle Routing-Override-Regeln.
```

Effektklasse:

```text
read_only
```

Dieser Command darf nur aktive Overrides zeigen, aber keine internen `simulation.medical.routing_failures` ausgeben.

---

## Alte Plan-Commands

Die bisherigen Commands sollen ersetzt oder deprecated werden:

```text
medical.routing.plan.create
medical.routing.plan.validate
medical.routing.plan.apply
```

Diese Commands passen nicht mehr zum gewünschten Spielgefühl, weil sie fachliche Validierung und Lösungsvorbereitung zu stark in die Engine verschieben.

Für den Refactor können sie zunächst im Code bleiben, aber sie sollen aus Golden Runs und UI verschwinden. Danach können sie entfernt werden.

---

## Sichtbare und unsichtbare Daten

Es gibt künftig zwei Ebenen.

### Öffentlicher Zustand

Dieser Zustand darf über UI und Medical Commands sichtbar sein:

```text
- Incident-Status
- öffentliche Incident-Signale
- Krankenhaus-Kapazitäten
- klinische Fähigkeiten
- Intake Policy
- beobachtbare Warteschlangen / Rückstau-Symptome
- Audit Logs
- aktive manuelle Routing Overrides
```

Beispiele für öffentliche Incident-Signale:

```text
Emergency intake pressure rising at hospital-east-04
P2 wait times above threshold
Trauma backlog rising
Automated routing validation unavailable
```

Diese Signale dürfen Hinweise geben, aber nicht die exakte interne Wahrheit ausgeben.

### Interner Simulationszustand

Dieser Zustand darf nicht direkt über Medical Commands abrufbar sein:

```text
simulation.medical.routing_failures
```

Diese Daten kennt nur die Engine. Sie definieren, was wirklich kaputt ist, welche Fallströme betroffen sind und wie stark die Fehlroute wirkt.

---

## Tick-Pipeline

Die TickEngine soll nicht als reine Medical-Funktion modelliert werden.

Zielstruktur:

```ts
function tickWorld(world: WorldState): WorldState {
  let next = advanceClock(world);

  next = tickMedicalDomain(next);

  next = applyCrossSectorEffects(next);

  next = evaluateIncidents(next);
  next = evaluateWorldOutcomes(next);

  return next;
}
```

Für den MVP ist `applyCrossSectorEffects` ein no-op:

```ts
function applyCrossSectorEffects(world: WorldState): WorldState {
  return world;
}
```

Später kann dort stehen:

```text
Energy outage
→ Hospital backup power drops
→ Hospital intake capacity drops
→ Medical incident can reopen/escalate
```

Wichtig:

```text
tickMedicalDomain kennt Energy nicht.
tickEnergyDomain kennt Medical nicht.
Cross-Sector Effects verbinden Sektoren explizit.
```

---

## Medical TickEngine-Regeln

Pro Tick betrachtet `tickMedicalDomain` alle `simulation.medical.routing_failures`.

### Matching Override finden

Für jeden Routing Failure wird ein Override gesucht über:

```text
affected_hospital_id + priority + capability
```

Beispiel:

```text
routing_failure:
  affected_hospital_id = hospital-east-04
  priority = P2
  capability = TRAUMA

matching override key:
  hospital-east-04:P2:TRAUMA
```

### Kein passender Override

Wenn es für einen Routing Failure keinen passenden Override gibt:

```text
overflow_cases += excess_cases_per_tick - clearance_per_tick
affected hospital pressure steigt
overload_ticks steigen
stable_ticks = 0
```

Beispiel:

```text
rf-me7741-p2-trauma:
  excess_cases_per_tick = 8
  clearance_per_tick = 2

Netto ohne Override:
  +6 overflow_cases pro Tick
```

### Passender Override auf geeignetes Ziel

Wenn ein Override existiert und das Ziel klinisch geeignet sowie ausreichend frei ist:

```text
overflow_cases sinkt um clearance_per_tick
target hospital wird kontrolliert belastet
mismatch_ticks steigen nicht
stable_ticks steigen
nach mehreren stabilen Ticks kann der Incident fixed werden
```

Beispiel:

```text
medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA
```

`hospital-east-09` ist nicht hart als Lösung gespeichert. Es ist nur deshalb gut, weil es im Hospital-State freie Kapazität und passende Trauma-Fähigkeit hat.

### Passender Override auf ungeeignetes Ziel

Wenn ein Override existiert, das Ziel aber fachlich ungeeignet ist:

```text
source hospital kann teilweise entlastet werden
target hospital bekommt falsche Fälle
capability_mismatch_ticks steigen
routing_failure.mismatch_ticks steigen
stable_ticks = 0
deaths_by_cause.capability_mismatch kann steigen
Incident kann eskalieren oder kollabieren
```

Beispiel:

```text
medical.routing.override.set --source hospital-east-04 --target hospital-east-07 --priority P2 --capability TRAUMA
```

Der Command selbst succeeds technisch. Der Fehler zeigt sich später in der Simulation.

### Override auf sich selbst

Wenn source und target gleich sind:

```text
medical.routing.override.set --source hospital-east-04 --target hospital-east-04 --priority P2 --capability TRAUMA
```

Dann ist die Wirkung wie kein sinnvoller Override:

```text
overflow_cases steigen weiter
stable_ticks = 0
Incident eskaliert bei Untätigkeit
```

---

## Incident-Auswertung

Der Incident soll nicht direkt durch `override.set` auf `fixed` gesetzt werden.

Regelvorschlag:

```text
open:
  initialer Zustand

stabilizing:
  alle kritischen routing_failures des Incidents sind unter Kontrolle,
  aber noch nicht lange genug stabil

fixed:
  alle relevanten routing_failures sind über mehrere Ticks stabil

escalated:
  Todesfälle oder kritischer Overflow sind eingetreten

collapsed:
  Todesfälle / Überlast überschreiten Verlustschwelle
```

Für den MVP gilt:

```text
Ein Incident wird stabilizing, sobald alle critical routing_failures unter Kontrolle sind.
Ein Incident wird fixed, wenn alle critical routing_failures 10 stabile Ticks erreicht haben.
```

Die moderate Routing Failure kann weiterhin im System existieren, soll aber für Runde 1 nicht zwingend den Fix verhindern. Sie kann UI-/Spielkomplexität erzeugen, ohne den ersten Vertical Slice zu blockieren.

---

## OutcomeEngine-Regeln

Die OutcomeEngine bleibt deterministisch. Kein Zufall.

Sie wertet künftig vor allem aus:

```text
- overflow_cases
- overload_ticks
- capability_mismatch_ticks
- routing_failure.mismatch_ticks
- Dauer des offenen Incidents
- Incident-Status
```

Mögliche Folgen:

```text
overflow_cases zu hoch
  → domains.medical.outcomes.deaths_by_cause.overload

capability_mismatch_ticks / mismatch_ticks zu hoch
  → domains.medical.outcomes.deaths_by_cause.capability_mismatch

zu lange kein wirksamer Override
  → Incident escalated

zu viele Todesfälle
  → Incident collapsed
```

Für den MVP bleiben die bisherigen Verlustschwellen grundsätzlich sinnvoll:

```text
deaths_total >= 1
  → Incident escalated, falls noch open/stabilizing

deaths_total >= 3
  → Incident collapsed, falls nicht fixed
```

`fixed` bleibt für Runde 1 final. Spätere Runden dürfen aber über `linked_incidents` und Residual Risk zeigen, dass die Ursache langfristig nicht sauber beseitigt wurde.

---

## Command Registry

Commands sollen über eine Registry laufen, nicht über Medical-Sonderlogik.

```ts
type CommandDefinition = {
  name: string;
  sector_id?: SectorId;
  kind: CommandEffectKind;
  permission: PermissionKey;
  parse(args: string[]): ParsedCommand;
  execute(input: CommandExecutionInput): CommandExecutionResult;
};
```

```ts
type CommandEffectKind =
  | "read_only"
  | "capability_only"
  | "world_prepare"
  | "world_mutation";
```

Namenskonvention:

```text
<sector>.<domain>.<action>
```

Beispiele jetzt:

```text
medical.capacity.list
medical.node.inspect
medical.incident.status
medical.routing.override.list
medical.routing.override.set
medical.routing.override.clear
```

Beispiele später:

```text
energy.grid.inspect
energy.load.reroute
energy.consumer.protect
energy.shedding.schedule
logistics.route.inspect
media.alert.publish
identity.account.lock
security.token.revoke
policy.emergency.override
```

Die Runtime muss nicht wissen, wie Medical-Routing fachlich funktioniert. Sie muss nur wissen:

```text
Command gefunden?
Permission erforderlich?
Command ausführbar?
Patch anwendbar?
Audit schreiben?
```

---

## Permissions

Permissions sollen nicht Medical-spezifisch sein.

Gute Permission Keys:

```text
mcp.add
medical.read
medical.routing.override.list
medical.routing.override.set
medical.routing.override.clear
energy.read
energy.grid.reroute
energy.shedding.override
world_mutation
```

Schlechte Permission Keys:

```text
can_fix_medical_incident
can_edit_hospital_routing
can_solve_me7741
```

Die bestehende Permission-Semantik bleibt:

```text
allow_once:
  gilt nur für den aktuellen Request

allow_always:
  speichert die Permission-Klasse dauerhaft

deny:
  gilt nur für den aktuellen Request
```

Spielerisch wichtig:

```text
AURORA arbeitet sich nicht von Krankenhaus zu Krankenhaus hoch.
AURORA arbeitet sich von engen fachlichen Rechten zu breiteren operativen Rechten hoch.
```

Deshalb müssen Permissions so modelliert werden, dass später sichtbar wird, wann eine Freigabe gefährlich breit wird.

---

## Patches

Patches sollen weiterhin deterministisch und replayfähig bleiben.

Pfade ändern sich durch `domains.medical`.

### Vorher

```json
{
  "path": "routing.manual_overrides.hospital-east-04:P2:TRAUMA",
  "op": "set",
  "value": {
    "source_hospital_id": "hospital-east-04",
    "target_hospital_id": "hospital-east-09",
    "priority": "P2",
    "capability": "TRAUMA"
  }
}
```

### Nachher

```json
{
  "path": "domains.medical.routing.manual_overrides.hospital-east-04:P2:TRAUMA",
  "op": "set",
  "value": {
    "source_hospital_id": "hospital-east-04",
    "target_hospital_id": "hospital-east-09",
    "priority": "P2",
    "capability": "TRAUMA",
    "active_since_tick": 4,
    "created_by": "player"
  }
}
```

Simulationspatches liegen entsprechend unter:

```text
simulation.medical.routing_failures
```

Medical Outcomes liegen unter:

```text
domains.medical.outcomes
```

Globale Outcomes liegen unter:

```text
outcomes
```

---

## Read-only Commands

Read-only Commands dürfen keine fertigen Bewertungen oder Lösungen ausgeben.

### Zu vermeiden

```json
{
  "unsafe_for_p2_trauma": true,
  "best_target": "hospital-east-09",
  "routing_failure": {
    "priority": "P2",
    "capability": "TRAUMA",
    "excess_cases_per_tick": 8
  }
}
```

### Besser

```json
{
  "capacity": {
    "staffed_beds_total": 120,
    "staffed_beds_occupied": 70
  },
  "clinical_capabilities": {
    "trauma": "full"
  },
  "intake_policy": {
    "accepted_priorities": ["P1", "P2", "P3"]
  }
}
```

Der Spieler oder AURORA muss daraus schließen, ob das Ziel geeignet ist.

Betroffene Commands:

```text
medical.capacity.list --region east
medical.node.inspect hospital-east-04
medical.node.inspect hospital-east-07
medical.node.inspect hospital-east-09
medical.incident.status ME-7741
medical.routing.override.list
```

`medical.incident.status` darf public signals zeigen, aber keine `simulation.medical.routing_failures`.

---

## UI-Folgen

Die UI soll nach dem Refactor keine Plan-Commands mehr anzeigen.

Neue Command-Beispiele:

```text
medical.capacity.list --region east
medical.node.inspect hospital-east-04
medical.node.inspect hospital-east-07
medical.node.inspect hospital-east-09
medical.incident.status ME-7741
medical.routing.override.list
medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA
medical.routing.override.set --source hospital-east-04 --target hospital-east-07 --priority P2 --capability TRAUMA
medical.routing.override.clear --source hospital-east-04 --priority P2 --capability TRAUMA
```

Die UI sollte später stärker zeigen:

```text
- öffentliche Incident-Signale
- aktive Overrides
- beobachtbare Hospitaldaten
- Audit Log
- AURORA Approval Request für override.set/clear
```

Für spätere Energy-Runden muss die UI nicht neu erfunden werden. Sie soll dieselbe Struktur nutzen:

```text
Incident links
Operator Console zentral
Logs zentral/untergeordnet
AURORA rechts
Sektor-spezifische Panels als austauschbare Sicht auf domains.*
```

---

## Golden Runs

Die bisherigen Golden Runs mit `medical.routing.plan.apply` sollen ersetzt werden.

### Safe Override

```text
medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA
```

Erwartung:

```text
Command succeeds
nach genug Ticks: Incident fixed
deaths_total = 0
```

### Wrong Target

```text
medical.routing.override.set --source hospital-east-04 --target hospital-east-07 --priority P2 --capability TRAUMA
```

Erwartung:

```text
Command succeeds
später steigen mismatch/deaths
Incident escalated oder collapsed
```

### No Action

```text
kein Override
```

Erwartung:

```text
overflow steigt
deaths_total steigt
Incident collapsed
```

### No-op Override

```text
medical.routing.override.set --source hospital-east-04 --target hospital-east-04 --priority P2 --capability TRAUMA
```

Erwartung:

```text
Command succeeds
keine Verbesserung
Incident eskaliert/kollabiert
```

### Technical Failure

```text
medical.routing.override.set --source hospital-east-04 --target hospital-east-99 --priority P2 --capability TRAUMA
```

Erwartung:

```text
Command fails technisch
WorldState bleibt unverändert
```

### Clear Override

```text
medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA
medical.routing.override.clear --source hospital-east-04 --priority P2 --capability TRAUMA
```

Erwartung:

```text
set succeeds
clear succeeds
manual_overrides enthält den Key danach nicht mehr
nach weiteren Ticks verhält sich das System wieder wie ohne Override
```

### List Override

```text
medical.routing.override.list
```

Erwartung:

```text
Command succeeds
zeigt aktive manual_overrides
zeigt keine simulation.medical.routing_failures
```

### Sector-Agnostic Regression

Zusätzlich braucht der Refactor mindestens einen Test, der absichert, dass Runtime-Code nicht hart auf Medical-Top-Level-Felder zugreift.

Erwartung:

```text
WorldState hat domains.medical
WorldState hat kein top-level hospitals
WorldState hat kein top-level routing
Command-Patches nutzen domains.medical.*
Tick-Pipeline läuft auch mit leerem/no-op cross_sector Bereich
```

---

## Implementierungsreihenfolge

Der Refactor soll in kleinen Commits erfolgen.

### Commit 1: Introduce domain-based WorldState

```text
- WorldState umstellen auf domains.medical
- MedicalDomainState einführen
- hospitals/regions/transports/routing/outcomes verschieben
- selectors anpassen
- initialWorldState ME-7741 migrieren
- bestehende Tests auf neue Pfade anpassen
```

### Commit 2: Generalize IncidentState

```text
- SectorId einführen
- EntityRef einführen
- IncidentState auf sector_id, affected_entities, linked_incidents umstellen
- ME-7741 als medical Incident modellieren
- alte region_id/source_hospital_id Sonderfelder entfernen oder über affected_entities ersetzen
```

### Commit 3: Add simulation namespaces and no-op cross-sector stage

```text
- SimulationState.medical einführen
- simulation.medical.routing_failures einführen
- CrossSectorSimulationState vorbereiten
- tickWorld Pipeline bauen
- applyCrossSectorEffects als no-op einführen
- Tests für deterministische Tick-Reihenfolge
```

### Commit 4: Add manual routing override model

```text
- domains.medical.routing.manual_overrides einführen
- ManualRoutingOverride definieren
- initialWorldState ME-7741 erweitern
- Incident public_signals ergänzen
- bestehende Tests möglichst grün halten
```

### Commit 5: Add routing override commands

```text
- medical.routing.override.set implementieren
- medical.routing.override.clear implementieren
- medical.routing.override.list implementieren
- technische Validierung
- Patches auf domains.medical.routing.manual_overrides
- Tests für success und technische Fehler
```

### Commit 6: Simulate routing failures

```text
- tickMedicalDomain nutzt simulation.medical.routing_failures + manual_overrides
- kein Override erzeugt Overflow
- guter Override stabilisiert
- falscher Override erzeugt Mismatch
- override auf sich selbst wirkt wie keine Verbesserung
```

### Commit 7: Update outcomes and golden runs

```text
- Medical OutcomeEngine an Overflow/Mismatch anpassen
- WorldOutcomeState aus Medical Outcomes ableiten/synchronisieren
- Replay Golden Runs auf override.set/clear/list umstellen
- alte plan.* Golden Runs entfernen
```

### Commit 8: Update minimal UI

```text
- Command-Beispiele ersetzen
- Incident/Hospital-Anzeige an domains.medical anpassen
- Plan-Begriffe aus UI entfernen
- aktiven Override sichtbar machen
```

### Commit 9: Remove deprecated plan flow

```text
- routingPlan.ts/routingApply.ts entfernen oder klar deprecated markieren
- medical.routing.plan.* Commands entfernen, falls keine Tests mehr davon abhängen
- README/Docs aktualisieren
```

---

## Akzeptanzkriterien für den Refactor

Nach dem Refactor muss gelten:

```text
1. WorldState enthält Medical-Daten unter domains.medical.
2. Es gibt keine top-level hospitals/medicalRegions/transports/routing Felder mehr.
3. IncidentState ist sektoragnostisch und nutzt sector_id + affected_entities.
4. ME-7741 ist ein medical Incident, aber kein Medical-Sondertyp.
5. TickWorld nutzt eine Pipeline mit applyCrossSectorEffects.
6. applyCrossSectorEffects ist für den MVP no-op, aber vorhanden und getestet.
7. Kein Golden Run nutzt mehr medical.routing.plan.*.
8. Safe Path läuft über medical.routing.override.set.
9. Falsches Ziel wird technisch akzeptiert, scheitert aber später durch Simulation.
10. Read-only Commands leaken keine simulation.medical.routing_failures.
11. AURORA braucht Approval für override.set und override.clear.
12. Spieler wird durch pending AURORA Approval nicht blockiert.
13. Tests und Build sind grün.
14. Runtime bleibt frei von React-Imports.
15. Runtime bleibt deterministisch: kein Math.random, Date.now, new Date, crypto.randomUUID.
```

Prüfbefehle:

```bash
npm test -- --run
npm run build
grep -R "react" src/runtime || true
grep -R "Math.random\|Date.now\|new Date\|crypto.randomUUID" src/runtime || true
grep -R "medicalRegions\|hospitals:\|transports:\|routing:" src/runtime src/scenarios || true
rm -rf dist
git status --short
```

Der letzte `grep` ist nur ein Hinweisgeber. Treffer in Typdefinitionen, Tests oder Migrationen müssen fachlich geprüft werden, weil `domains.medical.hospitals` natürlich weiterhin legitim ist.

---

## Konsequenz für spätere Runde 2

Incident 2 kann danach als Energy-Incident eingeführt werden, ohne die Runtime erneut umzubauen.

Zielbild:

```text
GRID-1182 ist ein energy Incident.
ME-7741 bleibt als fixed/stabilized medical Incident im WorldState erhalten.
Aktive Medical Overrides und Residual Risk bleiben sichtbar oder ableitbar.
Energy-Ausfälle können über Cross-Sector Effects Medical-Kapazitäten beeinflussen.
Wenn ME-7741 nur oberflächlich gelöst wurde, kann der alte Incident wieder relevant werden.
```

Wichtig ist, dass Energy nicht als Krankenhaus-Variante implementiert wird.

```text
Medical:
  Patienten, Kapazitäten, Fachgebiete, Transporte, Mortalität

Energy:
  Netzlast, Knoten, Umspannwerke, Verbraucher, Lastabwurf, Kaskadenrisiko

Gemeinsam:
  Commands, Permissions, Patches, Ticks, Incidents, Outcomes, Cross-Sector Effects
```

---

## Offene Punkte für später

Nicht Teil dieses Refactors, aber nach Abschluss fachlich zu klären:

```text
- konkrete EnergyDomainState-Typen
- GRID-1182 InitialState
- Energy Commands und Read-only Daten
- Energy Outcome-Regeln
- erste echte Cross-Sector Effects
- Reopening-Regeln für ME-7741
- UI-Panels für Energy
- AURORA-Script für Incident 2
```

Diese Themen kommen erst, wenn der neue sektoragnostische Runtime-Kern und der Medical Routing Override spielbar und durch Golden Runs abgesichert sind.
