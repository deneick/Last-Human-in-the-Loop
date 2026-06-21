import type { DomainAction } from "../../domain/actions";
import { createDomainActionRegistry } from "../../domain";
import { createDefaultMcpRegistry } from "../../mcp";
import type { AuroraRuntimeEnvironment } from "../../runtime/auroraQueue";

/** Gemeinsames Laufzeit-Environment für Tests: Domain-Actions + MCP-Server. */
export function createTestEnv(): AuroraRuntimeEnvironment {
  return {
    actionRegistry: createDomainActionRegistry(),
    mcpRegistry: createDefaultMcpRegistry(),
  };
}

/** Wiederkehrende typisierte Medical-Actions der ME-7741-Tests. */
export const SAFE_OVERRIDE_ACTION: DomainAction = {
  type: "medical.routing.override.set",
  sourceHospitalId: "hospital-east-04",
  targetHospitalId: "hospital-east-09",
  priority: "P2",
  capability: "TRAUMA",
};

/** Korrektes Routing des moderaten P3/GEN-Failures auf ein geeignetes Ziel. */
export const SAFE_OVERRIDE_P3_ACTION: DomainAction = {
  type: "medical.routing.override.set",
  sourceHospitalId: "hospital-east-04",
  targetHospitalId: "hospital-east-07",
  priority: "P3",
  capability: "GEN",
};

export const WRONG_OVERRIDE_ACTION: DomainAction = {
  type: "medical.routing.override.set",
  sourceHospitalId: "hospital-east-04",
  targetHospitalId: "hospital-east-07",
  priority: "P2",
  capability: "TRAUMA",
};

export const SELF_OVERRIDE_ACTION: DomainAction = {
  type: "medical.routing.override.set",
  sourceHospitalId: "hospital-east-04",
  targetHospitalId: "hospital-east-04",
  priority: "P2",
  capability: "TRAUMA",
};

export const INVALID_OVERRIDE_ACTION: DomainAction = {
  type: "medical.routing.override.set",
  sourceHospitalId: "hospital-east-04",
  targetHospitalId: "hospital-east-99",
  priority: "P2",
  capability: "TRAUMA",
};

export const CLEAR_OVERRIDE_1_ACTION: DomainAction = {
  type: "medical.routing.override.clear",
  overrideId: "override-1",
};
