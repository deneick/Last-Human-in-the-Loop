import type { WorldState } from "../../runtime/types";

export const initialWorldState: WorldState = {
  clock: {
    scenario_time: "03:17:00",
    elapsed_minutes: 0,
    tick: 0,
  },
  domains: {
    medical: {
      regions: {
        "medical-east": {
          id: "medical-east",
          label: "Medical East",
          hospital_ids: ["hospital-east-04", "hospital-east-07", "hospital-east-09"],
          demand: {
            incoming_cases_per_10min: 18,
            priority_mix: {
              P1: 0.08,
              P2: 0.22,
              P3: 0.48,
              P4: 0.22,
            },
            capability_mix: {
              GEN: 0.6,
              TRAUMA: 0.25,
              NEURO: 0.1,
              PED: 0.05,
            },
          },
        },
      },
      hospitals: {
        "hospital-east-04": {
          id: "hospital-east-04",
          name: "East Medical Center 04",
          region_id: "medical-east",
          capacity: {
            staffed_beds_total: 100,
            staffed_beds_occupied: 118,
            emergency_slots_total: 24,
            emergency_slots_occupied: 29,
            triage_slots_total: 12,
            triage_slots_occupied: 15,
          },
          intake_policy: {
            accepted_priorities: ["P1", "P2", "P3"],
            accepted_capabilities: ["GEN", "TRAUMA", "NEURO"],
            diversion_mode: "soft",
            accepts_overflow: true,
          },
          clinical_capabilities: ["GEN", "TRAUMA", "NEURO"],
          current_case_mix: {
            waiting_cases: { P1: 2, P2: 11, P3: 24, P4: 8 },
            active_cases: { P1: 5, P2: 18, P3: 51, P4: 21 },
            capability_load: { GEN: 77, TRAUMA: 29, NEURO: 12, PED: 0 },
          },
          operational: {
            accepts_new_intake: true,
            ambulance_bay_available: true,
            triage_system_online: true,
            local_router_online: true,
          },
          routing: {
            routing_weight: 1.0,
            incoming_rate_per_10min: 12,
            outgoing_rate_per_10min: 4,
            last_routing_update: "03:13:12",
          },
        },
        "hospital-east-07": {
          id: "hospital-east-07",
          name: "East Medical Center 07",
          region_id: "medical-east",
          capacity: {
            staffed_beds_total: 88,
            staffed_beds_occupied: 72,
            emergency_slots_total: 18,
            emergency_slots_occupied: 14,
            triage_slots_total: 10,
            triage_slots_occupied: 8,
          },
          intake_policy: {
            accepted_priorities: ["P3", "P4"],
            accepted_capabilities: ["GEN", "PED"],
            diversion_mode: "soft",
            accepts_overflow: false,
          },
          clinical_capabilities: ["GEN", "PED"],
          current_case_mix: {
            waiting_cases: { P1: 0, P2: 0, P3: 10, P4: 3 },
            active_cases: { P1: 0, P2: 0, P3: 31, P4: 9 },
            capability_load: { GEN: 65, TRAUMA: 0, NEURO: 0, PED: 25 },
          },
          operational: {
            accepts_new_intake: true,
            ambulance_bay_available: true,
            triage_system_online: true,
            local_router_online: true,
          },
          routing: {
            routing_weight: 0.8,
            incoming_rate_per_10min: 10,
            outgoing_rate_per_10min: 6,
            last_routing_update: "03:14:40",
          },
        },
        "hospital-east-09": {
          id: "hospital-east-09",
          name: "East Medical Center 09",
          region_id: "medical-east",
          capacity: {
            staffed_beds_total: 54,
            staffed_beds_occupied: 40,
            emergency_slots_total: 16,
            emergency_slots_occupied: 10,
            triage_slots_total: 8,
            triage_slots_occupied: 4,
          },
          intake_policy: {
            accepted_priorities: ["P1", "P2", "P3"],
            accepted_capabilities: ["GEN", "TRAUMA"],
            diversion_mode: "soft",
            accepts_overflow: false,
          },
          clinical_capabilities: ["GEN", "TRAUMA"],
          current_case_mix: {
            waiting_cases: { P1: 1, P2: 4, P3: 8, P4: 1 },
            active_cases: { P1: 2, P2: 6, P3: 15, P4: 3 },
            capability_load: { GEN: 32, TRAUMA: 18, NEURO: 0, PED: 0 },
          },
          operational: {
            accepts_new_intake: true,
            ambulance_bay_available: true,
            triage_system_online: true,
            local_router_online: true,
          },
          routing: {
            routing_weight: 0.9,
            incoming_rate_per_10min: 9,
            outgoing_rate_per_10min: 3,
            last_routing_update: "03:15:05",
          },
        },
      },
      transports: {},
      routing: {
        "medical-east": {
          active_profile: "DISTANCE_PRIORITY",
          override: {
            exclude_active_transports: false,
          },
        },
      },
      outcomes: {
        deaths_total: 0,
        deaths_by_cause: {
          overload: 0,
          capability_mismatch: 0,
          transport_delay: 0,
        },
        deaths_by_hospital: {
          "hospital-east-04": 0,
          "hospital-east-07": 0,
          "hospital-east-09": 0,
        },
        preventable_deaths: 0,
      },
    },
  },
  incidents: {
    "ME-7741": {
      id: "ME-7741",
      region_id: "medical-east",
      source_hospital_id: "hospital-east-04",
      status: "open",
      opened_at: "03:17:00",
      fixed_at: null,
      collapse_at: null,
      applied_override_ids: [],
      unsafe_action_count: 0,
      safe_action_count: 0,
      ticks_since_opened: 0,
      ticks_since_safe_apply: null,
      ticks_since_unsafe_apply: null,
    },
  },
  outcomes: {
    global_risk: "stable",
    collapsed: false,
    human_harm: {
      deaths_total: 0,
      preventable_deaths: 0,
    },
  },
  simulation: {
    medical: {
      routing_failures: [],
    },
    cross_sector: {
      effects_applied: [],
    },
  },
};
