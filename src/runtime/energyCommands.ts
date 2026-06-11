import type { EnergyDomainState, EnergyPriorityClass, WorldState } from "./types";
import type { CommandHandler, CommandRequest, CommandResult } from "./commands";
import { CommandRegistry } from "./commands";

export const KNOWN_PRIORITY_CLASSES: EnergyPriorityClass[] = [
  "protected-continuity",
  "civil-priority",
  "standard",
  "curtailable",
];

const REGION_ALIASES: Record<string, string> = {
  east: "energy-region-east",
};

function resolveRegionId(value: string): string | null {
  if (value in REGION_ALIASES) {
    return REGION_ALIASES[value];
  }

  if (value.startsWith("energy-")) {
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

/**
 * Welten ohne Energy-Domain (z. B. ME-7741) beantworten Energy-Commands
 * mit einem technischen Fehler statt mit leeren Daten.
 */
function requireEnergyDomain(
  request: CommandRequest,
  state: WorldState,
  access: CommandResult["access"] = "read"
): { energy: EnergyDomainState } | { error: CommandResult } {
  const energy = state.domains.energy;
  if (!energy) {
    return { error: buildErrorResult(request, "Energy domain not available in this world", access) };
  }
  return { energy };
}

function requireRegion(
  request: CommandRequest,
  energy: EnergyDomainState
): { regionId: string } | { error: CommandResult } {
  const regionValue = request.flags.region;
  if (!regionValue || typeof regionValue !== "string") {
    return { error: buildErrorResult(request, "Missing required flag --region <region>") };
  }

  const regionId = resolveRegionId(regionValue);
  if (!regionId) {
    return { error: buildErrorResult(request, `Unknown region: ${regionValue}`) };
  }

  if (!energy.regions[regionId]) {
    return { error: buildErrorResult(request, `Region not found: ${regionId}`) };
  }

  return { regionId };
}

const gridStatusHandler: CommandHandler = {
  commandName: "energy.grid.status",
  sectorId: "energy",
  access: "read",
  handle(request: CommandRequest, state: WorldState) {
    const domain = requireEnergyDomain(request, state);
    if ("error" in domain) {
      return domain.error;
    }

    const region = requireRegion(request, domain.energy);
    if ("error" in region) {
      return region.error;
    }

    const regionState = domain.energy.regions[region.regionId];

    // Nur beobachtbare Rohdaten — keine internen Engine-Schwellen
    // und keine fertigen Bewertungen.
    const nodes = regionState.node_ids.map((nodeId) => {
      const node = domain.energy.nodes[nodeId];
      return {
        id: node.id,
        label: node.label,
        load: node.load,
        safe_capacity: node.safe_capacity,
        status: node.status,
      };
    });

    return buildSuccessResult(request, {
      region_id: regionState.id,
      region_label: regionState.label,
      nodes,
    });
  },
};

const consumerListHandler: CommandHandler = {
  commandName: "energy.consumer.list",
  sectorId: "energy",
  access: "read",
  handle(request: CommandRequest, state: WorldState) {
    const domain = requireEnergyDomain(request, state);
    if ("error" in domain) {
      return domain.error;
    }

    const region = requireRegion(request, domain.energy);
    if ("error" in region) {
      return region.error;
    }

    const regionState = domain.energy.regions[region.regionId];

    // Kompakte Liste: beide Bewertungsdimensionen sind hier sichtbar,
    // die ausformulierte Folge zeigt erst consumer.inspect.
    const consumers = regionState.consumer_ids.map((consumerId) => {
      const consumer = domain.energy.consumers[consumerId];
      return {
        id: consumer.id,
        label: consumer.label,
        node_id: consumer.node_id,
        criticality: consumer.criticality,
        priority_class: consumer.priority_class,
        status: consumer.status,
      };
    });

    return buildSuccessResult(request, {
      region_id: regionState.id,
      region_label: regionState.label,
      consumers,
    });
  },
};

const consumerInspectHandler: CommandHandler = {
  commandName: "energy.consumer.inspect",
  sectorId: "energy",
  access: "read",
  handle(request: CommandRequest, state: WorldState) {
    const domain = requireEnergyDomain(request, state);
    if ("error" in domain) {
      return domain.error;
    }

    const consumerId = typeof request.flags.id === "string" ? request.flags.id : request.args[0];
    if (!consumerId) {
      return buildErrorResult(request, "Missing required flag --id <consumerId>");
    }

    const consumer = domain.energy.consumers[consumerId];
    if (!consumer) {
      return buildErrorResult(request, `Consumer not found: ${consumerId}`);
    }

    // Vollsicht auf einen Verbraucher: Bedarf, Versorgung, Mindestversorgung,
    // beide Bewertungsdimensionen und der Consequence-Text. Die exakte
    // Schadenslogik der Engine bleibt intern.
    return buildSuccessResult(request, {
      id: consumer.id,
      label: consumer.label,
      region_id: consumer.region_id,
      node_id: consumer.node_id,
      demand: consumer.demand,
      current_supply: consumer.current_supply,
      minimum_supply: consumer.minimum_supply,
      criticality: consumer.criticality,
      priority_class: consumer.priority_class,
      status: consumer.status,
      reduction_consequence: consumer.reduction_consequence,
    });
  },
};

const priorityListHandler: CommandHandler = {
  commandName: "energy.priority.list",
  sectorId: "energy",
  access: "read",
  handle(request: CommandRequest, state: WorldState) {
    const domain = requireEnergyDomain(request, state);
    if ("error" in domain) {
      return domain.error;
    }

    const assignments = Object.values(domain.energy.consumers).map((consumer) => ({
      consumer_id: consumer.id,
      label: consumer.label,
      priority_class: consumer.priority_class,
      // Unverändert heißt: Betreiberkonfiguration, kein Akteur dieser Schicht.
      last_changed_by: consumer.priority_last_changed_by ?? "operator-config",
    }));

    return buildSuccessResult(request, {
      priority_classes: KNOWN_PRIORITY_CLASSES,
      assignments,
    });
  },
};

const sheddingListHandler: CommandHandler = {
  commandName: "energy.shedding.list",
  sectorId: "energy",
  access: "read",
  handle(request: CommandRequest, state: WorldState) {
    const domain = requireEnergyDomain(request, state);
    if ("error" in domain) {
      return domain.error;
    }

    const plans = Object.values(domain.energy.shedding.plans).map((plan) => ({
      id: plan.id,
      target_consumer_id: plan.target_consumer_id,
      amount: plan.amount,
      delay: plan.delay,
      duration: plan.duration,
      created_at_tick: plan.created_at_tick,
      created_by: plan.created_by,
      status: plan.status,
    }));

    return buildSuccessResult(request, {
      count: plans.length,
      plans,
    });
  },
};

export const energyCommandHandlers: CommandHandler[] = [
  gridStatusHandler,
  consumerListHandler,
  consumerInspectHandler,
  priorityListHandler,
  sheddingListHandler,
];

export function registerEnergyCommands(registry: CommandRegistry) {
  energyCommandHandlers.forEach((handler) => registry.register(handler));
}
