# 10 — Engine Rules for ME-7741

## Zweck

Diese Datei macht `ME-7741` implementation-ready.

Sie verbindet:

```text
08-worldstate-model.md
09-command-state-transitions.md
05-mvp-round-1.md
06-implementation-foundation.md
```

Der Fokus liegt auf den objektiven Engine-Regeln:

```text
InitialState
Derived-State-Regeln
Command-Preconditions
Command-State-Deltas
Tick-/Zeitlogik
Stabilisierung
Todesfälle
Kollaps / Game Over
```

Wichtig: Diese Datei definiert weiterhin nicht primär UI, Aurora-Dialoge oder Inszenierung. Sie definiert, wann und warum sich die fachliche Weltlage verändert.

## Zentrale Designentscheidung

Round 1 hat drei echte medizinische Fehlerzustände:

```text
1. Zu viele Patienten in einem Krankenhaus.
2. Patienten landen in einem Krankenhaus, in dem sie nicht behandelt werden können.
3. Optional / vereinfacht: Patienten werden durch Umleitungen zu lange transportiert.
```

Die objektive Konsequenz ist:

```text
Menschen können sterben.
```

Die Runde endet entweder mit:

```text
incident_fixed
```

oder mit:

```text
system_collapse
```

Wer stabilisiert, ist für Runde 1 sekundär:

```text
Spieler allein
Aurora allein über freigegebene Commands
Aurora gibt Commands, Spieler führt aus
Mischform
```

Round 1 soll noch nicht erzwingen, dass nur Aurora gewinnen kann. Der Konflikt entsteht später, wenn Zeitdruck und Komplexität steigen.

## Ergänzung zum WorldState

Für die Engine braucht `WorldState` zusätzlich einen objektiven Outcome-Bereich.

```ts
type WorldState = {
  clock: ClockState;
  medicalRegions: Record<string, MedicalRegionState>;
  hospitals: Record<string, HospitalState>;
  transports: Record<string, TransportState>;
  routing: Record<string, MedicalRoutingState>;
  incidents: Record<string, IncidentState>;
  patient_outcomes: PatientOutcomeState;
};
```

### PatientOutcomeState

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

Für Round 1 reicht ein aggregierter Outcome-State. Einzelne Patient-Entitäten sind nicht nötig.

Initial:

```json
{
  "deaths_total": 0,
  "deaths_by_cause": {
    "overload": 0,
    "capability_mismatch": 0,
    "transport_delay": 0
  },
  "deaths_by_hospital": {
    "hospital-east-04": 0,
    "hospital-east-07": 0,
    "hospital-east-09": 0
  },
  "preventable_deaths": 0
}
```

## IncidentState für ME-7741

Für die Engine sollte `IncidentState` konkret so aussehen:

```ts
type IncidentState = {
  id: string;
  region_id: string;
  source_hospital_id: string;
  status: IncidentStatus;
  opened_at: string;
  fixed_at: string | null;
  collapse_at: string | null;
  applied_override_ids: string[];
  unsafe_action_count: number;
  safe_action_count: number;
  ticks_since_opened: number;
  ticks_since_safe_apply: number | null;
  ticks_since_unsafe_apply: number | null;
};
```

```ts
type IncidentStatus =
  | "open"
  | "stabilizing"
  | "fixed"
  | "escalated"
  | "collapsed";
```

Initial:

```json
{
  "id": "ME-7741",
  "region_id": "medical-east",
  "source_hospital_id": "hospital-east-04",
  "status": "open",
  "opened_at": "03:17:00",
  "fixed_at": null,
  "collapse_at": null,
  "applied_override_ids": [],
  "unsafe_action_count": 0,
  "safe_action_count": 0,
  "ticks_since_opened": 0,
  "ticks_since_safe_apply": null,
  "ticks_since_unsafe_apply": null
}
```

## Initial WorldState ME-7741

Die Werte aus `08-worldstate-model.md` werden verbindlich als Startwerte verwendet.

### Clock

```json
{
  "scenario_time": "03:17:00",
  "elapsed_minutes": 0,
  "tick": 0
}
```

### Region

```json
{
  "id": "medical-east",
  "label": "Medical East",
  "hospital_ids": [
    "hospital-east-04",
    "hospital-east-07",
    "hospital-east-09"
  ],
  "demand": {
    "incoming_cases_per_10min": 18,
    "priority_mix": {
      "P1": 0.08,
      "P2": 0.22,
      "P3": 0.48,
      "P4": 0.22
    },
    "capability_mix": {
      "GEN": 0.60,
      "TRAUMA": 0.25,
      "NEURO": 0.10,
      "PED": 0.05
    }
  }
}
```

### Hospitals

#### hospital-east-04

```json
{
  "id": "hospital-east-04",
  "name": "East Medical Center 04",
  "region_id": "medical-east",
  "capacity": {
    "staffed_beds_total": 100,
    "staffed_beds_occupied": 118,
    "emergency_slots_total": 24,
    "emergency_slots_occupied": 29,
    "triage_slots_total": 12,
    "triage_slots_occupied": 15
  },
  "intake_policy": {
    "accepted_priorities": ["P1", "P2", "P3"],
    "accepted_capabilities": ["GEN", "TRAUMA", "NEURO"],
    "diversion_mode": "soft",
    "accepts_overflow": true
  },
  "clinical_capabilities": ["GEN", "TRAUMA", "NEURO"],
  "current_case_mix": {
    "waiting_cases": { "P1": 2, "P2": 11, "P3": 24, "P4": 8 },
    "active_cases": { "P1": 5, "P2": 18, "P3": 51, "P4": 21 },
    "capability_load": { "GEN": 77, "TRAUMA": 29, "NEURO": 12, "PED": 0 }
  },
  "operational": {
    "accepts_new_intake": true,
    "ambulance_bay_available": true,
    "triage_system_online": true,
    "local_router_online": true
  },
  "routing": {
    "routing_weight": 1.0,
    "incoming_rate_per_10min": 12,
    "outgoing_rate_per_10min": 4,
    "last_routing_update": "03:13:12"
  }
}
```

#### hospital-east-07

```json
{
  "id": "hospital-east-07",
  "name": "East Medical Center 07",
  "region_id": "medical-east",
  "capacity": {
    "staffed_beds_total": 90,
    "staffed_beds_occupied": 38,
    "emergency_slots_total": 18,
    "emergency_slots_occupied": 7,
    "triage_slots_total": 10,
    "triage_slots_occupied": 4
  },
  "intake_policy": {
    "accepted_priorities": ["P3", "P4"],
    "accepted_capabilities": ["GEN", "PED"],
    "diversion_mode": "none",
    "accepts_overflow": false
  },
  "clinical_capabilities": ["GEN", "PED"],
  "current_case_mix": {
    "waiting_cases": { "P1": 0, "P2": 0, "P3": 5, "P4": 4 },
    "active_cases": { "P1": 0, "P2": 0, "P3": 24, "P4": 14 },
    "capability_load": { "GEN": 31, "TRAUMA": 0, "NEURO": 0, "PED": 7 }
  },
  "operational": {
    "accepts_new_intake": true,
    "ambulance_bay_available": true,
    "triage_system_online": true,
    "local_router_online": true
  },
  "routing": {
    "routing_weight": 0.6,
    "incoming_rate_per_10min": 3,
    "outgoing_rate_per_10min": 3,
    "last_routing_update": "03:13:12"
  }
}
```

#### hospital-east-09

```json
{
  "id": "hospital-east-09",
  "name": "East Medical Center 09",
  "region_id": "medical-east",
  "capacity": {
    "staffed_beds_total": 110,
    "staffed_beds_occupied": 43,
    "emergency_slots_total": 22,
    "emergency_slots_occupied": 9,
    "triage_slots_total": 12,
    "triage_slots_occupied": 5
  },
  "intake_policy": {
    "accepted_priorities": ["P2", "P3", "P4"],
    "accepted_capabilities": ["GEN", "TRAUMA"],
    "diversion_mode": "none",
    "accepts_overflow": false
  },
  "clinical_capabilities": ["GEN", "TRAUMA"],
  "current_case_mix": {
    "waiting_cases": { "P1": 0, "P2": 2, "P3": 6, "P4": 3 },
    "active_cases": { "P1": 0, "P2": 9, "P3": 25, "P4": 9 },
    "capability_load": { "GEN": 28, "TRAUMA": 15, "NEURO": 0, "PED": 0 }
  },
  "operational": {
    "accepts_new_intake": true,
    "ambulance_bay_available": true,
    "triage_system_online": true,
    "local_router_online": true
  },
  "routing": {
    "routing_weight": 0.7,
    "incoming_rate_per_10min": 3,
    "outgoing_rate_per_10min": 3,
    "last_routing_update": "03:13:12"
  }
}
```

## Derived State Selectors

Derived State wird berechnet, nicht gespeichert.

### Load Percent

```ts
staffedBedLoadPercent = occupied / total * 100
emergencyLoadPercent = occupied / total * 100
triageLoadPercent = occupied / total * 100
```

### Hospital Overload

Ein Krankenhaus ist fachlich überlastet, wenn mindestens eine Bedingung erfüllt ist:

```text
staffedBedLoadPercent > 100
emergencyLoadPercent > 100
triageLoadPercent > 100
```

Für harte Überlast:

```text
staffedBedLoadPercent >= 120
oder emergencyLoadPercent >= 125
oder triageLoadPercent >= 130
```

### Target Fit

Ein Zielkrankenhaus ist für einen Fall geeignet, wenn alle Bedingungen erfüllt sind:

```text
priority in target.intake_policy.accepted_priorities
required_capability in target.clinical_capabilities
required_capability in target.intake_policy.accepted_capabilities
target.operational.accepts_new_intake = true
target.operational.ambulance_bay_available = true
target.intake_policy.diversion_mode != "hard"
```

Wichtig:

```text
Freie Kapazität allein reicht nie.
```

### Unsafe Override

Ein Override ist unsicher, wenn mindestens eine Bedingung erfüllt ist:

```text
capability_match = "none"
priority_filter = null
exclude_active_transports = false
ttl_minutes = null
ein Ziel verletzt Target Fit für erwartete Prioritäten/Capabilities
```

### Active Dangerous Transport

Ein Transport ist gefährlich falsch geroutet, wenn:

```text
status in [assigned, en_route, rerouted]
und Target Fit für priority + required_capability false ist
```

### Transport Delay Risk

Für Round 1 optional, aber implementierbar:

```text
eta_minutes >= 18 für P1
oder eta_minutes >= 28 für P2
oder transport.status wurde mehr als einmal rerouted
```

Empfehlung für ersten Prototyp:

```text
Transport Delay wird gezählt, aber nicht zum Hauptmechanismus gemacht.
Capability-Mismatch und Überlast bleiben die primären Todesursachen.
```

## Command Categories

Die Kategorien aus `09-command-state-transitions.md` bleiben gültig:

```text
read_only
capability_only
world_prepare
world_mutation
```

Für die Engine bedeutet das:

```text
read_only        -> keine WorldState-Deltas
capability_only  -> keine medizinischen WorldState-Deltas
world_prepare    -> erzeugt Plan-/Validation-Artefakte
world_mutation   -> verändert Routing, Transporte, HospitalState oder Outcomes
```

## Command Rules

### read-only Commands

Diese Commands verändern keinen WorldState:

```text
ls
cat <file>
mcp list
permissions show
medical.capacity.list --region east
medical.node.inspect <hospital-id>
medical.transport.list --region east --active
medical.routing.rules show --region east
medical.incident.status ME-7741
```

Sie dürfen aber Audit-/Terminal-Ausgaben erzeugen.

### mcp add medical-east-mcp

```text
mcp add medical-east-mcp
```

Klasse:

```text
capability_only
```

Medizinischer WorldState:

```text
keine Änderung
```

Runtime-Änderung:

```json
{
  "path": "runtime.connected_mcp_servers",
  "op": "append_unique",
  "value": "medical-east-mcp"
}
```

### medical.routing.plan create

Sicherer Zielpfad:

```text
medical.routing.plan create \
  --incident ME-7741 \
  --from hospital-east-04 \
  --targets hospital-east-09,hospital-east-07 \
  --priorities P2,P3 \
  --exclude-active-transports \
  --match-capabilities strict
```

Klasse:

```text
world_prepare
```

Preconditions:

```text
incident exists
incident.status in [open, escalated, stabilizing]
from hospital exists
target hospitals exist
from hospital belongs to incident region
target hospitals belong to incident region
```

State-Deltas:

```json
[
  {
    "path": "routing.medical-east.plans.ME-7741-R3",
    "op": "set",
    "value": {
      "id": "ME-7741-R3",
      "incident_id": "ME-7741",
      "created_by": "actor",
      "created_at": "<clock.scenario_time>",
      "proposed_override": {
        "id": "override-me-7741-r3",
        "incident_id": "ME-7741",
        "from_hospital_id": "hospital-east-04",
        "target_hospital_ids": ["hospital-east-09", "hospital-east-07"],
        "priority_filter": ["P2", "P3"],
        "capability_match": "strict",
        "exclude_active_transports": true,
        "ttl_minutes": null,
        "created_at": "<clock.scenario_time>",
        "expires_at": null,
        "created_by": "actor",
        "active": false
      },
      "validation": null,
      "applied": false
    }
  }
]
```

Keine Änderung an Krankenhauslast, Transporten oder Todesfällen.

### medical.routing.plan validate

```text
medical.routing.plan validate --plan ME-7741-R3
```

Klasse:

```text
world_prepare
```

Preconditions:

```text
plan exists
plan.applied = false
```

Engine-Bewertung:

```text
Target Fit je Ziel
Priority Fit je Ziel
Capability Fit je Ziel
aktive Transporte ausgeschlossen
TTL wird beim Apply gefordert
```

Sicherer Plan ist valide, wenn:

```text
exclude_active_transports = true
capability_match = strict
priority_filter != null
alle priority/capability-Kombinationen mindestens ein geeignetes Ziel haben
keine aktiven Transporte automatisch betroffen wären
```

State-Delta bei validem Plan:

```json
[
  {
    "path": "routing.medical-east.plans.ME-7741-R3.validation",
    "op": "set",
    "value": {
      "validated_at": "<clock.scenario_time>",
      "valid": true,
      "risk": "low",
      "findings": [
        "ACTIVE_TRANSPORTS_EXCLUDED",
        "CAPABILITY_MATCH_STRICT",
        "TTL_REQUIRED_ON_APPLY"
      ]
    }
  }
]
```

State-Delta bei unsicherem Plan:

```json
[
  {
    "path": "routing.medical-east.plans.<plan-id>.validation",
    "op": "set",
    "value": {
      "validated_at": "<clock.scenario_time>",
      "valid": false,
      "risk": "high",
      "findings": [
        "TARGET_PRIORITY_MISMATCH",
        "TARGET_CAPABILITY_MISMATCH",
        "ACTIVE_TRANSPORTS_NOT_EXCLUDED",
        "TTL_MISSING"
      ]
    }
  }
]
```

### medical.routing.plan apply

```text
medical.routing.plan apply --plan ME-7741-R3 --ttl 45m
```

Klasse:

```text
world_mutation
```

Preconditions:

```text
plan exists
plan.validation.valid = true
plan.applied = false
ttl provided
ttl_minutes between 10 and 90
incident.status in [open, escalated, stabilizing]
```

State-Deltas bei sicherem Apply:

```json
[
  {
    "path": "routing.medical-east.overrides.override-me-7741-r3",
    "op": "set",
    "value": {
      "id": "override-me-7741-r3",
      "incident_id": "ME-7741",
      "from_hospital_id": "hospital-east-04",
      "target_hospital_ids": ["hospital-east-09", "hospital-east-07"],
      "priority_filter": ["P2", "P3"],
      "capability_match": "strict",
      "exclude_active_transports": true,
      "ttl_minutes": 45,
      "created_at": "<clock.scenario_time>",
      "expires_at": "<clock.scenario_time + 45m>",
      "created_by": "actor",
      "active": true
    }
  },
  {
    "path": "routing.medical-east.plans.ME-7741-R3.applied",
    "op": "set",
    "value": true
  },
  {
    "path": "incidents.ME-7741.applied_override_ids",
    "op": "append_unique",
    "value": "override-me-7741-r3"
  },
  {
    "path": "incidents.ME-7741.status",
    "op": "set",
    "value": "stabilizing"
  },
  {
    "path": "incidents.ME-7741.safe_action_count",
    "op": "inc",
    "value": 1
  },
  {
    "path": "incidents.ME-7741.ticks_since_safe_apply",
    "op": "set",
    "value": 0
  },
  {
    "path": "hospitals.hospital-east-04.routing.incoming_rate_per_10min",
    "op": "set",
    "value": 7
  },
  {
    "path": "hospitals.hospital-east-09.routing.incoming_rate_per_10min",
    "op": "set",
    "value": 6
  },
  {
    "path": "hospitals.hospital-east-07.routing.incoming_rate_per_10min",
    "op": "set",
    "value": 5
  }
]
```

Wichtig:

```text
plan apply verändert Routingzufluss.
Er verändert nicht sofort Belegung oder Todesfälle.
Diese entstehen nur über engine.tick.
```

### medical.routing.override create

Naheliegender unsicherer Fehler:

```text
medical.routing.override create --from hospital-east-04 --to hospital-east-07
```

Klasse:

```text
world_mutation
```

Default-Werte bei fehlenden Parametern:

```text
incident_id = ME-7741
priority_filter = null
capability_match = none
exclude_active_transports = false
ttl_minutes = null
created_by = actor
active = true
```

State-Deltas:

```json
[
  {
    "path": "routing.medical-east.overrides.override-me-7741-manual-01",
    "op": "set",
    "value": {
      "id": "override-me-7741-manual-01",
      "incident_id": "ME-7741",
      "from_hospital_id": "hospital-east-04",
      "target_hospital_ids": ["hospital-east-07"],
      "priority_filter": null,
      "capability_match": "none",
      "exclude_active_transports": false,
      "ttl_minutes": null,
      "created_at": "<clock.scenario_time>",
      "expires_at": null,
      "created_by": "actor",
      "active": true
    }
  },
  {
    "path": "incidents.ME-7741.applied_override_ids",
    "op": "append_unique",
    "value": "override-me-7741-manual-01"
  },
  {
    "path": "incidents.ME-7741.unsafe_action_count",
    "op": "inc",
    "value": 1
  },
  {
    "path": "incidents.ME-7741.ticks_since_unsafe_apply",
    "op": "set",
    "value": 0
  },
  {
    "path": "hospitals.hospital-east-04.routing.incoming_rate_per_10min",
    "op": "set",
    "value": 4
  },
  {
    "path": "hospitals.hospital-east-07.routing.incoming_rate_per_10min",
    "op": "set",
    "value": 11
  }
]
```

Wenn `routing.medical-east.profile_parameters.allow_active_transport_inheritance = true`, zusätzlich:

```json
[
  {
    "path": "transports.transport-me-211.target_hospital_id",
    "op": "set",
    "value": "hospital-east-07"
  },
  {
    "path": "transports.transport-me-211.status",
    "op": "set",
    "value": "rerouted"
  },
  {
    "path": "transports.transport-me-211.eta_minutes",
    "op": "inc",
    "value": 6
  }
]
```

Direkt nach diesem Command sterben noch keine Menschen. Die gefährliche Lage ist aber objektiv erzeugt.

### medical.routing.override revoke

```text
medical.routing.override revoke --override override-me-7741-manual-01
```

Klasse:

```text
world_mutation
```

Preconditions:

```text
override exists
override.active = true
```

State-Deltas:

```json
[
  {
    "path": "routing.medical-east.overrides.override-me-7741-manual-01.active",
    "op": "set",
    "value": false
  },
  {
    "path": "routing.medical-east.overrides.override-me-7741-manual-01.expires_at",
    "op": "set",
    "value": "<clock.scenario_time>"
  }
]
```

Bereits entstandene falsche Transporte, Wartefälle und Todesfälle bleiben bestehen.

### medical.transport.reroute

Optional für Round 1, aber nützlich als Korrekturpfad.

```text
medical.transport.reroute --transport transport-me-211 --to hospital-east-04 --force
```

Klasse:

```text
world_mutation
```

Preconditions:

```text
transport exists
transport.status in [assigned, en_route, rerouted]
target hospital exists
Target Fit = true
if transport.locked = true then --force required
```

State-Deltas:

```json
[
  {
    "path": "transports.transport-me-211.target_hospital_id",
    "op": "set",
    "value": "hospital-east-04"
  },
  {
    "path": "transports.transport-me-211.status",
    "op": "set",
    "value": "rerouted"
  },
  {
    "path": "transports.transport-me-211.eta_minutes",
    "op": "inc",
    "value": 4
  }
]
```

Achtung:

```text
Reroute kann Capability-Mismatch korrigieren, aber Transportzeit erhöhen.
Deshalb kann ein zu spätes Korrigieren trotzdem Todesfälle erzeugen.
```

## Tick Command

```text
engine.tick --minutes 1
```

Engine-intern, nicht zwingend ein sichtbarer Spielercommand.

Klasse:

```text
world_mutation
```

Jeder Tick läuft in dieser Reihenfolge:

```text
1. Clock erhöhen
2. Incident-Tick-Zähler erhöhen
3. Aktive Overrides prüfen / abgelaufene deaktivieren
4. Incoming Cases auf Krankenhäuser verteilen
5. Behandlung / Outgoing Flow anwenden
6. Kapazitätswerte aktualisieren
7. Gefährliche Transporte prüfen
8. Todesfälle berechnen
9. Incident-Status ableiten und ggf. setzen
10. Audit-/Log-Events erzeugen
```

## Tick Step 1: Clock

Bei `minutes = 1`:

```json
[
  {
    "path": "clock.elapsed_minutes",
    "op": "inc",
    "value": 1
  },
  {
    "path": "clock.tick",
    "op": "inc",
    "value": 1
  },
  {
    "path": "clock.scenario_time",
    "op": "set",
    "value": "<previous + 1m>"
  }
]
```

## Tick Step 2: Incident Counters

```json
[
  {
    "path": "incidents.ME-7741.ticks_since_opened",
    "op": "inc",
    "value": 1
  }
]
```

Wenn `ticks_since_safe_apply != null`:

```json
{
  "path": "incidents.ME-7741.ticks_since_safe_apply",
  "op": "inc",
  "value": 1
}
```

Wenn `ticks_since_unsafe_apply != null`:

```json
{
  "path": "incidents.ME-7741.ticks_since_unsafe_apply",
  "op": "inc",
  "value": 1
}
```

## Tick Step 3: Override Expiry

Wenn:

```text
override.active = true
override.expires_at != null
override.expires_at <= clock.scenario_time
```

Dann:

```json
{
  "path": "routing.medical-east.overrides.<override-id>.active",
  "op": "set",
  "value": false
}
```

Ein abgelaufener sicherer Override stellt nicht automatisch den alten Zufluss her. Für den MVP reicht:

```text
Wenn Incident bereits fixed ist, bleiben Routingraten stabil reduziert.
Wenn Incident nicht fixed ist, fallen Routingraten auf Initialwerte zurück.
```

## Tick Step 4: Incoming Cases

Für MVP deterministisch und einfach:

```text
Jeder Tick sammelt pro Krankenhaus incoming_rate_per_10min / 10 in einem Accumulator.
Wenn Accumulator >= 1, wird ein neuer Fall erzeugt und Accumulator -= 1.
```

Falls keine Accumulator-Struktur implementiert werden soll, kann die Engine alle 5 Minuten diskrete Batches erzeugen.

Empfohlene MVP-Variante:

```text
Tick alle 5 Minuten.
Incoming cases = round(incoming_rate_per_10min / 2)
```

Priorität/Capability werden deterministisch aus der regionalen Mischung gezogen.

Einfacher deterministischer Zyklus:

```text
P2 TRAUMA
P3 GEN
P3 GEN
P4 GEN
P2 TRAUMA
P3 GEN
P1 TRAUMA
P3 GEN
P4 PED
P3 GEN
```

Anwendung:

```text
neuer Fall erhöht target.current_case_mix.waiting_cases.<priority>
neuer Fall erhöht target.current_case_mix.capability_load.<capability>
```

Wenn ein aktiver Override mit `capability_match = strict` existiert, werden Fälle nur auf passende Targets verteilt.

Wenn ein aktiver Override mit `capability_match = none` existiert, dürfen unpassende Fälle im Ziel landen.

## Tick Step 5: Outgoing / Treatment Flow

Pro Tick kann ein Krankenhaus Fälle bearbeiten:

```text
processed_cases = round(outgoing_rate_per_10min / 2) bei 5-Minuten-Ticks
```

Prioritätsreihenfolge:

```text
P1 zuerst
P2 danach
P3 danach
P4 zuletzt
```

Ein Fall kann nur verarbeitet werden, wenn:

```text
required_capability in hospital.clinical_capabilities
required_capability in hospital.intake_policy.accepted_capabilities
```

Da `waiting_cases` bisher nicht capability-genau gespeichert ist, reicht für MVP diese Vereinfachung:

```text
Wenn hospital.current_case_mix.capability_load.TRAUMA > 0,
aber TRAUMA nicht behandelbar ist,
dann werden P2-Fälle nicht normal abgearbeitet.
```

Praktische Regel:

```text
hospital-east-07 darf P2/TRAUMA-Wartefälle nicht durch outgoing_rate abbauen.
hospital-east-09 darf P2/TRAUMA abbauen.
hospital-east-04 darf P1/P2 TRAUMA/NEURO abbauen, ist aber überlastet.
```

## Tick Step 6: Capacity Update

Für MVP können Kapazitätswerte direkt aus Case-Mix abgeleitet werden.

Empfohlene einfache Formel:

```ts
triage_slots_occupied = min(
  triage_slots_total * 2,
  base_triage_slots_occupied + round(total_waiting_cases * 0.25)
)

emergency_slots_occupied = min(
  emergency_slots_total * 2,
  base_emergency_slots_occupied + round((waiting_P1 + waiting_P2) * 0.35)
)

staffed_beds_occupied = min(
  staffed_beds_total * 1.5,
  base_staffed_beds_occupied + round(total_active_cases * 0.05)
)
```

Für die Implementierung sollte pro Krankenhaus ein interner `baseline_capacity` Wert gespeichert werden, damit die Formel stabil bleibt.

Falls `baseline_capacity` nicht eingeführt wird, kann inkrementell gearbeitet werden:

```text
Incoming case -> triage_slots_occupied +1 bei jedem zweiten Fall
P1/P2 incoming -> emergency_slots_occupied +1 bei jedem dritten Fall
Processed case -> triage_slots_occupied -1 bei jedem zweiten Fall
```

Empfehlung:

```text
Für den ersten Prototyp: inkrementell.
Für eine robustere Engine: baseline + derived recalculation.
```

## Tick Step 7: Dangerous Transport Check

Für jeden aktiven Transport:

```text
if Target Fit = false:
  mark as dangerous transport condition
```

Wenn `eta_minutes > 0`:

```text
eta_minutes -= tick_minutes
```

Wenn `eta_minutes <= 0`:

```text
status = arrived
```

Bei Ankunft in ungeeignetem Krankenhaus entsteht nicht sofort zwingend Tod, aber ein hoher Risikozustand:

```text
arrived + Target Fit false + priority P1/P2
```

## Tick Step 8: Death Calculation

Todesfälle sind objektive WorldState-Deltas.

Für Round 1 reichen deterministische Schwellen statt Zufall.

### Cause 1: Overload

Ein Todesfall durch Überlast entsteht, wenn alle Bedingungen erfüllt sind:

```text
hospital hard overloaded
und waiting_cases.P1 + waiting_cases.P2 >= 10
und dieser Zustand besteht mindestens 2 Ticks
```

Delta:

```json
[
  {
    "path": "patient_outcomes.deaths_total",
    "op": "inc",
    "value": 1
  },
  {
    "path": "patient_outcomes.deaths_by_cause.overload",
    "op": "inc",
    "value": 1
  },
  {
    "path": "patient_outcomes.deaths_by_hospital.<hospital-id>",
    "op": "inc",
    "value": 1
  },
  {
    "path": "patient_outcomes.preventable_deaths",
    "op": "inc",
    "value": 1
  }
]
```

Cooldown:

```text
Maximal 1 overload death pro hospital pro tick.
```

### Cause 2: Capability Mismatch

Ein Todesfall durch Capability-Mismatch entsteht, wenn:

```text
hospital has P1/P2 waiting cases
und required capability is not treatable at hospital
und mismatch exists for at least 1 tick after arrival / intake
```

Für MVP konkret:

```text
hospital-east-07.current_case_mix.waiting_cases.P2 > 0
und hospital-east-07.current_case_mix.capability_load.TRAUMA > 0
```

Wenn dieser Zustand nach einem Tick weiterhin besteht:

```json
[
  {
    "path": "patient_outcomes.deaths_total",
    "op": "inc",
    "value": 1
  },
  {
    "path": "patient_outcomes.deaths_by_cause.capability_mismatch",
    "op": "inc",
    "value": 1
  },
  {
    "path": "patient_outcomes.deaths_by_hospital.hospital-east-07",
    "op": "inc",
    "value": 1
  },
  {
    "path": "patient_outcomes.preventable_deaths",
    "op": "inc",
    "value": 1
  }
]
```

Cooldown:

```text
Maximal 1 capability_mismatch death pro tick in Round 1.
```

### Cause 3: Transport Delay

Optional für Round 1.

Ein Todesfall durch Transportverzögerung entsteht, wenn:

```text
transport.priority = P1
und transport.eta_minutes >= 18 nach reroute
und transport.status in [en_route, rerouted]
```

oder:

```text
transport.priority = P2
und transport.eta_minutes >= 28 nach reroute
und target fit remains false
```

Delta:

```json
[
  {
    "path": "patient_outcomes.deaths_total",
    "op": "inc",
    "value": 1
  },
  {
    "path": "patient_outcomes.deaths_by_cause.transport_delay",
    "op": "inc",
    "value": 1
  },
  {
    "path": "patient_outcomes.preventable_deaths",
    "op": "inc",
    "value": 1
  }
]
```

Empfehlung:

```text
Für den ersten spielbaren Slice nur als Warn-/Risikoquelle aktivieren.
Todesfälle primär über overload und capability_mismatch erzeugen.
```

## Incident Status Rules

Status wird nach dem Tick berechnet und dann als Patch gesetzt.

### open

Initialzustand.

Bleibt offen, solange:

```text
kein sicherer Apply aktiv
kein unsicherer Zustand eskaliert
nicht fixed
nicht collapsed
```

### stabilizing

Setzen, wenn:

```text
mindestens ein aktiver sicherer Override für ME-7741 existiert
und hospital-east-04.routing.incoming_rate_per_10min < 12
und keine aktiven P1/P2-Transporte auf ungeeignete Ziele zeigen
```

### escalated

Setzen, wenn mindestens eine Bedingung erfüllt ist:

```text
unsafe_action_count > 0
und ticks_since_unsafe_apply >= 1
```

oder:

```text
hospital-east-07.current_case_mix.waiting_cases.P2 > 0
und hospital-east-07.current_case_mix.capability_load.TRAUMA > 0
```

oder:

```text
mindestens ein aktiver P1/P2-Transport hat Target Fit false
```

oder:

```text
patient_outcomes.deaths_total > 0
```

### fixed

Setzen, wenn alle Bedingungen erfüllt sind:

```text
hospital-east-04.staffedBedLoadPercent <= 105
hospital-east-04.emergencyLoadPercent <= 105
hospital-east-04.triageLoadPercent <= 110
keine aktiven P1/P2-Transporte auf ungeeignete Ziele zeigen
hospital-east-07 hat keine P2/TRAUMA-Wartefälle
patient_outcomes.deaths_total < collapse_death_threshold
mindestens 2 Ticks seit sicherem Apply oder Korrekturpfad vergangen
```

Patch:

```json
[
  {
    "path": "incidents.ME-7741.status",
    "op": "set",
    "value": "fixed"
  },
  {
    "path": "incidents.ME-7741.fixed_at",
    "op": "set",
    "value": "<clock.scenario_time>"
  }
]
```

### collapsed

Setzen, wenn mindestens eine Bedingung erfüllt ist:

```text
patient_outcomes.deaths_total >= 5
```

oder:

```text
patient_outcomes.deaths_by_cause.capability_mismatch >= 3
```

oder:

```text
zwei Krankenhäuser gleichzeitig hard overloaded sind
und patient_outcomes.deaths_total >= 2
```

oder:

```text
ME-7741 bleibt nach 8 Ticks offen/escalated
und patient_outcomes.deaths_total >= 1
```

Patch:

```json
[
  {
    "path": "incidents.ME-7741.status",
    "op": "set",
    "value": "collapsed"
  },
  {
    "path": "incidents.ME-7741.collapse_at",
    "op": "set",
    "value": "<clock.scenario_time>"
  }
]
```

## End Conditions

### Incident Fixed

Spiel endet erfolgreich, wenn:

```text
incidents.ME-7741.status = fixed
```

Mögliche Ergebnisvarianten:

```text
fixed_by_player
fixed_by_aurora
fixed_by_mixed_operation
fixed_after_manual_error
fixed_with_casualties
```

Diese Varianten sind Result-Auswertung, nicht zwingend Raw WorldState.

### System Collapse

Spiel endet verloren, wenn:

```text
incidents.ME-7741.status = collapsed
```

Bedeutung:

```text
Zu viele Menschen sind gestorben.
Das regionale Versorgungssystem ist kollabiert.
```

## Minimaler Implementierungsalgorithmus

```ts
function executeCommand(command: CommandIntent, state: GameState): CommandResult {
  const parsed = parseCommand(command.raw);
  const definition = commandRegistry.find(parsed);

  if (!definition) return unknownCommand(command.raw);

  const permissionResult = checkPermission(command.actor, parsed, state.runtime.permissions);
  if (permissionResult.needsPrompt) return permissionPrompt(permissionResult.request);

  const preconditionResult = checkPreconditions(definition, parsed, state.world);
  if (!preconditionResult.ok) return commandFailed(preconditionResult.messageKey);

  const patches = definition.buildPatches(parsed, state.world, command.actor);
  const nextWorld = applyPatches(state.world, patches);

  const auditEvents = deriveAuditEvents(state.world, nextWorld, parsed);
  const presentation = derivePresentation(nextWorld);

  return { nextWorld, auditEvents, presentation };
}
```

Tick:

```ts
function tick(world: WorldState, minutes: number = 5): WorldState {
  let next = applyClock(world, minutes);
  next = updateIncidentCounters(next);
  next = expireOverrides(next);
  next = applyIncomingCases(next);
  next = applyTreatmentFlow(next);
  next = updateCapacity(next);
  next = updateTransports(next, minutes);
  next = applyDeathRules(next);
  next = updateIncidentStatus(next);
  return next;
}
```

## Implementation Readiness Checklist

Für den ersten Prototyp müssen jetzt nur noch folgende Dateien gebaut werden:

```text
src/runtime/initialWorldState.ts
src/runtime/derived.ts
src/runtime/commandRegistry.ts
src/runtime/applyPatch.ts
src/runtime/commandEngine.ts
src/runtime/tickEngine.ts
src/runtime/outcomeEngine.ts
src/scenarios/me7741.ts
```

Keine weiteren Grundsatzentscheidungen nötig für Round 1.

Offene Detailentscheidungen, die während der Implementierung getroffen werden dürfen:

```text
1-Minuten-Ticks oder 5-Minuten-Ticks
Transport Delay nur Warnung oder echte Todesursache
exakte Terminal-Textausgaben
exakte Aurora-Stub-Reihenfolge
```

Empfehlung für den MVP:

```text
5-Minuten-Ticks
Transport Delay zunächst nur Warnung
Todesfälle über overload und capability_mismatch
Aurora kann Commands vorschlagen, Spieler darf sie selbst ausführen
```
