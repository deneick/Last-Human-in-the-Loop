import type { DomainActionAccess } from "../domain/actions";

/**
 * Permission-Engine für Aurora-Anfragen.
 *
 * Subjects:
 * - mcp_tool: Jeder MCP-Tool-Call (auch read) läuft durch die Permission-Queue,
 *   außer es existiert ein allowAlways für den EXAKTEN Tool-Key
 *   (z. B. "mcp:medical-east-mcp:routing_override_set"). Die Aktivierung eines
 *   MCP-Servers erteilt keine Ausführungsrechte.
 * - bash: Generische Shell-Commands. Reads (mcp list, ls, cat, read_file)
 *   laufen frei; die einzige schreibende Operation (`mcp add <server>`)
 *   braucht eine Freigabe, außer "write" wurde dauerhaft erlaubt.
 */

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

export type PermissionSubject =
  | {
      kind: "mcp_tool";
      /** Exakter Tool-Key, z. B. "mcp:medical-east-mcp:capacity_list". */
      toolKey: string;
      access: DomainActionAccess;
    }
  | {
      kind: "bash";
      command: string;
      access: DomainActionAccess;
    };

export type PermissionDecisionType = "allow_once" | "allow_always" | "deny";

export type PermissionDecision = {
  type: PermissionDecisionType;
};

export function allow_once(): PermissionDecision {
  return { type: "allow_once" };
}

export function allow_always(): PermissionDecision {
  return { type: "allow_always" };
}

export function deny(): PermissionDecision {
  return { type: "deny" };
}

export type PermissionState = {
  /** Dauerhafte Freigaben für Bash-Zugriffsarten (praktisch: "write" für mcp add). */
  alwaysAllowedAccess: Set<DomainActionAccess>;
  /** Dauerhafte Freigaben für exakte MCP-Tool-Keys. */
  allowAlwaysMcpToolKeys: Set<string>;
};

export function createInitialPermissionState(): PermissionState {
  return {
    alwaysAllowedAccess: new Set(),
    allowAlwaysMcpToolKeys: new Set(),
  };
}

export function evaluatePermission(
  subject: PermissionSubject,
  permissionState: PermissionState
): PermissionStatus {
  if (subject.kind === "mcp_tool") {
    // Auch read-Tools brauchen eine Freigabe — nur der exakte Tool-Key zählt.
    return permissionState.allowAlwaysMcpToolKeys.has(subject.toolKey)
      ? allowed()
      : requires_approval();
  }

  if (subject.access === "read") {
    return allowed();
  }

  return permissionState.alwaysAllowedAccess.has(subject.access)
    ? allowed()
    : requires_approval();
}

export function applyPermissionDecision(
  subject: PermissionSubject,
  decision: PermissionDecision,
  permissionState: PermissionState
): PermissionState {
  if (decision.type !== "allow_always") {
    return permissionState;
  }

  if (subject.kind === "mcp_tool") {
    return {
      ...permissionState,
      allowAlwaysMcpToolKeys: new Set([
        ...permissionState.allowAlwaysMcpToolKeys,
        subject.toolKey,
      ]),
    };
  }

  return {
    ...permissionState,
    alwaysAllowedAccess: new Set([...permissionState.alwaysAllowedAccess, subject.access]),
  };
}
