import type { CommandEffectClass, CommandRequest, CommandRegistry, CommandResult } from "./commands";
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
      permissionClass: CommandEffectClass;
    }
  | {
      type: "allow_always";
      permissionClass: CommandEffectClass;
    }
  | {
      type: "deny";
      commandName: string;
      permissionClass: CommandEffectClass;
    };

export function allow_once(commandName: string, permissionClass: CommandEffectClass): PermissionDecision {
  return {
    type: "allow_once",
    commandName,
    permissionClass,
  };
}

export function allow_always(permissionClass: CommandEffectClass): PermissionDecision {
  return {
    type: "allow_always",
    permissionClass,
  };
}

export function deny(commandName: string, permissionClass: CommandEffectClass): PermissionDecision {
  return {
    type: "deny",
    commandName,
    permissionClass,
  };
}

export type PermissionRule = {
  permissionClass: CommandEffectClass;
  defaultStatus: PermissionStatus;
};

const DEFAULT_PERMISSION_RULES: Record<CommandEffectClass, PermissionRule> = {
  read_only: { permissionClass: "read_only", defaultStatus: allowed() },
  world_prepare: { permissionClass: "world_prepare", defaultStatus: requires_approval() },
  world_mutation: { permissionClass: "world_mutation", defaultStatus: requires_approval() },
};

export type PermissionState = {
  alwaysAllowedPermissionClasses: Set<CommandEffectClass>;
};

export function createInitialPermissionState(): PermissionState {
  return {
    alwaysAllowedPermissionClasses: new Set(),
  };
}

export function evaluatePermission(
  commandRequest: CommandRequest,
  permissionState: PermissionState
): PermissionStatus {
  const permissionClass = commandRequest.permissionClass ?? "read_only";
  if (permissionClass === "read_only") {
    return allowed();
  }

  if (permissionState.alwaysAllowedPermissionClasses.has(permissionClass)) {
    return allowed();
  }

  return DEFAULT_PERMISSION_RULES[permissionClass]?.defaultStatus ?? requires_approval();
}

export function applyPermissionDecision(
  commandRequest: CommandRequest,
  decision: PermissionDecision,
  permissionState: PermissionState
): PermissionState {
  if (decision.type === "allow_always") {
    return {
      alwaysAllowedPermissionClasses: new Set([
        ...permissionState.alwaysAllowedPermissionClasses,
        decision.permissionClass,
      ]),
    };
  }

  return permissionState;
}

export function executeCommandWithPermissions(
  request: CommandRequest,
  registry: CommandRegistry,
  state: WorldState,
  permissionState: PermissionState
): { result: CommandResult; permissionState: PermissionState } {
  const handler = registry.getHandler(request.name);
  if (!handler) {
    return {
      result: {
        success: false,
        command: request,
        effect: "read_only",
        readOnly: true,
        output: null,
        error: `Unknown command ${request.name}`,
      },
      permissionState,
    };
  }

  const requestWithClass: CommandRequest = {
    ...request,
    permissionClass: handler.effect,
  };

  const status = evaluatePermission(requestWithClass, permissionState);
  if (status === denied()) {
    return {
      result: {
        success: false,
        command: requestWithClass,
        effect: handler.effect,
        readOnly: handler.effect === "read_only",
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
        command: requestWithClass,
        effect: handler.effect,
        readOnly: handler.effect === "read_only",
        output: null,
        error: `Requires approval for ${request.name}`,
      },
      permissionState,
    };
  }

  const result = registry.execute(requestWithClass, state);
  return {
    result,
    permissionState,
  };
}
