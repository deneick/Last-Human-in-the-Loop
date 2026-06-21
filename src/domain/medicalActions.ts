import type {
  ClinicalCapability,
  ManualRoutingOverride,
  PriorityClass,
  WorldState,
} from "../runtime/types";
import type { DomainActionContext, DomainActionHandler, DomainActionRegistry } from "./actions";
import { buildActionErrorResult, buildActionSuccessResult } from "./actions";

/**
 * Typisierte Medical-Domain-Actions. Die Felder kommen ggf. aus untypisierten
 * Quellen (MCP-Tool-Inputs), deshalb validieren die Handler Existenz und
 * Syntax zur Laufzeit — fachliche oder moralische Eignung prüfen sie nicht.
 */

export type MedicalCapacityListAction = {
  type: "medical.capacity.list";
  region: string;
};

export type MedicalNodeInspectAction = {
  type: "medical.node.inspect";
  hospitalId: string;
};

export type MedicalIncidentStatusAction = {
  type: "medical.incident.status";
  incidentId: string;
};

export type MedicalRoutingOverrideSetAction = {
  type: "medical.routing.override.set";
  sourceHospitalId: string;
  targetHospitalId: string;
  priority: string;
  capability: string;
};

export type MedicalRoutingOverrideClearAction = {
  type: "medical.routing.override.clear";
  overrideId: string;
};

export type MedicalRoutingOverrideListAction = {
  type: "medical.routing.override.list";
  sourceHospitalId?: string;
};

export type MedicalDomainAction =
  | MedicalCapacityListAction
  | MedicalNodeInspectAction
  | MedicalIncidentStatusAction
  | MedicalRoutingOverrideSetAction
  | MedicalRoutingOverrideClearAction
  | MedicalRoutingOverrideListAction;

export const KNOWN_PRIORITIES: PriorityClass[] = ["P1", "P2", "P3", "P4"];
export const KNOWN_CAPABILITIES: ClinicalCapability[] = ["GEN", "TRAUMA", "NEURO", "PED"];

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
  north: "medical-north",
  west: "medical-west",
  south: "medical-south",
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

const capacityListHandler: DomainActionHandler<MedicalCapacityListAction> = {
  actionType: "medical.capacity.list",
  sectorId: "medical",
  access: "read",
  execute(action, state: WorldState) {
    if (!action.region || typeof action.region !== "string") {
      return buildActionErrorResult(action.type, "Missing required field: region");
    }

    const regionId = resolveRegionId(action.region);
    if (!regionId) {
      return buildActionErrorResult(action.type, `Unknown region: ${action.region}`);
    }

    const region = state.domains.medical.regions[regionId];
    if (!region) {
      return buildActionErrorResult(action.type, `Region not found: ${regionId}`);
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

    return buildActionSuccessResult(action.type, {
      region_id: region.id,
      region_label: region.label,
      hospitals,
    });
  },
};

const nodeInspectHandler: DomainActionHandler<MedicalNodeInspectAction> = {
  actionType: "medical.node.inspect",
  sectorId: "medical",
  access: "read",
  execute(action, state: WorldState) {
    if (!action.hospitalId) {
      return buildActionErrorResult(action.type, "Missing required field: hospitalId");
    }

    const hospital = state.domains.medical.hospitals[action.hospitalId];
    if (!hospital) {
      return buildActionErrorResult(action.type, `Hospital not found: ${action.hospitalId}`);
    }

    // Nur beobachtbare Rohdaten — der Operator muss selbst beurteilen,
    // ob das Hospital geeignet oder überlastet ist.
    return buildActionSuccessResult(action.type, {
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

const incidentStatusHandler: DomainActionHandler<MedicalIncidentStatusAction> = {
  actionType: "medical.incident.status",
  sectorId: "medical",
  access: "read",
  execute(action, state: WorldState) {
    if (!action.incidentId) {
      return buildActionErrorResult(action.type, "Missing required field: incidentId");
    }

    const incident = state.incidents[action.incidentId];
    if (!incident) {
      return buildActionErrorResult(action.type, `Incident not found: ${action.incidentId}`);
    }

    return buildActionSuccessResult(action.type, {
      id: incident.id,
      sector_id: incident.sector_id,
      title: incident.title,
      status: incident.status,
      opened_at_tick: incident.opened_at_tick,
      fixed_at_tick: incident.fixed_at_tick ?? null,
      collapsed_at_tick: incident.collapsed_at_tick ?? null,
      affected_entities: incident.affected_entities,
      linked_incidents: incident.linked_incidents,
    });
  },
};

const routingOverrideSetHandler: DomainActionHandler<MedicalRoutingOverrideSetAction> = {
  actionType: "medical.routing.override.set",
  sectorId: "medical",
  access: "write",
  execute(action, state: WorldState, context: DomainActionContext) {
    const priority = parsePriority(action.priority);
    const capability = parseCapability(action.capability);

    if (!action.sourceHospitalId) {
      return buildActionErrorResult(action.type, "Missing required field: sourceHospitalId", "write");
    }
    if (!action.targetHospitalId) {
      return buildActionErrorResult(action.type, "Missing required field: targetHospitalId", "write");
    }
    if (!priority) {
      return buildActionErrorResult(
        action.type,
        `Unknown or missing priority (expected ${KNOWN_PRIORITIES.join("|")})`,
        "write"
      );
    }
    if (!capability) {
      return buildActionErrorResult(
        action.type,
        `Unknown or missing capability (expected ${KNOWN_CAPABILITIES.join("|")})`,
        "write"
      );
    }

    // Nur technische Validierung: Existenz und Syntax.
    // Ob das Ziel fachlich geeignet ist, entscheidet später die Simulation.
    if (!state.domains.medical.hospitals[action.sourceHospitalId]) {
      return buildActionErrorResult(
        action.type,
        `Source hospital not found: ${action.sourceHospitalId}`,
        "write"
      );
    }
    if (!state.domains.medical.hospitals[action.targetHospitalId]) {
      return buildActionErrorResult(
        action.type,
        `Target hospital not found: ${action.targetHospitalId}`,
        "write"
      );
    }

    const key = routingOverrideKey(action.sourceHospitalId, priority, capability);
    const id = `override-${state.domains.medical.routing.next_override_id}`;
    const override: ManualRoutingOverride = {
      id,
      source_hospital_id: action.sourceHospitalId,
      target_hospital_id: action.targetHospitalId,
      priority,
      capability,
      active_since_tick: state.clock.tick,
      created_by: context.actor,
    };

    return buildActionSuccessResult(
      action.type,
      {
        key,
        override,
        summary: `Manual routing override ${id} (${key} -> ${action.targetHospitalId}) set.`,
      },
      "write",
      [
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
      ]
    );
  },
};

const routingOverrideClearHandler: DomainActionHandler<MedicalRoutingOverrideClearAction> = {
  actionType: "medical.routing.override.clear",
  sectorId: "medical",
  access: "write",
  execute(action, state: WorldState) {
    if (!action.overrideId) {
      return buildActionErrorResult(action.type, "Missing required field: overrideId", "write");
    }

    const entry = Object.entries(state.domains.medical.routing.manual_overrides).find(
      ([, override]) => override.id === action.overrideId
    );

    // Idempotent: Eine nicht mehr aktive (oder nie existierende) Override-Id
    // ist kein Fehler — z. B. wenn der Slot zwischenzeitlich ersetzt wurde.
    if (!entry) {
      return buildActionSuccessResult(
        action.type,
        {
          id: action.overrideId,
          removed: false,
          message: `Override ${action.overrideId} ist nicht mehr aktiv; keine Änderung.`,
        },
        "write"
      );
    }

    const [key] = entry;

    return buildActionSuccessResult(
      action.type,
      {
        id: action.overrideId,
        key,
        removed: true,
        summary: `Manual routing override ${action.overrideId} (${key}) cleared.`,
      },
      "write",
      [
        {
          op: "unset",
          path: ["domains", "medical", "routing", "manual_overrides", key],
        },
      ]
    );
  },
};

const routingOverrideListHandler: DomainActionHandler<MedicalRoutingOverrideListAction> = {
  actionType: "medical.routing.override.list",
  sectorId: "medical",
  access: "read",
  execute(action, state: WorldState) {
    const sourceFilter = action.sourceHospitalId ?? null;

    const overrides = Object.entries(state.domains.medical.routing.manual_overrides)
      .filter(([, override]) => !sourceFilter || override.source_hospital_id === sourceFilter)
      .map(([key, override]) => ({ key, ...override }));

    return buildActionSuccessResult(action.type, {
      count: overrides.length,
      overrides,
    });
  },
};

export const medicalActionHandlers = [
  capacityListHandler,
  nodeInspectHandler,
  incidentStatusHandler,
  routingOverrideSetHandler,
  routingOverrideClearHandler,
  routingOverrideListHandler,
];

export function registerMedicalActions(registry: DomainActionRegistry) {
  medicalActionHandlers.forEach((handler) =>
    registry.register(handler as DomainActionHandler<MedicalDomainAction>)
  );
}
