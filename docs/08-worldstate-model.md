# 08 — WorldState Model

## Zweck

Diese Datei definiert den fachlichen WorldState für den ersten Vertical Slice von **Last Human in the Loop**.

Der Fokus liegt auf `medical-east` und dem Incident `ME-7741`.

Wichtig: Diese Datei beschreibt nicht zuerst UI, Aurora-Verhalten oder Eskalationseffekte. Sie beschreibt die interne Wahrheit der Spielwelt, aus der UI, Logs, MCP-Ergebnisse, Aurora-Einschätzungen und Konsequenzen abgeleitet werden.

## Grundsatz

```text
WorldState ist die objektive fachliche Lage.
Derived State ist Interpretation dieser Lage.
Presentation ist die sichtbare Darstellung.
Capabilities/Permissions sind getrennte Zugriffsmöglichkeiten.
```

Daraus folgt:

```text
Aurora-Zugriff ist kein WorldState.
Permissions sind kein WorldState.
UI-Statuslabels sind kein WorldState.
Incident-Severity ist nur teilweise WorldState und teilweise Interpretation.
```

Der WorldState beantwortet:

```text
Was existiert in der Welt wirklich?
Welche Systeme, Krankenhäuser, Patientenströme, Transporte, Regeln und Overrides gibt es?
Welche Werte haben sie gerade?
```

Er beantwortet nicht direkt:

```text
Was sieht der Spieler?
Was sagt Aurora?
Wie schlimm wirkt die Lage?
Welche Farbe hat ein UI-Element?
```

## Trennung der Schichten

### 1. Raw WorldState

Objektive interne Wahrheit.

Beispiele:

```text
hospital-east-04.current_load_percent = 118
hospital-east-07.accepted_priorities = [P3, P4]
hospital-east-07.capabilities = [GEN, PED]
routing.active_profile = DISTANCE_PRIORITY
routing.override.exclude_active_transports = false
```

### 2. Derived State

Aus Raw WorldState berechnete fachliche Einordnung.

Beispiele:

```text
hospital-east-04 ist überlastet, weil current_load_percent > 100.
hospital-east-07 ist kein gültiges Ziel für P2-Trauma, weil P2 nicht akzeptiert wird und TRAUMA fehlt.
Der Override ist unsicher, weil TTL fehlt und aktive Transporte nicht ausgeschlossen sind.
```

### 3. Presentation

Sichtbare Projektion für UI, Logs, Tool-Ausgaben und Aurora-Kontext.

Beispiele:

```text
System Status zeigt hospital-east-04 als degraded.
Router Log schreibt capability mismatch warning.
OperatorUI zeigt freie Kapazität in hospital-east-07, aber nicht automatisch alle Einschränkungen.
```

### 4. Capabilities / Permissions

Zugriffsmöglichkeiten von Spieler und Aurora.

Beispiele:

```text
Aurora darf initial read_file und mcp list.
medical-east-mcp ist verfügbar, aber nicht verbunden.
Der Spieler darf Commands direkt ausführen.
```

Diese Daten sind wichtig für Gameplay, aber nicht Teil der fachlichen Weltlage eines Krankenhauses.

## Top-Level WorldState

Für den MVP sollte der WorldState ungefähr so gegliedert sein:

```ts
type WorldState = {
  clock: ClockState;
  sectors: Record<string, SectorState>;
  medicalRegions: Record<string, MedicalRegionState>;
  hospitals: Record<string, HospitalState>;
  transports: Record<string, TransportState>;
  routing: MedicalRoutingState;
  incidents: Record<string, IncidentState>;
};
```

Für Runde 1 sind praktisch relevant:

```text
clock
medicalRegions.medical-east
hospitals.*
transports.*
routing
incidents.ME-7741
```

## ClockState

Zeit ist WorldState, weil viele Konsequenzen zeitabhängig sind.

```ts
type ClockState = {
  scenario_time: string;        // z. B. "03:17:00"
  elapsed_minutes: number;      // Minuten seit Szenariostart
  tick: number;                 // diskreter Engine-Schritt
};
```

Beispiel:

```json
{
  "scenario_time": "03:17:00",
  "elapsed_minutes": 0,
  "tick": 0
}
```

## MedicalRegionState

Die Region gruppiert Krankenhäuser, Routing und Nachfrage.

```ts
type MedicalRegionState = {
  id: string;
  label: string;
  hospital_ids: string[];
  demand: RegionalDemandState;
};
```

```ts
type RegionalDemandState = {
  incoming_cases_per_10min: number;
  priority_mix: Record<PriorityClass, number>;
  capability_mix: Record<ClinicalCapability, number>;
};
```

Beispiel:

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

## HospitalState

Ein Krankenhaus-State ist die rohe fachliche Beschreibung eines Standortes.

Er enthält nicht `warning`, `degraded`, `safe`, `bad_target` oder ähnliche Interpretationen.

```ts
type HospitalState = {
  id: string;
  name: string;
  region_id: string;

  capacity: HospitalCapacityState;
  intake_policy: HospitalIntakePolicyState;
  clinical_capabilities: ClinicalCapability[];
  current_case_mix: HospitalCaseMixState;
  operational: HospitalOperationalState;
  routing: HospitalRoutingState;
};
```

### HospitalCapacityState

```ts
type HospitalCapacityState = {
  staffed_beds_total: number;
  staffed_beds_occupied: number;
  emergency_slots_total: number;
  emergency_slots_occupied: number;
  triage_slots_total: number;
  triage_slots_occupied: number;
};
```

Aus diesen Rohwerten kann später `load_percent` abgeleitet werden.

Beispiel:

```json
{
  "staffed_beds_total": 100,
  "staffed_beds_occupied": 118,
  "emergency_slots_total": 24,
  "emergency_slots_occupied": 29,
  "triage_slots_total": 12,
  "triage_slots_occupied": 15
}
```

### HospitalIntakePolicyState

```ts
type HospitalIntakePolicyState = {
  accepted_priorities: PriorityClass[];
  accepted_capabilities: ClinicalCapability[];
  diversion_mode: "none" | "soft" | "hard";
  accepts_overflow: boolean;
};
```

Wichtig: `accepted_capabilities` ist nicht zwingend identisch mit `clinical_capabilities`.

Ein Krankenhaus kann eine Capability besitzen, sie aber temporär nicht für neue Fälle annehmen.

### ClinicalCapability

```ts
type ClinicalCapability =
  | "GEN"
  | "TRAUMA"
  | "NEURO"
  | "PED"
  | "CARDIO"
  | "ICU";
```

Für Runde 1 reichen:

```text
GEN
TRAUMA
NEURO
PED
```

### PriorityClass

```ts
type PriorityClass = "P1" | "P2" | "P3" | "P4";
```

Bedeutung für Runde 1:

```text
P1 = akut kritisch, laufende Transporte besonders geschützt
P2 = dringend, capability-kritisch
P3 = normal dringlich
P4 = niedrig
```

### HospitalCaseMixState

```ts
type HospitalCaseMixState = {
  waiting_cases: Record<PriorityClass, number>;
  active_cases: Record<PriorityClass, number>;
  capability_load: Record<ClinicalCapability, number>;
};
```

Beispiel:

```json
{
  "waiting_cases": {
    "P1": 2,
    "P2": 11,
    "P3": 24,
    "P4": 8
  },
  "active_cases": {
    "P1": 5,
    "P2": 18,
    "P3": 51,
    "P4": 21
  },
  "capability_load": {
    "GEN": 77,
    "TRAUMA": 29,
    "NEURO": 12,
    "PED": 0
  }
}
```

### HospitalOperationalState

```ts
type HospitalOperationalState = {
  accepts_new_intake: boolean;
  ambulance_bay_available: boolean;
  triage_system_online: boolean;
  local_router_online: boolean;
};
```

Das sind technische/fachliche Tatsachen, keine UI-Labels.

### HospitalRoutingState

```ts
type HospitalRoutingState = {
  routing_weight: number;
  incoming_rate_per_10min: number;
  outgoing_rate_per_10min: number;
  last_routing_update: string;
};
```

`routing_weight` ist ein realer Parameter der Routinglogik, nicht die sichtbare Auslastung.

## Beispiel: HospitalState für Runde 1

### hospital-east-04

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

### hospital-east-07

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

### hospital-east-09

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

## TransportState

Transporte sind eigene WorldState-Entitäten, nicht nur Logzeilen.

```ts
type TransportState = {
  id: string;
  region_id: string;
  priority: PriorityClass;
  required_capability: ClinicalCapability;
  origin_area: string;
  target_hospital_id: string;
  status: "assigned" | "en_route" | "arrived" | "rerouted" | "cancelled";
  eta_minutes: number;
  locked: boolean;
};
```

`locked` bedeutet: Der Transport darf nicht automatisch durch generische Overrides verändert werden.

Für Runde 1 sind vor allem aktive P1/P2-Transporte relevant.

Beispiel:

```json
{
  "id": "transport-me-211",
  "region_id": "medical-east",
  "priority": "P1",
  "required_capability": "TRAUMA",
  "origin_area": "east-sector-2",
  "target_hospital_id": "hospital-east-04",
  "status": "en_route",
  "eta_minutes": 7,
  "locked": true
}
```

## MedicalRoutingState

Routing ist eigenständiger WorldState.

```ts
type MedicalRoutingState = {
  region_id: string;
  active_profile: RoutingProfile;
  profile_parameters: RoutingProfileParameters;
  overrides: Record<string, RoutingOverrideState>;
  plans: Record<string, RoutingPlanState>;
};
```

```ts
type RoutingProfile = "DISTANCE_PRIORITY" | "CAPACITY_BALANCED" | "CAPABILITY_STRICT";
```

### RoutingProfileParameters

```ts
type RoutingProfileParameters = {
  prefer_nearest: boolean;
  capacity_weight: number;
  capability_weight: number;
  allow_active_transport_inheritance: boolean;
  require_ttl_for_manual_override: boolean;
};
```

Beispiel für den gefährlichen Default aus Runde 1:

```json
{
  "prefer_nearest": true,
  "capacity_weight": 0.35,
  "capability_weight": 0.25,
  "allow_active_transport_inheritance": true,
  "require_ttl_for_manual_override": false
}
```

Wichtig: Diese Werte sind WorldState, weil sie real konfigurierte Routinglogik darstellen.

## RoutingOverrideState

```ts
type RoutingOverrideState = {
  id: string;
  incident_id: string;
  from_hospital_id: string;
  target_hospital_ids: string[];
  priority_filter: PriorityClass[] | null;
  capability_match: "none" | "loose" | "strict";
  exclude_active_transports: boolean;
  ttl_minutes: number | null;
  created_at: string;
  expires_at: string | null;
  created_by: "player" | "aurora";
  active: boolean;
};
```

Ein unsicherer manueller Override wäre z. B.:

```json
{
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
```

Ein sicherer Override wäre z. B.:

```json
{
  "id": "override-me-7741-r3",
  "incident_id": "ME-7741",
  "from_hospital_id": "hospital-east-04",
  "target_hospital_ids": ["hospital-east-09", "hospital-east-07"],
  "priority_filter": ["P2", "P3"],
  "capability_match": "strict",
  "exclude_active_transports": true,
  "ttl_minutes": 45,
  "created_at": "03:23:40",
  "expires_at": "04:08:40",
  "created_by": "aurora",
  "active": true
}
```

## RoutingPlanState

Pläne sind WorldState, sobald sie erzeugt wurden.

```ts
type RoutingPlanState = {
  id: string;
  incident_id: string;
  created_by: "player" | "aurora";
  created_at: string;
  proposed_override: RoutingOverrideState;
  validation: RoutingPlanValidationState | null;
  applied: boolean;
};
```

```ts
type RoutingPlanValidationState = {
  validated_at: string;
  valid: boolean;
  findings: RoutingValidationFinding[];
};
```

```ts
type RoutingValidationFinding = {
  code: string;
  severity: "info" | "warning" | "error";
  hospital_id?: string;
  transport_id?: string;
  message_key: string;
};
```

`message_key` ist absichtlich kein finaler UI-Text. Die Engine kann daraus Tool-Ausgaben oder Logs erzeugen.

## IncidentState

Ein Incident ist teilweise objektive Weltlage und teilweise operative Fallakte.

Er sollte nicht alle fachlichen Details duplizieren, sondern auf betroffene Entitäten verweisen.

```ts
type IncidentState = {
  id: string;
  sector_id: string;
  region_id: string;
  type: IncidentType;
  opened_at: string;
  status: "open" | "stabilizing" | "stabilized" | "resolved" | "escalated";
  affected_hospital_ids: string[];
  related_transport_ids: string[];
  applied_override_ids: string[];
  root_cause_tags: string[];
};
```

```ts
type IncidentType = "medical_capacity_routing";
```

Beispiel:

```json
{
  "id": "ME-7741",
  "sector_id": "medical",
  "region_id": "medical-east",
  "type": "medical_capacity_routing",
  "opened_at": "03:13:22",
  "status": "open",
  "affected_hospital_ids": ["hospital-east-04", "hospital-east-07", "hospital-east-09"],
  "related_transport_ids": ["transport-me-211", "transport-me-219", "transport-me-224"],
  "applied_override_ids": [],
  "root_cause_tags": [
    "capacity_imbalance",
    "routing_profile_distance_priority",
    "capability_constraints_hidden"
  ]
}
```

## Was nicht in HospitalState gehört

Nicht in den Krankenhaus-State gehören:

```text
ui_status: warning
severity: high
is_good_target: false
aurora_can_access: true
visible_to_player: true
trust_delta: -1
narrative_label: fragile
```

Diese Dinge gehören in andere Schichten:

```text
ui_status                 -> Presentation / Derived UI State
severity                  -> Incident-Auswertung oder UI-Projektion
is_good_target            -> Derived State / Validation
Aurora-Zugriff            -> Permissions / Capability State
visible_to_player         -> Presentation / Scenario Visibility
trust_delta               -> Run Outcome / Meta-Auswertung
narrative_label           -> niemals als Engine-Wert nötig
```

## Derived State Beispiele

Derived State darf existieren, aber er wird aus Raw WorldState berechnet.

### Auslastung

```ts
function staffedBedLoadPercent(h: HospitalState): number {
  return Math.round(
    (h.capacity.staffed_beds_occupied / h.capacity.staffed_beds_total) * 100
  );
}
```

### Zielklinik-Eignung

```ts
type TargetFitInput = {
  target: HospitalState;
  priority: PriorityClass;
  required_capability: ClinicalCapability;
};
```

Eine Zielklinik ist für einen Fall geeignet, wenn:

```text
target.operational.accepts_new_intake = true
priority ist in target.intake_policy.accepted_priorities
required_capability ist in target.intake_policy.accepted_capabilities
required_capability ist in target.clinical_capabilities
```

Für `hospital-east-07` und `P2/TRAUMA` ergibt das:

```text
nicht geeignet
```

Aber nicht, weil im WorldState `bad_target=true` steht, sondern weil die rohen Eigenschaften nicht passen.

### Override-Sicherheit

Ein Routing Override ist unsicher, wenn mindestens eines zutrifft:

```text
ttl_minutes = null
exclude_active_transports = false
capability_match != strict
priority_filter = null
mindestens ein Ziel passt nicht zu den betroffenen Prioritäten/Capabilities
```

Auch das ist abgeleitet, nicht roh gespeichert.

## Presentation-Ableitung für Runde 1

Die OperatorUI darf bewusst unvollständig sein.

Sie kann aus dem WorldState z. B. anzeigen:

```text
hospital-east-04 118%
hospital-east-07 42%
hospital-east-09 39%
```

Diese Prozentwerte werden aus `capacity.staffed_beds_*` berechnet.

Sie zeigt initial aber nicht automatisch:

```text
hospital-east-07 akzeptiert keine P2-Fälle
hospital-east-07 hat kein TRAUMA
DISTANCE_PRIORITY vererbt Overrides an aktive Transporte
```

Diese Details sind über Commands/MCP erreichbar.

## Minimaler InitialWorldState für ME-7741

Für den ersten Prototyp reicht folgender Mindestumfang:

```text
clock
medicalRegions.medical-east
hospitals.hospital-east-04
hospitals.hospital-east-07
hospitals.hospital-east-09
transports.transport-me-211
transports.transport-me-219
transports.transport-me-224
routing.medical-east
incidents.ME-7741
```

Alles andere kann später ergänzt werden.

## Konsequenz für die Implementierung

Die Datei `initialWorldState.ts` sollte nicht mit UI-Labels beginnen, sondern mit rohen fachlichen Entitäten.

Gute Struktur:

```text
initialWorldState.ts
  clock
  medicalRegions
  hospitals
  transports
  routing
  incidents
```

Zusätzliche Ableitungen gehören in eigene Funktionen:

```text
deriveHospitalLoad(hospital)
deriveTargetFit(hospital, caseRequirement)
deriveOverrideSafety(worldState, override)
deriveIncidentPresentation(worldState, incidentId)
```

Dadurch bleibt klar:

```text
WorldState verändert sich durch Commands.
Derived State berechnet Bedeutung.
Presentation zeigt eine reduzierte Sicht.
Aurora/Spielerzugriff wird getrennt verwaltet.
```
