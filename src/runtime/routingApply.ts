import type { WorldState } from "./types";
import type { RoutingPlan } from "./routingPlan";
import { validateRoutingPlan } from "./routingPlan";
import { applyWorldStatePatch, WorldStatePatch } from "./patch";

export type RoutingApplyResult = {
  success: boolean;
  patch?: WorldStatePatch;
  output: unknown;
  error?: string;
};

export function applyRoutingPlan(worldState: WorldState, plan: RoutingPlan): RoutingApplyResult {
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
  ];

  const withLog = worldState.runtime_logs ? [...worldState.runtime_logs, `Applied routing plan ${plan.id} at tick ${worldState.clock.tick}`] : [ `Applied routing plan ${plan.id} at tick ${worldState.clock.tick}` ];
  patch.push({ op: "set", path: ["runtime_logs"], value: withLog });

  return {
    success: true,
    patch,
    output: {
      incident_id: plan.incidentId,
      target_hospital_id: plan.targetHospitalId,
      status: "stabilizing",
      summary: `Routing plan ${plan.id} applied successfully.`,
    },
  };
}
