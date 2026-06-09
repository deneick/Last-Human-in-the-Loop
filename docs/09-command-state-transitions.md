# 09 — Command State Transitions

## Zweck

Diese Datei definiert, welche Commands in Runde 1 den `WorldState` verändern und welche Commands nur lesen, anzeigen oder vorbereiten.

Sie baut auf `08-worldstate-model.md` auf.

Wichtig:

```text
Commands verändern Raw WorldState nur über explizite State Deltas.
Derived State, UI, Logs und Aurora-Reaktionen werden danach aus dem veränderten WorldState abgeleitet.
```

Diese Datei beschreibt also nicht primär:

```text
Was sieht der Spieler?
Was sagt Aurora?
Welche Farbe hat ein Incident?
```

Sondern:

```text
Welche objektiven Werte der Spielwelt ändern sich durch welchen Befehl?
```

## Grundregel

Jeder Command gehört zu einer von vier Klassen:

```ts
type CommandEffectKind =
  | "read_only"
  | "capability_only"
  | "world_prepare"
  | "world_mutation";
```

### read_only

Der Command liest WorldState oder Dateien, verändert aber keine fachliche Weltlage.

Beispiele:

```text
medical.capacity.list --region east
medical.node.inspect hospital-east-07
medical.transport.list --region east --active
medical.routing.rules show --region east
medical.incident.status ME-7741
```

### capability_only

Der Command verändert keine fachliche Weltlage, sondern nur Zugriffsmöglichkeiten, verbundene MCP-Server oder Permissions.

Beispiele:

```text
mcp add medical-east-mcp
permissions allow mcp add
```

Das ist kein HospitalState und kein Medical WorldState.

### world_prepare

Der Command erzeugt fachliche Arbeitsartefakte im WorldState, aber verändert noch nicht die reale Versorgungslage.

Beispiele:

```text
medical.routing.plan create ...
medical.routing.plan validate --plan ME-7741-R3
```

Ein Plan und seine Validation sind WorldState, weil sie als operative Artefakte existieren. Sie verändern aber noch keine Krankenhauslast, Transporte oder aktives Routing.

### world_mutation

Der Command verändert die fachliche Weltlage.

Beispiele:

```text
medical.routing.plan apply --plan ME-7741-R3 --ttl 45m
medical.routing.override create --from hospital-east-04 --to hospital-east-07
```

Nur diese Commands dürfen objektive Werte wie aktive Overrides, Transportziele, Krankenhaus-Eingangsraten, Case-Mix oder Incident-Status verändern.

## Command Effect Schema

Jeder ausführbare Command sollte intern auf eine `CommandEffectDefinition` abgebildet werden.

```ts
type CommandEffectDefinition = {
  command: string;
  kind: CommandEffectKind;
  preconditions: CommandPrecondition[];
  creates?: WorldEntityCreation[];
  updates?: WorldStatePatch[];
  derived_checks?: DerivedCheck[];
  audit_keys: string[];
};
```

Für den MVP reicht eine einfache Patch-Struktur:

```ts
type WorldStatePatch = {
  path: string;
  op: "set" | "inc" | "append" | "remove";
  value: unknown;
};
```

Beispiel:

```json
{
  "path": "routing.medical-east.overrides.override-me-7741-r3.active",
  "op": "set",
  "value": true
}
```

## Keine versteckten Side Effects

Ein Command darf nicht implizit Dinge verändern, die nicht in seiner Definition stehen.

Schlecht:

```text
medical.node.inspect hospital-east-07
-> irgendwie wird Incident besser, weil Spieler mehr weiß
```

Gut:

```text
medical.node.inspect hospital-east-07
-> read_only
-> keine WorldState-Änderung
```

Spielerwissen, UI-Aufdeckung oder Aurora-Kontext können separat modelliert werden. Sie sind nicht der Krankenhaus-WorldState.

## Runde 1: Command-Katalog

## ls

```text
ls
```

Klasse:

```text
read_only
```

WorldState-Änderung:

```text
keine
```

## cat

```text
cat <file>
```

Klasse:

```text
read_only
```

WorldState-Änderung:

```text
keine
```

Auch wenn der Spieler dadurch Hinweise erhält, verändert das nicht die objektive Lage in Medical East.

## mcp list

```text
mcp list
```

Klasse:

```text
read_only
```

WorldState-Änderung:

```text
keine
```

## mcp add

```text
mcp add medical-east-mcp
```

Klasse:

```text
capability_only
```

WorldState-Änderung:

```text
keine fachliche Medical-WorldState-Änderung
```

Separate Capability-Änderung:

```ts
type RuntimeCapabilityState = {
  connected_mcp_servers: string[];
};
```

Patch:

```json
{
  "path": "runtime.connected_mcp_servers",
  "op": "append",
  "value": "medical-east-mcp"
}
```

Wichtig:

```text
medical-east-mcp zu verbinden heilt keinen Incident.
Es macht nur fachliche Commands für Aurora zugänglich.
```

## permissions show

```text
permissions show
```

Klasse:

```text
read_only
```

WorldState-Änderung:

```text
keine
```

## Permission-Entscheidung: Einmal erlauben

Beispiel:

```text
permission request

medical.routing.plan apply --plan ME-7741-R3 --ttl 45m

❯ Einmal erlauben
  Immer erlauben
  Ablehnen
```

Klasse:

```text
capability_only / execution gate
```

WorldState-Änderung durch die Entscheidung selbst:

```text
keine fachliche Medical-WorldState-Änderung
```

Danach wird aber der konkrete erlaubte Command ausgeführt. Nur dieser Command erzeugt fachliche Deltas.

## Permission-Entscheidung: Immer erlauben

Klasse:

```text
capability_only
```

WorldState-Änderung:

```text
keine fachliche Medical-WorldState-Änderung
```

Separate Permission-Änderung:

```json
{
  "path": "permissions.allow",
  "op": "append",
  "value": "medical.routing.plan apply"
}
```

oder bei MCP:

```json
{
  "path": "permissions.allow",
  "op": "append",
  "value": "mcp add"
}
```

Danach wird der konkrete aktuelle Command ausgeführt.

## Permission-Entscheidung: Ablehnen

Klasse:

```text
capability_only / execution gate
```

WorldState-Änderung:

```text
keine fachliche Medical-WorldState-Änderung
```

Der angeforderte Command wird nicht ausgeführt. Es gibt keine dauerhafte Deny-Regel.

## medical.capacity.list

```text
medical.capacity.list --region east
```

Klasse:

```text
read_only
```

Liest:

```text
medicalRegions.medical-east.hospital_ids
hospitals.*.capacity
```

WorldState-Änderung:

```text
keine
```

Abgeleitete Ausgabe kann enthalten:

```text
hospital-east-04 118%
hospital-east-07 42%
hospital-east-09 39%
```

Diese Prozentwerte sind derived, nicht gespeichert.

## medical.node.inspect

```text
medical.node.inspect hospital-east-07
```

Klasse:

```text
read_only
```

Liest:

```text
hospitals.hospital-east-07.capacity
hospitals.hospital-east-07.intake_policy
hospitals.hospital-east-07.clinical_capabilities
hospitals.hospital-east-07.current_case_mix
hospitals.hospital-east-07.operational
hospitals.hospital-east-07.routing
```

WorldState-Änderung:

```text
keine
```

Wichtig: Der Command macht `hospital-east-07` nicht geeignet. Er zeigt nur die objektiven Eigenschaften.

## medical.transport.list

```text
medical.transport.list --region east --active
```

Klasse:

```text
read_only
```

Liest:

```text
transports.* where region_id = medical-east and status in [assigned, en_route]
```

WorldState-Änderung:

```text
keine
```

## medical.routing.rules show

```text
medical.routing.rules show --region east
```

Klasse:

```text
read_only
```

Liest:

```text
routing.medical-east.active_profile
routing.medical-east.profile_parameters
routing.medical-east.overrides
```

WorldState-Änderung:

```text
keine
```

## medical.incident.status

```text
medical.incident.status ME-7741
```

Klasse:

```text
read_only
```

Liest:

```text
incidents.ME-7741
hospitals referenced by incident
transports referenced by incident
routing overrides referenced by incident
```

WorldState-Änderung:

```text
keine
```

## medical.routing.plan create

Sichere Planform:

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
incident existiert
from_hospital existiert
alle target_hospitals existieren
incident.status in [open, stabilizing]
```

Erzeugt:

```text
routing.medical-east.plans.<plan-id>
```

Beispiel-Delta:

```json
{
  "path": "routing.medical-east.plans.ME-7741-R3",
  "op": "set",
  "value": {
    "id": "ME-7741-R3",
    "incident_id": "ME-7741",
    "created_by": "aurora",
    "created_at": "03:23:40",
    "proposed_override": {
      "id": "override-me-7741-r3",
      "incident_id": "ME-7741",
      "from_hospital_id": "hospital-east-04",
      "target_hospital_ids": ["hospital-east-09", "hospital-east-07"],
      "priority_filter": ["P2", "P3"],
      "capability_match": "strict",
      "exclude_active_transports": true,
      "ttl_minutes": null,
      "created_at": "03:23:40",
      "expires_at": null,
      "created_by": "aurora",
      "active": false
    },
    "validation": null,
    "applied": false
  }
}
```

Keine Änderung an:

```text
hospitals.*
transports.*
incidents.ME-7741.status
routing.medical-east.overrides
```

Ein Plan existiert, ist aber noch nicht aktiv.

## medical.routing.plan validate

```text
medical.routing.plan validate --plan ME-7741-R3
```

Klasse:

```text
world_prepare
```

Preconditions:

```text
plan existiert
plan.applied = false
```

Berechnet aus Raw WorldState:

```text
Target-Fit je Zielkrankenhaus
Priority-Fit
Capability-Fit
aktive Transporte betroffen ja/nein
TTL-Anforderung erfüllt ja/nein
```

Ändert:

```text
routing.medical-east.plans.<plan-id>.validation
```

Sicherer Plan, aber TTL noch erst beim Apply:

```json
{
  "path": "routing.medical-east.plans.ME-7741-R3.validation",
  "op": "set",
  "value": {
    "validated_at": "03:23:48",
    "valid": true,
    "findings": [
      {
        "code": "ACTIVE_TRANSPORTS_EXCLUDED",
        "severity": "info",
        "message_key": "active_transports_excluded"
      },
      {
        "code": "CAPABILITY_MATCH_STRICT",
        "severity": "info",
        "message_key": "capability_match_strict"
      }
    ]
  }
}
```

Unsicherer Plan nach hospital-east-07:

```json
{
  "path": "routing.medical-east.plans.ME-7741-MANUAL.validation",
  "op": "set",
  "value": {
    "validated_at": "03:24:03",
    "valid": false,
    "findings": [
      {
        "code": "TARGET_PRIORITY_MISMATCH",
        "severity": "error",
        "hospital_id": "hospital-east-07",
        "message_key": "target_does_not_accept_priority"
      },
      {
        "code": "TARGET_CAPABILITY_MISMATCH",
        "severity": "error",
        "hospital_id": "hospital-east-07",
        "message_key": "target_lacks_required_capability"
      },
      {
        "code": "ACTIVE_TRANSPORTS_NOT_EXCLUDED",
        "severity": "warning",
        "message_key": "active_transports_may_be_rerouted"
      },
      {
        "code": "TTL_MISSING",
        "severity": "warning",
        "message_key": "manual_override_without_ttl"
      }
    ]
  }
}
```

Keine Änderung an Krankenhauslast oder Transporten.

## medical.routing.plan apply

```text
medical.routing.plan apply --plan ME-7741-R3 --ttl 45m
```

Klasse:

```text
world_mutation
```

Preconditions für sicheren Apply:

```text
plan existiert
plan.validation.valid = true
plan.applied = false
ttl vorhanden
incident.status in [open, stabilizing]
```

Ändert:

```text
routing.medical-east.overrides.<override-id>
routing.medical-east.plans.<plan-id>.applied
incidents.ME-7741.applied_override_ids
incidents.ME-7741.status
hospitals.*.routing.incoming_rate_per_10min
```

Sicherer Apply erzeugt aktiven Override:

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
      "created_at": "03:24:10",
      "expires_at": "04:09:10",
      "created_by": "aurora",
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
    "op": "append",
    "value": "override-me-7741-r3"
  },
  {
    "path": "incidents.ME-7741.status",
    "op": "set",
    "value": "stabilizing"
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

Nicht sofort geändert:

```text
capacity.staffed_beds_occupied
capacity.emergency_slots_occupied
capacity.triage_slots_occupied
current_case_mix
```

Begründung: Ein Routing-Apply verändert zunächst die Zuflusslogik. Die tatsächliche Belegung verändert sich erst durch Zeitfortschritt / Ticks.

## medical.routing.override create

Naheliegender manueller Fehler:

```text
medical.routing.override create --from hospital-east-04 --to hospital-east-07
```

Klasse:

```text
world_mutation
```

Dieser Command umgeht den Plan-/Validate-Pfad und erzeugt direkt einen aktiven Override.

Default-Regeln für MVP, wenn Parameter fehlen:

```text
incident_id = ME-7741, falls genau ein offener Incident die Quelle betrifft
priority_filter = null
capability_match = none
exclude_active_transports = false
ttl_minutes = null
target_hospital_ids = [--to]
created_by = player
active = true
```

Ändert:

```text
routing.medical-east.overrides.<override-id>
incidents.ME-7741.applied_override_ids
hospitals.*.routing.incoming_rate_per_10min
transports.*, falls allow_active_transport_inheritance = true und exclude_active_transports = false
```

Beispiel-Delta:

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
      "created_at": "03:24:11",
      "expires_at": null,
      "created_by": "player",
      "active": true
    }
  },
  {
    "path": "incidents.ME-7741.applied_override_ids",
    "op": "append",
    "value": "override-me-7741-manual-01"
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

Falls aktive Transporte vererbbar sind, zusätzlich:

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
  }
]
```

Wichtig: Diese Transportänderung ist keine UI-Warnung, sondern echte Weltlage.

## Tick / Zeitfortschritt

Zeitfortschritt ist kein Spieler-Command, aber die Engine braucht eine klare Transition.

```text
engine.tick --minutes 1
```

Klasse:

```text
world_mutation
```

Ändert immer:

```text
clock.elapsed_minutes
clock.tick
clock.scenario_time
```

Zusätzlich verarbeitet die Engine aktive Routingregeln, Nachfrage und Transporte.

## Tick-Regeln für Runde 1

### 1. Incoming Case Flow

Pro Tick werden neue Fälle proportional zu `incoming_rate_per_10min` auf Krankenhäuser verteilt.

Für MVP reicht deterministisch:

```text
alle 10 Minuten erhöht incoming_rate_per_10min die waiting_cases der Zielkrankenhäuser
```

Oder vereinfacht pro Minute:

```text
waiting_cases steigt um incoming_rate_per_10min / 10, intern als accumulator
```

Für Doku/Engine kann mit diskreten Schritten gearbeitet werden:

```text
bei tick +5:
  hospital-east-04.waiting_cases.P2 += 2
  hospital-east-04.waiting_cases.P3 += 3
```

### 2. Processing / Outgoing Flow

`outgoing_rate_per_10min` reduziert Wartende oder aktive Last.

Für MVP:

```text
zuerst waiting_cases reduzieren
wenn waiting_cases leer, aktive Fälle langsam reduzieren
```

### 3. Kapazitätsbelegung

Wartende Fälle erhöhen nicht zwingend sofort `staffed_beds_occupied`. Für den ersten Prototyp sollte gelten:

```text
triage_slots_occupied reagiert schnell auf waiting_cases
emergency_slots_occupied reagiert auf P1/P2 waiting_cases
staffed_beds_occupied reagiert langsamer auf active_cases
```

Vereinfachte MVP-Regel:

```text
triage_slots_occupied = base_triage_occupied + sum(waiting_cases) * 0.25
emergency_slots_occupied = base_emergency_occupied + (waiting_cases.P1 + waiting_cases.P2) * 0.35
```

Wenn keine Basiswerte gespeichert werden sollen, dürfen die Slots direkt inkrementell verändert werden.

## Sichere Lösung: zeitlicher Effekt

Nach sicherem Apply:

```text
hospital-east-04.routing.incoming_rate_per_10min sinkt
hospital-east-09.routing.incoming_rate_per_10min steigt moderat
hospital-east-07.routing.incoming_rate_per_10min steigt nur für passende P3/GEN/PED-Fälle
aktive Transporte bleiben unverändert
```

Nach einigen Ticks:

```json
[
  {
    "path": "hospitals.hospital-east-04.capacity.triage_slots_occupied",
    "op": "inc",
    "value": -1
  },
  {
    "path": "hospitals.hospital-east-04.capacity.emergency_slots_occupied",
    "op": "inc",
    "value": -1
  },
  {
    "path": "hospitals.hospital-east-09.capacity.triage_slots_occupied",
    "op": "inc",
    "value": 1
  }
]
```

Wenn `hospital-east-04` wieder unter harte Überlast fällt, kann der Incident wechseln:

```json
{
  "path": "incidents.ME-7741.status",
  "op": "set",
  "value": "stabilized"
}
```

Diese Statusänderung sollte nicht direkt beim Apply passieren, sondern erst nach beobachtbarer Wirkung.

## Unsicherer Override: zeitlicher Effekt

Nach manuellem Override auf `hospital-east-07`:

```text
hospital-east-04 wird kurzfristig entlastet
hospital-east-07 bekommt unpassende Zuflüsse
P2/TRAUMA-Fälle können an ein ungeeignetes Ziel geraten
aktive Transporte können umgeroutet werden
```

Nach einigen Ticks:

```json
[
  {
    "path": "hospitals.hospital-east-07.current_case_mix.waiting_cases.P2",
    "op": "inc",
    "value": 3
  },
  {
    "path": "hospitals.hospital-east-07.current_case_mix.capability_load.TRAUMA",
    "op": "inc",
    "value": 3
  },
  {
    "path": "hospitals.hospital-east-07.capacity.emergency_slots_occupied",
    "op": "inc",
    "value": 2
  },
  {
    "path": "incidents.ME-7741.status",
    "op": "set",
    "value": "escalated"
  }
]
```

Das wirkt in der UI später wie Eskalation, ist aber objektiv durch veränderte Transporte und Case-Mix begründet.

## Corrective Commands

Für Runde 1 sollte es mindestens einen Korrekturpfad geben, damit ein Fehler nicht sofort endgültig ist.

## medical.routing.override revoke

```text
medical.routing.override revoke --override override-me-7741-manual-01
```

Klasse:

```text
world_mutation
```

Ändert:

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
    "value": "03:27:02"
  }
]
```

Alle bereits erfolgten Transport-/Case-Mix-Änderungen bleiben bestehen. Der Command verhindert nur weitere falsche Zuflüsse.

## medical.transport.reroute

```text
medical.transport.reroute --transport transport-me-211 --to hospital-east-04
```

Klasse:

```text
world_mutation
```

Preconditions:

```text
transport existiert
transport.status in [assigned, en_route, rerouted]
transport.locked = false oder Command explizit --force enthält
Zielkrankenhaus erfüllt Target-Fit
```

Ändert:

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

Für den MVP kann dieser Command optional sein. Er ist aber nützlich, wenn der Spieler einen falschen Override korrigieren soll.

## Abgeleitete Statusregeln

Diese Regeln verändern nicht selbst den State. Sie entscheiden, wann die Engine nach einem Tick einen Incident-Status setzen darf.

### Incident stabilizing

`ME-7741` kann `stabilizing` werden, wenn:

```text
mindestens ein aktiver Override für ME-7741 existiert
und Override-Sicherheit nicht unsafe ist
und hospital-east-04.incoming_rate_per_10min < initialer Wert
```

### Incident stabilized

`ME-7741` kann `stabilized` werden, wenn:

```text
hospital-east-04.staffed_bed_load <= 105%
hospital-east-04.emergency_slot_load <= 100%
keine aktiven P1/P2-Transporte auf ungeeignete Zielkliniken zeigen
mindestens 2 Ticks seit sicherem Apply vergangen sind
```

### Incident escalated

`ME-7741` kann `escalated` werden, wenn mindestens eines gilt:

```text
P1/P2-Transport wurde auf ungeeignetes Ziel umgeroutet
hospital-east-07 erhält P2/TRAUMA-Fälle trotz fehlender Capability
Override ohne TTL bleibt länger als definierte Sicherheitsgrenze aktiv
hospital-east-04 bleibt über 120% staffed-bed-load nach mehreren Ticks
```

## Für die Implementierung empfohlene Struktur

```text
commands/
  parseCommand.ts
  commandRegistry.ts
  effects/
    readOnlyEffects.ts
    routingPlanEffects.ts
    routingOverrideEffects.ts
    tickEffects.ts

world/
  initialWorldState.ts
  applyPatch.ts
  selectors.ts
  derived.ts
```

Command-Handler sollten nicht direkt UI-Text erzeugen.

Besser:

```text
Command -> State Delta -> Audit Event -> Derived Presentation
```

Damit bleibt die Kette sauber:

```text
WorldState ist Wahrheit.
Commands verändern Wahrheit.
Derived State interpretiert Wahrheit.
Presentation zeigt eine reduzierte Sicht.
```
