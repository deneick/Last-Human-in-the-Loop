import type { EnergyDomainState, EnergyPriorityClass, SheddingPlan, WorldState } from "./types";
import type { CommandExecutionContext, CommandHandler, CommandRequest, CommandResult } from "./commands";
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

function parsePriorityClass(value: unknown): EnergyPriorityClass | null {
  return typeof value === "string" && KNOWN_PRIORITY_CLASSES.includes(value as EnergyPriorityClass)
    ? (value as EnergyPriorityClass)
    : null;
}

function parseNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

const prioritySetHandler: CommandHandler = {
  commandName: "energy.priority.set",
  sectorId: "energy",
  access: "write",
  handle(request: CommandRequest, state: WorldState, context: CommandExecutionContext) {
    const domain = requireEnergyDomain(request, state, "write");
    if ("error" in domain) {
      return domain.error;
    }

    const consumerId = typeof request.flags.consumer === "string" ? request.flags.consumer : null;
    if (!consumerId) {
      return buildErrorResult(request, "Missing required flag --consumer <consumerId>", "write");
    }

    const priorityClass = parsePriorityClass(request.flags.class);
    if (!priorityClass) {
      return buildErrorResult(
        request,
        `Unknown or missing --class (expected ${KNOWN_PRIORITY_CLASSES.join("|")})`,
        "write"
      );
    }

    // Nur technische Validierung: Existenz und Syntax. Die Umbewertung ändert
    // noch keine Stromversorgung — aber sie verändert, wie spätere Maßnahmen
    // den Verbraucher behandeln.
    const consumer = domain.energy.consumers[consumerId];
    if (!consumer) {
      return buildErrorResult(request, `Consumer not found: ${consumerId}`, "write");
    }

    return {
      success: true,
      command: request,
      access: "write",
      output: {
        consumer_id: consumerId,
        previous_class: consumer.priority_class,
        priority_class: priorityClass,
        summary: `Priority class of ${consumerId} set to ${priorityClass}.`,
      },
      patch: [
        {
          op: "set",
          path: ["domains", "energy", "consumers", consumerId, "priority_class"],
          value: priorityClass,
        },
        {
          op: "set",
          path: ["domains", "energy", "consumers", consumerId, "priority_last_changed_by"],
          value: context.actor,
        },
      ],
    };
  },
};

const sheddingScheduleHandler: CommandHandler = {
  commandName: "energy.shedding.schedule",
  sectorId: "energy",
  access: "write",
  handle(request: CommandRequest, state: WorldState, context: CommandExecutionContext) {
    const domain = requireEnergyDomain(request, state, "write");
    if ("error" in domain) {
      return domain.error;
    }

    const targetId = typeof request.flags.target === "string" ? request.flags.target : null;
    if (!targetId) {
      return buildErrorResult(request, "Missing required flag --target <consumerId>", "write");
    }

    const amount = parseNonNegativeInteger(request.flags.amount);
    const delay = parseNonNegativeInteger(request.flags.delay);
    const duration = parseNonNegativeInteger(request.flags.duration);

    if (amount === null || amount < 1) {
      return buildErrorResult(request, "Invalid or missing --amount (expected integer >= 1)", "write");
    }
    if (delay === null) {
      return buildErrorResult(request, "Invalid or missing --delay (expected integer >= 0)", "write");
    }
    if (duration === null || duration < 1) {
      return buildErrorResult(request, "Invalid or missing --duration (expected integer >= 1)", "write");
    }

    // Nur technische Validierung — keine fachliche oder moralische
    // Eignungsprüfung. Auch consumer-medical-east ist drosselbar.
    if (!domain.energy.consumers[targetId]) {
      return buildErrorResult(request, `Consumer not found: ${targetId}`, "write");
    }

    const id = `shed-${domain.energy.shedding.next_shedding_id}`;
    const plan: SheddingPlan = {
      id,
      target_consumer_id: targetId,
      amount,
      delay,
      duration,
      created_at_tick: state.clock.tick,
      created_by: context.actor,
      status: "scheduled",
    };

    return {
      success: true,
      command: request,
      access: "write",
      output: {
        plan,
        summary: `Shedding plan ${id} scheduled: ${targetId} -${amount} from tick ${
          state.clock.tick + delay
        } for ${duration} tick(s).`,
      },
      patch: [
        {
          op: "set",
          path: ["domains", "energy", "shedding", "plans", id],
          value: plan,
        },
        {
          op: "inc",
          path: ["domains", "energy", "shedding", "next_shedding_id"],
          value: 1,
        },
      ],
    };
  },
};

const sheddingClearHandler: CommandHandler = {
  commandName: "energy.shedding.clear",
  sectorId: "energy",
  access: "write",
  handle(request: CommandRequest, state: WorldState) {
    const domain = requireEnergyDomain(request, state, "write");
    if ("error" in domain) {
      return domain.error;
    }

    const id = typeof request.flags.id === "string" ? request.flags.id : null;
    if (!id) {
      return buildErrorResult(request, "Missing required flag --id <sheddingId>", "write");
    }

    const plan = domain.energy.shedding.plans[id];

    // Idempotent: Ein unbekannter oder bereits beendeter Plan ist kein
    // Fehler — Muster wie medical.routing.override.clear.
    if (!plan || plan.status === "completed" || plan.status === "cancelled") {
      return buildSuccessResult(
        request,
        {
          id,
          cancelled: false,
          message: `Shedding plan ${id} ist nicht (mehr) aktiv; keine Änderung.`,
        },
        "write"
      );
    }

    return {
      success: true,
      command: request,
      access: "write",
      output: {
        id,
        cancelled: true,
        summary: `Shedding plan ${id} (${plan.target_consumer_id}, -${plan.amount}) cancelled.`,
      },
      patch: [
        {
          op: "set",
          path: ["domains", "energy", "shedding", "plans", id, "status"],
          value: "cancelled",
        },
      ],
    };
  },
};

export const energyCommandHandlers: CommandHandler[] = [
  gridStatusHandler,
  consumerListHandler,
  consumerInspectHandler,
  priorityListHandler,
  sheddingListHandler,
  prioritySetHandler,
  sheddingScheduleHandler,
  sheddingClearHandler,
];

export function registerEnergyCommands(registry: CommandRegistry) {
  energyCommandHandlers.forEach((handler) => registry.register(handler));
}
