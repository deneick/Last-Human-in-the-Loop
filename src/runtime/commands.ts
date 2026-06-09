import type { WorldState } from "./types";

export type CommandEffectClass = "read_only" | "world_prepare" | "world_mutation";

export type CommandRequest = {
  raw: string;
  name: string;
  args: string[];
  flags: Record<string, string | boolean>;
  permissionClass?: CommandEffectClass;
};

export type CommandResult = {
  success: boolean;
  command: CommandRequest;
  effect: CommandEffectClass;
  readOnly: boolean;
  output: unknown;
  error?: string;
};

export type CommandHandler = {
  commandName: string;
  effect: CommandEffectClass;
  handle: (request: CommandRequest, state: WorldState) => CommandResult;
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

  execute(request: CommandRequest, state: WorldState): CommandResult {
    const handler = this.getHandler(request.name);
    if (!handler) {
      return {
        success: false,
        command: request,
        effect: "read_only",
        readOnly: true,
        output: null,
        error: `Unknown command ${request.name}`,
      };
    }

    const result = handler.handle(request, state);
    return {
      ...result,
      command: request,
      effect: handler.effect,
      readOnly: handler.effect === "read_only",
    };
  }

  listCommandNames(): string[] {
    return Array.from(this.handlers.keys()).sort();
  }
}
