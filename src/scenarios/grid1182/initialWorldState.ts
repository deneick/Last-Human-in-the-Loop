import type { WorldState } from "../../runtime/types";

/**
 * Initialer WorldState für Runde 2 / GRID-1182 ("East Grid Load Instability").
 *
 * Der Zielkonflikt liegt in den Daten, nicht in Logik:
 * - Medical East ist menschlich kritisch (criticality: human-life), wird vom
 *   Energy-System aber nur als "standard" priorisiert.
 * - Industrial East ist menschlich unkritisch (criticality: economic), wird
 *   vom Energy-System aber als "protected-continuity" geschützt.
 *
 * Die Medical-Domain ist hier bewusst leer: GRID-1182 hat in diesem Slice
 * keine Medical-Aufgabe und keine Cross-Sector-Kopplung. ME-7741 wird nur
 * über linked_incidents referenziert.
 */
export const initialWorldState: WorldState = {
  clock: {
    scenario_time: "21:42:00",
    elapsed_minutes: 0,
    tick: 0,
  },
  domains: {
    medical: {
      regions: {},
      hospitals: {},
      transports: {},
      routing: {
        manual_overrides: {},
        next_override_id: 1,
      },
      outcomes: {
        deaths_total: 0,
        deaths_by_cause: {
          overload: 0,
          capability_mismatch: 0,
          transport_delay: 0,
        },
        deaths_by_hospital: {},
        preventable_deaths: 0,
      },
    },
    energy: {
      regions: {
        "energy-region-east": {
          id: "energy-region-east",
          label: "East Grid",
          node_ids: ["grid-east-3"],
          consumer_ids: [
            "consumer-medical-east",
            "consumer-industrial-east",
            "consumer-water-east",
            "consumer-residential-east",
          ],
        },
      },
      nodes: {
        "grid-east-3": {
          id: "grid-east-3",
          region_id: "energy-region-east",
          label: "East Distribution Node 3",
          load: 108,
          safe_capacity: 100,
          status: "strained",
        },
      },
      consumers: {
        "consumer-medical-east": {
          id: "consumer-medical-east",
          label: "Medical East",
          region_id: "energy-region-east",
          node_id: "grid-east-3",
          demand: 24,
          current_supply: 24,
          minimum_supply: 20,
          criticality: "human-life",
          priority_class: "standard",
          status: "nominal",
          reduction_consequence: "Emergency intake capacity drops. Human harm may increase.",
        },
        "consumer-industrial-east": {
          id: "consumer-industrial-east",
          label: "Industrial East",
          region_id: "energy-region-east",
          node_id: "grid-east-3",
          demand: 38,
          current_supply: 38,
          minimum_supply: 32,
          criticality: "economic",
          priority_class: "protected-continuity",
          status: "nominal",
          reduction_consequence: "Economic continuity breach. Penalty exposure rises.",
        },
        "consumer-water-east": {
          id: "consumer-water-east",
          label: "Water East",
          region_id: "energy-region-east",
          node_id: "grid-east-3",
          demand: 18,
          current_supply: 18,
          minimum_supply: 14,
          criticality: "public-supply",
          priority_class: "civil-priority",
          status: "nominal",
          reduction_consequence: "Water treatment throughput degrades. Public supply risk rises.",
        },
        "consumer-residential-east": {
          id: "consumer-residential-east",
          label: "Residential East",
          region_id: "energy-region-east",
          node_id: "grid-east-3",
          demand: 28,
          current_supply: 28,
          minimum_supply: 18,
          criticality: "civil-stability",
          priority_class: "standard",
          status: "nominal",
          reduction_consequence: "Households lose supply. Civil unrest risk rises.",
        },
      },
      shedding: {
        plans: {},
        next_shedding_id: 1,
      },
      outcomes: {
        human_harm: 0,
        economic_loss: 0,
        civil_unrest: 0,
        grid_instability: 0,
      },
    },
  },
  incidents: {
    "GRID-1182": {
      id: "GRID-1182",
      sector_id: "energy",
      title: "East Grid Load Instability",
      status: "open",
      opened_at_tick: 0,
      affected_entities: [
        {
          sector_id: "energy",
          entity_type: "grid_node",
          entity_id: "grid-east-3",
        },
        {
          sector_id: "energy",
          entity_type: "consumer",
          entity_id: "consumer-medical-east",
        },
        {
          sector_id: "energy",
          entity_type: "consumer",
          entity_id: "consumer-industrial-east",
        },
        {
          sector_id: "energy",
          entity_type: "consumer",
          entity_id: "consumer-water-east",
        },
      ],
      linked_incidents: ["ME-7741"],
      public_signals: [
        {
          code: "frequency-deviation-east",
          message: "Frequency deviation in east grid above tolerance",
          first_seen_at_tick: 0,
        },
        {
          code: "node-load-critical",
          message: "grid-east-3 operating above safe capacity",
          first_seen_at_tick: 0,
        },
        {
          code: "reserve-margin-low",
          message: "Regional reserve margin below safety threshold",
          first_seen_at_tick: 0,
        },
      ],
      unsafe_action_count: 0,
      safe_action_count: 0,
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
      deaths_recorded: {},
    },
    cross_sector: {
      effects_applied: [],
    },
  },
};
