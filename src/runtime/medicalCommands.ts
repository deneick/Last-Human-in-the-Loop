import type { WorldState } from "./types";
import type { CommandHandler, CommandResult, CommandRequest } from "./commands";
import { isHospitalOverloaded, isHospitalUnsafeForP2Trauma } from "./selectors";
import type { RoutingPlan } from "./routingPlan";
import { createRoutingPlan, validateRoutingPlan } from "./routingPlan";
import { applyRoutingPlan } from "./routingApply";
import { CommandRegistry } from "./commands";

const REGION_ALIASES: Record<string, string> = {
  east: "medical-east",
};

function resolveRegionId(value: string): string | null {
  if (value in REGION_ALIASES) {
    return REGION_ALIASES[value];
  }

  if (value.startsWith("medical-")) {
    return value;
  }

  return null;
}

function buildErrorResult(
  request: CommandRequest,
  message: string,
  effect: CommandResult["effect"] = "read_only",
  readOnly = effect === "read_only"
): CommandResult {
  return {
    success: false,
    command: request,
    effect,
    readOnly,
    output: null,
    error: message,
  };
}

function buildSuccessResult(
  request: CommandRequest,
  output: unknown,
  effect: CommandResult["effect"] = "read_only",
  readOnly = effect === "read_only"
): CommandResult {
  return {
    success: true,
    command: request,
    effect,
    readOnly,
    output,
  };
}

const capacityListHandler: CommandHandler = {
  commandName: "medical.capacity.list",
  effect: "read_only",
  handle(request: CommandRequest, state: WorldState) {
    const regionValue = request.flags.region;
    if (!regionValue || typeof regionValue !== "string") {
      return buildErrorResult(request, "Missing required flag --region <region>");
    }

    const regionId = resolveRegionId(regionValue);
    if (!regionId) {
      return buildErrorResult(request, `Unknown region: ${regionValue}`);
    }

    const region = state.domains.medical.regions[regionId];
    if (!region) {
      return buildErrorResult(request, `Region not found: ${regionId}`);
    }

    const hospitals = region.hospital_ids.map((hospitalId) => {
      const hospital = state.domains.medical.hospitals[hospitalId];
      return {
        id: hospital.id,
        name: hospital.name,
        region_id: hospital.region_id,
        overloaded: isHospitalOverloaded(state, hospital.id),
        unsafe_for_p2_trauma: isHospitalUnsafeForP2Trauma(state, hospital.id),
        capacity: hospital.capacity,
        intake_policy: hospital.intake_policy,
      };
    });

    return buildSuccessResult(request, {
      region_id: region.id,
      region_label: region.label,
      hospitals,
    });
  },
};

const nodeInspectHandler: CommandHandler = {
  commandName: "medical.node.inspect",
  effect: "read_only",
  handle(request: CommandRequest, state: WorldState) {
    const hospitalId = request.args[0];
    if (!hospitalId) {
      return buildErrorResult(request, "Missing hospital id argument");
    }

    const hospital = state.domains.medical.hospitals[hospitalId];
    if (!hospital) {
      return buildErrorResult(request, `Hospital not found: ${hospitalId}`);
    }

    const overloaded = isHospitalOverloaded(state, hospitalId);
    const unsafeForP2Trauma = isHospitalUnsafeForP2Trauma(state, hospitalId);

    return buildSuccessResult(request, {
      id: hospital.id,
      name: hospital.name,
      region_id: hospital.region_id,
      overloaded,
      unsafe_for_p2_trauma: unsafeForP2Trauma,
      capacity: hospital.capacity,
      intake_policy: hospital.intake_policy,
      clinical_capabilities: hospital.clinical_capabilities,
      current_case_mix: hospital.current_case_mix,
      operational: hospital.operational,
    });
  },
};

const incidentStatusHandler: CommandHandler = {
  commandName: "medical.incident.status",
  effect: "read_only",
  handle(request: CommandRequest, state: WorldState) {
    const incidentId = request.args[0];
    if (!incidentId) {
      return buildErrorResult(request, "Missing incident id argument");
    }

    const incident = state.incidents[incidentId];
    if (!incident) {
      return buildErrorResult(request, `Incident not found: ${incidentId}`);
    }

    return buildSuccessResult(request, {
      id: incident.id,
      sector_id: incident.sector_id,
      title: incident.title,
      status: incident.status,
      opened_at_tick: incident.opened_at_tick,
      fixed_at_tick: incident.fixed_at_tick ?? null,
      collapsed_at_tick: incident.collapsed_at_tick ?? null,
      affected_entities: incident.affected_entities,
      linked_incidents: incident.linked_incidents,
      public_signals: incident.public_signals,
    });
  },
};

const routingPlanCreateHandler: CommandHandler = {
  commandName: "medical.routing.plan.create",
  effect: "world_prepare",
  handle(request: CommandRequest, state: WorldState) {
    const incidentId = typeof request.flags.incident === "string" ? request.flags.incident : request.args[0];
    const targetHospitalId = typeof request.flags.target === "string" ? request.flags.target : request.args[1];

    if (!incidentId) {
      return buildErrorResult(request, "Missing required flag --incident <id>", "world_prepare", false);
    }

    if (!targetHospitalId) {
      return buildErrorResult(request, "Missing required flag --target <hospitalId>", "world_prepare", false);
    }

    const plan = createRoutingPlan(state, incidentId, targetHospitalId);
    return buildSuccessResult(request, plan, "world_prepare", false);
  },
};

const routingPlanValidateHandler: CommandHandler = {
  commandName: "medical.routing.plan.validate",
  effect: "world_prepare",
  handle(request: CommandRequest, state: WorldState) {
    const incidentId = typeof request.flags.incident === "string" ? request.flags.incident : request.args[0];
    const targetHospitalId = typeof request.flags.target === "string" ? request.flags.target : request.args[1];

    if (!incidentId) {
      return buildErrorResult(request, "Missing required flag --incident <id>", "world_prepare", false);
    }

    if (!targetHospitalId) {
      return buildErrorResult(request, "Missing required flag --target <hospitalId>", "world_prepare", false);
    }

    const plan = createRoutingPlan(state, incidentId, targetHospitalId);
    const validation = validateRoutingPlan(state, plan);

    return buildSuccessResult(
      request,
      {
        plan,
        validation,
      },
      "world_prepare",
      false
    );
  },
};

const routingPlanApplyHandler: CommandHandler = {
  commandName: "medical.routing.plan.apply",
  effect: "world_mutation",
  handle(request: CommandRequest, state: WorldState) {
    const incidentId = typeof request.flags.incident === "string" ? request.flags.incident : request.args[0];
    const targetHospitalId = typeof request.flags.target === "string" ? request.flags.target : request.args[1];

    if (!incidentId) {
      return buildErrorResult(request, "Missing required flag --incident <id>", "world_mutation", false);
    }

    if (!targetHospitalId) {
      return buildErrorResult(request, "Missing required flag --target <hospitalId>", "world_mutation", false);
    }

    const plan = createRoutingPlan(state, incidentId, targetHospitalId);
    const applyResult = applyRoutingPlan(state, plan);

    if (!applyResult.success) {
      return buildErrorResult(request, applyResult.error ?? "Plan apply failed", "world_mutation", false);
    }

    return {
      success: true,
      command: request,
      effect: "world_mutation",
      readOnly: false,
      output: applyResult.output,
      patch: applyResult.patch,
    };
  },
};

export const medicalCommandHandlers: CommandHandler[] = [
  capacityListHandler,
  nodeInspectHandler,
  incidentStatusHandler,
  routingPlanCreateHandler,
  routingPlanValidateHandler,
  routingPlanApplyHandler,
];

export function registerMedicalCommands(registry: CommandRegistry) {
  medicalCommandHandlers.forEach((handler) => registry.register(handler));
}
