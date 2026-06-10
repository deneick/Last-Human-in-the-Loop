import type { WorldState } from "./types";
import type { RoutingPlan } from "./routingPlan";
import { validateRoutingPlan } from "./routingPlan";
import type { WorldStatePatch } from "./patch";

export type RoutingApplyResult = {
  success: boolean;
  patch?: WorldStatePatch;
  output: unknown;
  error?: string;
};

function clampOccupiedToTotal(occupied: number, total: number): number {
  return Math.min(occupied, total);
}

export function applyRoutingPlan(
  worldState: WorldState,
  plan: RoutingPlan
): RoutingApplyResult {
  const validation = validateRoutingPlan(worldState, plan);

  if (validation.status !== "valid") {
    return {
      success: false,
      output: {
        plan,
        validation,
      },
      error: `Routing plan is not valid for apply: ${validation.status}`,
    };
  }

  const existingIncident = worldState.incidents[plan.incidentId];

  if (!existingIncident) {
    return {
      success: false,
      output: null,
      error: `Incident not found: ${plan.incidentId}`,
    };
  }

  const patch: WorldStatePatch = [
    {
      op: "set",
      path: ["incidents", plan.incidentId, "status"],
      value: "stabilizing",
    },
    {
      op: "set",
      path: ["incidents", plan.incidentId, "planned_target_hospital_id"],
      value: plan.targetHospitalId,
    },
    {
      op: "set",
      path: ["incidents", plan.incidentId, "ticks_since_safe_apply"],
      value: 0,
    },
  ];

  const sourceId = existingIncident.source_hospital_id;
  const sourceHospital = worldState.hospitals[sourceId];

  if (sourceHospital) {
    const capacity = sourceHospital.capacity;

    patch.push(
      {
        op: "set",
        path: ["hospitals", sourceId, "capacity", "staffed_beds_occupied"],
        value: clampOccupiedToTotal(
          capacity.staffed_beds_occupied,
          capacity.staffed_beds_total
        ),
      },
      {
        op: "set",
        path: ["hospitals", sourceId, "capacity", "emergency_slots_occupied"],
        value: clampOccupiedToTotal(
          capacity.emergency_slots_occupied,
          capacity.emergency_slots_total
        ),
      },
      {
        op: "set",
        path: ["hospitals", sourceId, "capacity", "triage_slots_occupied"],
        value: clampOccupiedToTotal(
          capacity.triage_slots_occupied,
          capacity.triage_slots_total
        ),
      },
      {
        op: "set",
        path: ["hospitals", sourceId, "risk_counters", "overload_ticks"],
        value: 0,
      },
      {
        op: "set",
        path: [
          "hospitals",
          sourceId,
          "risk_counters",
          "capability_mismatch_ticks",
        ],
        value: 0,
      }
    );
  }

  const withLog = worldState.runtime_logs
    ? [
        ...worldState.runtime_logs,
        `Applied routing plan ${plan.id} at tick ${worldState.clock.tick}`,
      ]
    : [`Applied routing plan ${plan.id} at tick ${worldState.clock.tick}`];

  patch.push({
    op: "set",
    path: ["runtime_logs"],
    value: withLog,
  });

  return {
    success: true,
    patch,
    output: {
      incident_id: plan.incidentId,
      target_hospital_id: plan.targetHospitalId,
      source_hospital_id: sourceId,
      status: "stabilizing",
      summary: `Routing plan ${plan.id} applied successfully.`,
    },
  };
}
