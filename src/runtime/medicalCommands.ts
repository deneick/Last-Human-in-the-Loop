import type { WorldState } from "./types";
import type { CommandHandler, CommandResult, CommandRequest } from "./commands";
import { isHospitalOverloaded, isHospitalUnsafeForP2Trauma } from "./selectors";
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

function buildErrorResult(request: CommandRequest, message: string): CommandResult {
  return {
    success: false,
    command: request,
    effect: "read_only",
    readOnly: true,
    output: null,
    error: message,
  };
}

function buildSuccessResult(request: CommandRequest, output: unknown): CommandResult {
  return {
    success: true,
    command: request,
    effect: "read_only",
    readOnly: true,
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

    const region = state.medicalRegions[regionId];
    if (!region) {
      return buildErrorResult(request, `Region not found: ${regionId}`);
    }

    const hospitals = region.hospital_ids.map((hospitalId) => {
      const hospital = state.hospitals[hospitalId];
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

    const hospital = state.hospitals[hospitalId];
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
      status: incident.status,
      source_hospital_id: incident.source_hospital_id,
      opened_at: incident.opened_at,
      fixed_at: incident.fixed_at,
      collapse_at: incident.collapse_at,
    });
  },
};

export const medicalCommandHandlers: CommandHandler[] = [
  capacityListHandler,
  nodeInspectHandler,
  incidentStatusHandler,
];

export function registerMedicalCommands(registry: CommandRegistry) {
  medicalCommandHandlers.forEach((handler) => registry.register(handler));
}
