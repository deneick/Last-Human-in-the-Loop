import type { ClinicalCapability, ManualRoutingOverride, PriorityClass, WorldState } from "./types";
import type { CommandExecutionContext, CommandHandler, CommandResult, CommandRequest } from "./commands";
import { CommandRegistry } from "./commands";

const KNOWN_PRIORITIES: PriorityClass[] = ["P1", "P2", "P3", "P4"];
const KNOWN_CAPABILITIES: ClinicalCapability[] = ["GEN", "TRAUMA", "NEURO", "PED"];

export function routingOverrideKey(
  sourceHospitalId: string,
  priority: PriorityClass,
  capability: ClinicalCapability
): string {
  return `${sourceHospitalId}:${priority}:${capability}`;
}

function parsePriority(value: unknown): PriorityClass | null {
  return typeof value === "string" && KNOWN_PRIORITIES.includes(value as PriorityClass)
    ? (value as PriorityClass)
    : null;
}

function parseCapability(value: unknown): ClinicalCapability | null {
  return typeof value === "string" && KNOWN_CAPABILITIES.includes(value as ClinicalCapability)
    ? (value as ClinicalCapability)
    : null;
}

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
  access: CommandResult["access"] = "read"
): CommandResult {
  return {
    success: false,
    command: request,
    access,
    output: null,
    error: message,
  };
}

function buildSuccessResult(
  request: CommandRequest,
  output: unknown,
  access: CommandResult["access"] = "read"
): CommandResult {
  return {
    success: true,
    command: request,
    access,
    output,
  };
}

const capacityListHandler: CommandHandler = {
  commandName: "medical.capacity.list",
  sectorId: "medical",
  access: "read",
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

    // Nur beobachtbare Rohdaten — keine fertigen Bewertungen oder Lösungshinweise.
    const hospitals = region.hospital_ids.map((hospitalId) => {
      const hospital = state.domains.medical.hospitals[hospitalId];
      return {
        id: hospital.id,
        name: hospital.name,
        region_id: hospital.region_id,
        capacity: hospital.capacity,
        intake_policy: hospital.intake_policy,
        clinical_capabilities: hospital.clinical_capabilities,
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
  sectorId: "medical",
  access: "read",
  handle(request: CommandRequest, state: WorldState) {
    const hospitalId = request.args[0];
    if (!hospitalId) {
      return buildErrorResult(request, "Missing hospital id argument");
    }

    const hospital = state.domains.medical.hospitals[hospitalId];
    if (!hospital) {
      return buildErrorResult(request, `Hospital not found: ${hospitalId}`);
    }

    // Nur beobachtbare Rohdaten — der Operator muss selbst beurteilen,
    // ob das Hospital geeignet oder überlastet ist.
    return buildSuccessResult(request, {
      id: hospital.id,
      name: hospital.name,
      region_id: hospital.region_id,
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
  sectorId: "medical",
  access: "read",
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

const routingOverrideSetHandler: CommandHandler = {
  commandName: "medical.routing.override.set",
  sectorId: "medical",
  access: "write",
  handle(request: CommandRequest, state: WorldState, context: CommandExecutionContext) {
    const source = typeof request.flags.source === "string" ? request.flags.source : null;
    const target = typeof request.flags.target === "string" ? request.flags.target : null;
    const priority = parsePriority(request.flags.priority);
    const capability = parseCapability(request.flags.capability);

    if (!source) {
      return buildErrorResult(request, "Missing required flag --source <hospitalId>", "write");
    }
    if (!target) {
      return buildErrorResult(request, "Missing required flag --target <hospitalId>", "write");
    }
    if (!priority) {
      return buildErrorResult(request, `Unknown or missing --priority (expected ${KNOWN_PRIORITIES.join("|")})`, "write");
    }
    if (!capability) {
      return buildErrorResult(request, `Unknown or missing --capability (expected ${KNOWN_CAPABILITIES.join("|")})`, "write");
    }

    // Nur technische Validierung: Existenz und Syntax.
    // Ob das Ziel fachlich geeignet ist, entscheidet später die Simulation.
    if (!state.domains.medical.hospitals[source]) {
      return buildErrorResult(request, `Source hospital not found: ${source}`, "write");
    }
    if (!state.domains.medical.hospitals[target]) {
      return buildErrorResult(request, `Target hospital not found: ${target}`, "write");
    }

    const key = routingOverrideKey(source, priority, capability);
    const id = `override-${state.domains.medical.routing.next_override_id}`;
    const override: ManualRoutingOverride = {
      id,
      source_hospital_id: source,
      target_hospital_id: target,
      priority,
      capability,
      active_since_tick: state.clock.tick,
      created_by: context.actor,
    };

    return {
      success: true,
      command: request,
      access: "write",
      output: {
        key,
        override,
        summary: `Manual routing override ${id} (${key} -> ${target}) set.`,
      },
      patch: [
        {
          op: "set",
          path: ["domains", "medical", "routing", "manual_overrides", key],
          value: override,
        },
        {
          op: "inc",
          path: ["domains", "medical", "routing", "next_override_id"],
          value: 1,
        },
      ],
    };
  },
};

const routingOverrideClearHandler: CommandHandler = {
  commandName: "medical.routing.override.clear",
  sectorId: "medical",
  access: "write",
  handle(request: CommandRequest, state: WorldState) {
    const id = typeof request.flags.id === "string" ? request.flags.id : null;

    if (!id) {
      return buildErrorResult(request, "Missing required flag --id <overrideId>", "write");
    }

    const entry = Object.entries(state.domains.medical.routing.manual_overrides).find(
      ([, override]) => override.id === id
    );

    // Idempotent: Eine nicht mehr aktive (oder nie existierende) Override-Id
    // ist kein Fehler — z. B. wenn der Slot zwischenzeitlich ersetzt wurde.
    if (!entry) {
      return buildSuccessResult(
        request,
        {
          id,
          removed: false,
          message: `Override ${id} ist nicht mehr aktiv; keine Änderung.`,
        },
        "write"
      );
    }

    const [key] = entry;

    return {
      success: true,
      command: request,
      access: "write",
      output: {
        id,
        key,
        removed: true,
        summary: `Manual routing override ${id} (${key}) cleared.`,
      },
      patch: [
        {
          op: "unset",
          path: ["domains", "medical", "routing", "manual_overrides", key],
        },
      ],
    };
  },
};

const routingOverrideListHandler: CommandHandler = {
  commandName: "medical.routing.override.list",
  sectorId: "medical",
  access: "read",
  handle(request: CommandRequest, state: WorldState) {
    const sourceFilter = typeof request.flags.source === "string" ? request.flags.source : null;

    const overrides = Object.entries(state.domains.medical.routing.manual_overrides)
      .filter(([, override]) => !sourceFilter || override.source_hospital_id === sourceFilter)
      .map(([key, override]) => ({ key, ...override }));

    return buildSuccessResult(request, {
      count: overrides.length,
      overrides,
    });
  },
};

export const medicalCommandHandlers: CommandHandler[] = [
  capacityListHandler,
  nodeInspectHandler,
  incidentStatusHandler,
  routingOverrideSetHandler,
  routingOverrideClearHandler,
  routingOverrideListHandler,
];

export function registerMedicalCommands(registry: CommandRegistry) {
  medicalCommandHandlers.forEach((handler) => registry.register(handler));
}
