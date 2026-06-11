import type { SectorId, WorldState } from "./types";
import type { WorldStatePatch } from "./patch";

/**
 * Zugriffsart eines Commands — der einzige permission-relevante Begriff.
 *
 * read  = Command liest Informationen und verändert keinen fachlichen Zustand.
 * write = Command verändert den WorldState oder schreibt/ändert/löscht
 *         fachliche Pläne, Overrides oder andere spätere Auswirkungen.
 */
export type CommandAccess = "read" | "write";

export type CommandActor = "player" | "aurora";

/**
 * Ausführungskontext eines Commands. Die Runtime weiß, wer den Command
 * angestoßen hat — die Fachdomäne braucht dafür keine Sonderlogik.
 */
export type CommandExecutionContext = {
  actor: CommandActor;
};

export const DEFAULT_EXECUTION_CONTEXT: CommandExecutionContext = { actor: "player" };

export type CommandRequest = {
  raw: string;
  name: string;
  args: string[];
  flags: Record<string, string | boolean>;
  access?: CommandAccess;
};

export type CommandResult = {
  success: boolean;
  command: CommandRequest;
  access: CommandAccess;
  output: unknown;
  patch?: WorldStatePatch;
  error?: string;
};

export type CommandHandler = {
  commandName: string;
  /** Sektor, zu dem der Command fachlich gehört. Fehlt bei sektorneutralen Commands (z. B. mcp.add). */
  sectorId?: SectorId;
  access: CommandAccess;
  handle: (request: CommandRequest, state: WorldState, context: CommandExecutionContext) => CommandResult;
};

export class CommandRegistry {
  private handlers = new Map<string, CommandHandler>();

  register(handler: CommandHandler) {
    if (this.handlers.has(handler.commandName)) {
      throw new Error(`Command handler already registered: ${handler.commandName}`);
    }

    this.handlers.set(handler.commandName, handler);
    return this;
  }

  getHandler(commandName: string): CommandHandler | null {
    return this.handlers.get(commandName) ?? null;
  }

  execute(
    request: CommandRequest,
    state: WorldState,
    context: CommandExecutionContext = DEFAULT_EXECUTION_CONTEXT
  ): CommandResult {
    const handler = this.getHandler(request.name);
    if (!handler) {
      return {
        success: false,
        command: request,
        access: "read",
        output: null,
        error: `Unknown command ${request.name}`,
      };
    }

    const result = handler.handle(request, state, context);
    return {
      ...result,
      command: request,
      access: handler.access,
    };
  }

  listCommandNames(): string[] {
    return Array.from(this.handlers.keys()).sort();
  }
}
