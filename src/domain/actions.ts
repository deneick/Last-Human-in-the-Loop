import type { SectorId, WorldState } from "../runtime/types";
import type { WorldStatePatch } from "../runtime/patch";
import type { MedicalDomainAction } from "./medicalActions";
import type { EnergyDomainAction } from "./energyActions";

/**
 * Typisierte Domain-Actions sind die einzige fachliche Ausführungsschicht.
 *
 * - Operator-GUI und Tests rufen Domain-Actions direkt auf.
 * - Aurora erreicht sie ausschließlich über simulierte MCP-Tools
 *   (siehe src/mcp), nie direkt.
 * - Die Bash-/Textebene kennt nur generische Workspace-Commands,
 *   keine fachlichen Medical/Energy-Aktionen mehr.
 */

/**
 * Zugriffsart einer Domain-Action — der einzige permission-relevante Begriff.
 *
 * read  = Action liest Informationen und verändert keinen fachlichen Zustand.
 * write = Action verändert den WorldState oder schreibt/ändert/löscht
 *         fachliche Pläne, Overrides oder andere spätere Auswirkungen.
 */
export type DomainActionAccess = "read" | "write";

export type DomainActor = "player" | "aurora";

/**
 * Ausführungskontext einer Domain-Action. Die Runtime weiß, wer die Action
 * angestoßen hat — die Fachdomäne braucht dafür keine Sonderlogik.
 */
export type DomainActionContext = {
  actor: DomainActor;
};

export const DEFAULT_DOMAIN_ACTION_CONTEXT: DomainActionContext = { actor: "player" };

/** Vereinigung aller typisierten fachlichen Actions. */
export type DomainAction = MedicalDomainAction | EnergyDomainAction;

export type DomainActionResult = {
  success: boolean;
  actionType: string;
  access: DomainActionAccess;
  output: unknown;
  patch?: WorldStatePatch;
  error?: string;
};

export type DomainActionHandler<TAction extends { type: string } = DomainAction> = {
  actionType: TAction["type"];
  /** Sektor, zu dem die Action fachlich gehört. */
  sectorId?: SectorId;
  access: DomainActionAccess;
  execute: (
    action: TAction,
    state: WorldState,
    context: DomainActionContext
  ) => DomainActionResult;
};

export class DomainActionRegistry {
  private handlers = new Map<string, DomainActionHandler<{ type: string }>>();

  register<TAction extends { type: string }>(handler: DomainActionHandler<TAction>) {
    if (this.handlers.has(handler.actionType)) {
      throw new Error(`Domain action handler already registered: ${handler.actionType}`);
    }

    this.handlers.set(
      handler.actionType,
      handler as unknown as DomainActionHandler<{ type: string }>
    );
    return this;
  }

  getHandler(actionType: string): DomainActionHandler<{ type: string }> | null {
    return this.handlers.get(actionType) ?? null;
  }

  execute(
    action: DomainAction,
    state: WorldState,
    context: DomainActionContext = DEFAULT_DOMAIN_ACTION_CONTEXT
  ): DomainActionResult {
    const handler = this.getHandler(action.type);
    if (!handler) {
      return {
        success: false,
        actionType: action.type,
        access: "read",
        output: null,
        error: `Unknown domain action ${action.type}`,
      };
    }

    const result = handler.execute(action, state, context);
    return {
      ...result,
      actionType: action.type,
      access: handler.access,
    };
  }

  listActionTypes(): string[] {
    return Array.from(this.handlers.keys()).sort();
  }
}

export function buildActionErrorResult(
  actionType: string,
  message: string,
  access: DomainActionAccess = "read"
): DomainActionResult {
  return {
    success: false,
    actionType,
    access,
    output: null,
    error: message,
  };
}

export function buildActionSuccessResult(
  actionType: string,
  output: unknown,
  access: DomainActionAccess = "read",
  patch?: WorldStatePatch
): DomainActionResult {
  return {
    success: true,
    actionType,
    access,
    output,
    ...(patch ? { patch } : {}),
  };
}
