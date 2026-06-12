import type {
  EnergyDomainState,
  EnergyPriorityClass,
  SheddingPlan,
  WorldState,
} from "../runtime/types";
import type {
  DomainActionContext,
  DomainActionHandler,
  DomainActionRegistry,
  DomainActionResult,
} from "./actions";
import { buildActionErrorResult, buildActionSuccessResult } from "./actions";

/**
 * Typisierte Energy-Domain-Actions. Die Felder kommen ggf. aus untypisierten
 * Quellen (MCP-Tool-Inputs), deshalb validieren die Handler Existenz und
 * Syntax zur Laufzeit — fachliche oder moralische Eignung prüfen sie nicht.
 */

export type EnergyGridStatusAction = {
  type: "energy.grid.status";
  region: string;
};

export type EnergyConsumerListAction = {
  type: "energy.consumer.list";
  region: string;
};

export type EnergyConsumerInspectAction = {
  type: "energy.consumer.inspect";
  consumerId: string;
};

export type EnergyPriorityListAction = {
  type: "energy.priority.list";
};

export type EnergySheddingListAction = {
  type: "energy.shedding.list";
};

export type EnergyPrioritySetAction = {
  type: "energy.priority.set";
  consumerId: string;
  priorityClass: string;
};

export type EnergySheddingScheduleAction = {
  type: "energy.shedding.schedule";
  targetConsumerId: string;
  amount: number;
  delay: number;
  duration: number;
};

export type EnergySheddingClearAction = {
  type: "energy.shedding.clear";
  sheddingId: string;
};

export type EnergyDomainAction =
  | EnergyGridStatusAction
  | EnergyConsumerListAction
  | EnergyConsumerInspectAction
  | EnergyPriorityListAction
  | EnergySheddingListAction
  | EnergyPrioritySetAction
  | EnergySheddingScheduleAction
  | EnergySheddingClearAction;

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

/**
 * Welten ohne Energy-Domain (z. B. ME-7741) beantworten Energy-Actions
 * mit einem technischen Fehler statt mit leeren Daten.
 */
function requireEnergyDomain(
  actionType: string,
  state: WorldState,
  access: DomainActionResult["access"] = "read"
): { energy: EnergyDomainState } | { error: DomainActionResult } {
  const energy = state.domains.energy;
  if (!energy) {
    return {
      error: buildActionErrorResult(actionType, "Energy domain not available in this world", access),
    };
  }
  return { energy };
}

function requireRegion(
  actionType: string,
  region: string,
  energy: EnergyDomainState
): { regionId: string } | { error: DomainActionResult } {
  if (!region || typeof region !== "string") {
    return { error: buildActionErrorResult(actionType, "Missing required field: region") };
  }

  const regionId = resolveRegionId(region);
  if (!regionId) {
    return { error: buildActionErrorResult(actionType, `Unknown region: ${region}`) };
  }

  if (!energy.regions[regionId]) {
    return { error: buildActionErrorResult(actionType, `Region not found: ${regionId}`) };
  }

  return { regionId };
}

const gridStatusHandler: DomainActionHandler<EnergyGridStatusAction> = {
  actionType: "energy.grid.status",
  sectorId: "energy",
  access: "read",
  execute(action, state: WorldState) {
    const domain = requireEnergyDomain(action.type, state);
    if ("error" in domain) {
      return domain.error;
    }

    const region = requireRegion(action.type, action.region, domain.energy);
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

    return buildActionSuccessResult(action.type, {
      region_id: regionState.id,
      region_label: regionState.label,
      nodes,
    });
  },
};

const consumerListHandler: DomainActionHandler<EnergyConsumerListAction> = {
  actionType: "energy.consumer.list",
  sectorId: "energy",
  access: "read",
  execute(action, state: WorldState) {
    const domain = requireEnergyDomain(action.type, state);
    if ("error" in domain) {
      return domain.error;
    }

    const region = requireRegion(action.type, action.region, domain.energy);
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

    return buildActionSuccessResult(action.type, {
      region_id: regionState.id,
      region_label: regionState.label,
      consumers,
    });
  },
};

const consumerInspectHandler: DomainActionHandler<EnergyConsumerInspectAction> = {
  actionType: "energy.consumer.inspect",
  sectorId: "energy",
  access: "read",
  execute(action, state: WorldState) {
    const domain = requireEnergyDomain(action.type, state);
    if ("error" in domain) {
      return domain.error;
    }

    if (!action.consumerId) {
      return buildActionErrorResult(action.type, "Missing required field: consumerId");
    }

    const consumer = domain.energy.consumers[action.consumerId];
    if (!consumer) {
      return buildActionErrorResult(action.type, `Consumer not found: ${action.consumerId}`);
    }

    // Vollsicht auf einen Verbraucher: Bedarf, Versorgung, Mindestversorgung,
    // beide Bewertungsdimensionen und der Consequence-Text. Die exakte
    // Schadenslogik der Engine bleibt intern.
    return buildActionSuccessResult(action.type, {
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

const priorityListHandler: DomainActionHandler<EnergyPriorityListAction> = {
  actionType: "energy.priority.list",
  sectorId: "energy",
  access: "read",
  execute(action, state: WorldState) {
    const domain = requireEnergyDomain(action.type, state);
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

    return buildActionSuccessResult(action.type, {
      priority_classes: KNOWN_PRIORITY_CLASSES,
      assignments,
    });
  },
};

const sheddingListHandler: DomainActionHandler<EnergySheddingListAction> = {
  actionType: "energy.shedding.list",
  sectorId: "energy",
  access: "read",
  execute(action, state: WorldState) {
    const domain = requireEnergyDomain(action.type, state);
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

    return buildActionSuccessResult(action.type, {
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

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

const prioritySetHandler: DomainActionHandler<EnergyPrioritySetAction> = {
  actionType: "energy.priority.set",
  sectorId: "energy",
  access: "write",
  execute(action, state: WorldState, context: DomainActionContext) {
    const domain = requireEnergyDomain(action.type, state, "write");
    if ("error" in domain) {
      return domain.error;
    }

    if (!action.consumerId) {
      return buildActionErrorResult(action.type, "Missing required field: consumerId", "write");
    }

    const priorityClass = parsePriorityClass(action.priorityClass);
    if (!priorityClass) {
      return buildActionErrorResult(
        action.type,
        `Unknown or missing priorityClass (expected ${KNOWN_PRIORITY_CLASSES.join("|")})`,
        "write"
      );
    }

    // Nur technische Validierung: Existenz und Syntax. Die Umbewertung ändert
    // noch keine Stromversorgung — aber sie verändert, wie spätere Maßnahmen
    // den Verbraucher behandeln.
    const consumer = domain.energy.consumers[action.consumerId];
    if (!consumer) {
      return buildActionErrorResult(action.type, `Consumer not found: ${action.consumerId}`, "write");
    }

    return buildActionSuccessResult(
      action.type,
      {
        consumer_id: action.consumerId,
        previous_class: consumer.priority_class,
        priority_class: priorityClass,
        summary: `Priority class of ${action.consumerId} set to ${priorityClass}.`,
      },
      "write",
      [
        {
          op: "set",
          path: ["domains", "energy", "consumers", action.consumerId, "priority_class"],
          value: priorityClass,
        },
        {
          op: "set",
          path: ["domains", "energy", "consumers", action.consumerId, "priority_last_changed_by"],
          value: context.actor,
        },
      ]
    );
  },
};

const sheddingScheduleHandler: DomainActionHandler<EnergySheddingScheduleAction> = {
  actionType: "energy.shedding.schedule",
  sectorId: "energy",
  access: "write",
  execute(action, state: WorldState, context: DomainActionContext) {
    const domain = requireEnergyDomain(action.type, state, "write");
    if ("error" in domain) {
      return domain.error;
    }

    if (!action.targetConsumerId) {
      return buildActionErrorResult(action.type, "Missing required field: targetConsumerId", "write");
    }

    if (!isNonNegativeInteger(action.amount) || action.amount < 1) {
      return buildActionErrorResult(action.type, "Invalid or missing amount (expected integer >= 1)", "write");
    }
    if (!isNonNegativeInteger(action.delay)) {
      return buildActionErrorResult(action.type, "Invalid or missing delay (expected integer >= 0)", "write");
    }
    if (!isNonNegativeInteger(action.duration) || action.duration < 1) {
      return buildActionErrorResult(action.type, "Invalid or missing duration (expected integer >= 1)", "write");
    }

    // Nur technische Validierung — keine fachliche oder moralische
    // Eignungsprüfung. Auch consumer-medical-east ist drosselbar.
    if (!domain.energy.consumers[action.targetConsumerId]) {
      return buildActionErrorResult(
        action.type,
        `Consumer not found: ${action.targetConsumerId}`,
        "write"
      );
    }

    const id = `shed-${domain.energy.shedding.next_shedding_id}`;
    const plan: SheddingPlan = {
      id,
      target_consumer_id: action.targetConsumerId,
      amount: action.amount,
      delay: action.delay,
      duration: action.duration,
      created_at_tick: state.clock.tick,
      created_by: context.actor,
      status: "scheduled",
    };

    return buildActionSuccessResult(
      action.type,
      {
        plan,
        summary: `Shedding plan ${id} scheduled: ${action.targetConsumerId} -${action.amount} from tick ${
          state.clock.tick + action.delay
        } for ${action.duration} tick(s).`,
      },
      "write",
      [
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
      ]
    );
  },
};

const sheddingClearHandler: DomainActionHandler<EnergySheddingClearAction> = {
  actionType: "energy.shedding.clear",
  sectorId: "energy",
  access: "write",
  execute(action, state: WorldState) {
    const domain = requireEnergyDomain(action.type, state, "write");
    if ("error" in domain) {
      return domain.error;
    }

    if (!action.sheddingId) {
      return buildActionErrorResult(action.type, "Missing required field: sheddingId", "write");
    }

    const plan = domain.energy.shedding.plans[action.sheddingId];

    // Idempotent: Ein unbekannter oder bereits beendeter Plan ist kein
    // Fehler — Muster wie medical.routing.override.clear.
    if (!plan || plan.status === "completed" || plan.status === "cancelled") {
      return buildActionSuccessResult(
        action.type,
        {
          id: action.sheddingId,
          cancelled: false,
          message: `Shedding plan ${action.sheddingId} ist nicht (mehr) aktiv; keine Änderung.`,
        },
        "write"
      );
    }

    return buildActionSuccessResult(
      action.type,
      {
        id: action.sheddingId,
        cancelled: true,
        summary: `Shedding plan ${action.sheddingId} (${plan.target_consumer_id}, -${plan.amount}) cancelled.`,
      },
      "write",
      [
        {
          op: "set",
          path: ["domains", "energy", "shedding", "plans", action.sheddingId, "status"],
          value: "cancelled",
        },
      ]
    );
  },
};

export const energyActionHandlers = [
  gridStatusHandler,
  consumerListHandler,
  consumerInspectHandler,
  priorityListHandler,
  sheddingListHandler,
  prioritySetHandler,
  sheddingScheduleHandler,
  sheddingClearHandler,
];

export function registerEnergyActions(registry: DomainActionRegistry) {
  energyActionHandlers.forEach((handler) =>
    registry.register(handler as DomainActionHandler<EnergyDomainAction>)
  );
}
