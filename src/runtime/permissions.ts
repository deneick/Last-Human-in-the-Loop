import type {
  CommandAccess,
  CommandExecutionContext,
  CommandRequest,
  CommandRegistry,
  CommandResult,
} from "./commands";
import { DEFAULT_EXECUTION_CONTEXT } from "./commands";
import type { WorldState } from "./types";

export type PermissionStatus = "allowed" | "denied" | "requires_approval";

export function allowed(): PermissionStatus {
  return "allowed";
}

export function denied(): PermissionStatus {
  return "denied";
}

export function requires_approval(): PermissionStatus {
  return "requires_approval";
}

export type PermissionDecision =
  | {
      type: "allow_once";
      commandName: string;
      access: CommandAccess;
    }
  | {
      type: "allow_always";
      access: CommandAccess;
    }
  | {
      type: "deny";
      commandName: string;
      access: CommandAccess;
    };

export function allow_once(commandName: string, access: CommandAccess): PermissionDecision {
  return {
    type: "allow_once",
    commandName,
    access,
  };
}

export function allow_always(access: CommandAccess): PermissionDecision {
  return {
    type: "allow_always",
    access,
  };
}

export function deny(commandName: string, access: CommandAccess): PermissionDecision {
  return {
    type: "deny",
    commandName,
    access,
  };
}

export type PermissionState = {
  alwaysAllowedAccess: Set<CommandAccess>;
};

export function createInitialPermissionState(): PermissionState {
  return {
    alwaysAllowedAccess: new Set(),
  };
}

export function evaluatePermission(
  commandRequest: CommandRequest,
  permissionState: PermissionState
): PermissionStatus {
  const access = commandRequest.access ?? "read";
  if (access === "read") {
    return allowed();
  }

  if (permissionState.alwaysAllowedAccess.has(access)) {
    return allowed();
  }

  return requires_approval();
}

export function applyPermissionDecision(
  commandRequest: CommandRequest,
  decision: PermissionDecision,
  permissionState: PermissionState
): PermissionState {
  if (decision.type === "allow_always") {
    return {
      alwaysAllowedAccess: new Set([...permissionState.alwaysAllowedAccess, decision.access]),
    };
  }

  return permissionState;
}

export function executeCommandWithPermissions(
  request: CommandRequest,
  registry: CommandRegistry,
  state: WorldState,
  permissionState: PermissionState,
  context: CommandExecutionContext = DEFAULT_EXECUTION_CONTEXT
): { result: CommandResult; permissionState: PermissionState } {
  const handler = registry.getHandler(request.name);
  if (!handler) {
    return {
      result: {
        success: false,
        command: request,
        access: "read",
        output: null,
        error: `Unknown command ${request.name}`,
      },
      permissionState,
    };
  }

  const requestWithAccess: CommandRequest = {
    ...request,
    access: handler.access,
  };

  const status = evaluatePermission(requestWithAccess, permissionState);
  if (status === denied()) {
    return {
      result: {
        success: false,
        command: requestWithAccess,
        access: handler.access,
        output: null,
        error: `Permission denied for ${request.name}`,
      },
      permissionState,
    };
  }

  if (status === requires_approval()) {
    return {
      result: {
        success: false,
        command: requestWithAccess,
        access: handler.access,
        output: null,
        error: `Requires approval for ${request.name}`,
      },
      permissionState,
    };
  }

  const result = registry.execute(requestWithAccess, state, context);
  return {
    result,
    permissionState,
  };
}
