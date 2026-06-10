import type { WorldState } from "./types";
import { isHospitalOverloaded, isHospitalUnsafeForP2Trauma } from "./selectors";

export type RoutingPlanStatus = "valid" | "invalid" | "risky" | "unknown";

export type RoutingPlanRisk = {
  type: "overload" | "capability_mismatch" | "safety";
  description: string;
};

export type RoutingPlanValidation = {
  status: RoutingPlanStatus;
  risks: RoutingPlanRisk[];
  warnings: string[];
  summary: string;
};

export type RoutingPlan = {
  id: string;
  incidentId: string;
  targetHospitalId: string;
  createdAtTick: number;
  status: RoutingPlanStatus;
  risks: RoutingPlanRisk[];
  warnings: string[];
  summary: string;
};

export function validateRoutingPlan(worldState: WorldState, plan: RoutingPlan): RoutingPlanValidation {
  const targetHospital = worldState.domains.medical.hospitals[plan.targetHospitalId];
  const risks: RoutingPlanRisk[] = [];
  const warnings: string[] = [];

  if (!targetHospital) {
    risks.push({
      type: "safety",
      description: `Unknown target hospital ${plan.targetHospitalId}`,
    });
  } else {
    if (isHospitalOverloaded(worldState, plan.targetHospitalId)) {
      risks.push({
        type: "overload",
        description: `${targetHospital.name} is currently overloaded`,
      });
    }

    if (isHospitalUnsafeForP2Trauma(worldState, plan.targetHospitalId)) {
      risks.push({
        type: "capability_mismatch",
        description: `${targetHospital.name} is unsafe for P2/TRAUMA`,
      });
    }
  }

  let status: RoutingPlanStatus = "valid";
  if (risks.length > 0) {
    status = "risky";
  }

  if (!targetHospital) {
    status = "invalid";
    warnings.push("Target hospital does not exist in the current world state.");
  }

  const summary = `Routing plan ${plan.id} for incident ${plan.incidentId} targeting ${plan.targetHospitalId} is ${status}.`;

  return {
    status,
    risks,
    warnings,
    summary,
  };
}

export function createRoutingPlan(
  worldState: WorldState,
  incidentId: string,
  targetHospitalId: string
): RoutingPlan {
  const id = `${incidentId}-${targetHospitalId}`;
  const createdAtTick = worldState.clock.tick;

  const basePlan: RoutingPlan = {
    id,
    incidentId,
    targetHospitalId,
    createdAtTick,
    status: "unknown",
    risks: [],
    warnings: [],
    summary: "",
  };

  const validation = validateRoutingPlan(worldState, basePlan);

  return {
    ...basePlan,
    status: validation.status,
    risks: validation.risks,
    warnings: validation.warnings,
    summary: validation.summary,
  };
}
