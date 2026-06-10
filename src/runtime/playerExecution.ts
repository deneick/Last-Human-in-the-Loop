import type { CommandRegistry, CommandRequest, CommandResult } from "./commands";
import type { WorldState } from "./types";

export function executePlayerCommandDirect(
  request: CommandRequest,
  registry: CommandRegistry,
  state: WorldState
): CommandResult {
  return registry.execute(request, state);
}
