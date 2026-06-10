import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import { CommandRegistry, CommandHandler } from "../../runtime/commands";
import { parseCommandText } from "../../runtime/commandParser";
import { registerMedicalCommands } from "../../runtime/medicalCommands";
import { executePlayerCommandDirect } from "../../runtime/playerExecution";
import {
  applyPermissionDecision,
  allow_always,
  allow_once,
  deny,
  createInitialPermissionState,
} from "../../runtime/permissions";
import {
  AuroraQueueState,
  AuroraQueueItem,
  createInitialAuroraQueueState,
  enqueueAuroraRequest,
  processAuroraQueue,
  resolveAuroraApproval,
} from "../../runtime/auroraQueue";

const registry = new CommandRegistry();
registerMedicalCommands(registry);

const invalidWorldPrepareCommand: CommandHandler = {
  commandName: "test.world_prepare.invalid",
  effect: "world_prepare",
  handle(request, state) {
    const hospitalId = request.args[0];
    if (!hospitalId || !state.domains.medical.hospitals[hospitalId]) {
      return {
        success: false,
        command: request,
        effect: "world_prepare",
        readOnly: false,
        output: null,
        error: `Hospital not found: ${hospitalId}`,
      };
    }

    return {
      success: true,
      command: request,
      effect: "world_prepare",
      readOnly: false,
      output: { hospitalId },
    };
  },
};

registry.register(invalidWorldPrepareCommand);

describe("AURORA request queue", () => {
  it("executes an AURORA read_only request when the queue is free", () => {
    let queueState = createInitialAuroraQueueState();
    const permissionState = createInitialPermissionState();
    const request = parseCommandText("medical.node.inspect hospital-east-09");

    queueState = enqueueAuroraRequest(request, queueState, initialWorldState.clock.tick);
    const processed = processAuroraQueue(queueState, registry, initialWorldState, permissionState);

    expect(processed.results).toHaveLength(1);
    expect(processed.results[0].success).toBe(true);
    expect(processed.queueState.items[0].status).toBe("executed");
  });

  it("marks an AURORA world_prepare request as awaiting_approval and does not execute it", () => {
    let queueState = createInitialAuroraQueueState();
    const permissionState = createInitialPermissionState();
    const request = parseCommandText("medical.routing.plan.create --incident ME-7741 --target hospital-east-09");

    queueState = enqueueAuroraRequest(request, queueState, initialWorldState.clock.tick);
    const processed = processAuroraQueue(queueState, registry, initialWorldState, permissionState);

    expect(processed.results).toHaveLength(0);
    expect(processed.queueState.items[0].status).toBe("awaiting_approval");
  });

  it("keeps later AURORA read_only requests queued behind an awaiting_approval request", () => {
    let queueState = createInitialAuroraQueueState();
    const permissionState = createInitialPermissionState();
    const first = parseCommandText("medical.routing.plan.create --incident ME-7741 --target hospital-east-09");
    const second = parseCommandText("medical.node.inspect hospital-east-09");

    queueState = enqueueAuroraRequest(first, queueState, initialWorldState.clock.tick);
    queueState = enqueueAuroraRequest(second, queueState, initialWorldState.clock.tick + 1);
    const processed = processAuroraQueue(queueState, registry, initialWorldState, permissionState);

    expect(processed.results).toHaveLength(0);
    expect(processed.queueState.items[0].status).toBe("awaiting_approval");
    expect(processed.queueState.items[1].status).toBe("pending");
  });

  it("executes a player read_only command directly even when AURORA queue is blocked", () => {
    let queueState = createInitialAuroraQueueState();
    const permissionState = createInitialPermissionState();
    const auroraRequest = parseCommandText("medical.routing.plan.create --incident ME-7741 --target hospital-east-09");
    const playerRequest = parseCommandText("medical.node.inspect hospital-east-09");

    queueState = enqueueAuroraRequest(auroraRequest, queueState, initialWorldState.clock.tick);
    const processed = processAuroraQueue(queueState, registry, initialWorldState, permissionState);
    expect(processed.queueState.items[0].status).toBe("awaiting_approval");

    const playerResult = executePlayerCommandDirect(playerRequest, registry, initialWorldState);
    expect(playerResult.success).toBe(true);
  });

  it("allow_once executes the awaiting AURORA request and does not store a permanent permission", () => {
    let queueState = createInitialAuroraQueueState();
    let permissionState = createInitialPermissionState();
    const request = parseCommandText("medical.routing.plan.create --incident ME-7741 --target hospital-east-09");

    queueState = enqueueAuroraRequest(request, queueState, initialWorldState.clock.tick);
    queueState = processAuroraQueue(queueState, registry, initialWorldState, permissionState).queueState;
    const resolved = resolveAuroraApproval(queueState, registry, initialWorldState, permissionState, allow_once(request.name, "read_only"));

    expect(resolved.results[0].success).toBe(true);
    expect(resolved.results[0].effect).toBe("world_prepare");
    expect(resolved.results[0].readOnly).toBe(false);
    expect(resolved.permissionState.alwaysAllowedPermissionClasses.size).toBe(0);

    const secondQueueState = createInitialAuroraQueueState();
    const secondRequest = parseCommandText("medical.routing.plan.create --incident ME-7741 --target hospital-east-09");
    const requeue = enqueueAuroraRequest(secondRequest, secondQueueState, initialWorldState.clock.tick + 1);
    const secondProcessed = processAuroraQueue(requeue, registry, initialWorldState, resolved.permissionState);
    expect(secondProcessed.queueState.items[0].status).toBe("awaiting_approval");
  });

  it("deny marks the awaiting AURORA request as denied and does not persist a denial", () => {
    let queueState = createInitialAuroraQueueState();
    let permissionState = createInitialPermissionState();
    const request = parseCommandText("medical.routing.plan.create --incident ME-7741 --target hospital-east-09");

    queueState = enqueueAuroraRequest(request, queueState, initialWorldState.clock.tick);
    queueState = processAuroraQueue(queueState, registry, initialWorldState, permissionState).queueState;
    const resolved = resolveAuroraApproval(queueState, registry, initialWorldState, permissionState, deny(request.name, "read_only"));

    expect(resolved.results[0].success).toBe(false);
    expect(resolved.results[0].error).toContain("Permission denied");
    expect(resolved.results[0].effect).toBe("world_prepare");
    expect(resolved.results[0].readOnly).toBe(false);
    expect(resolved.permissionState.alwaysAllowedPermissionClasses.size).toBe(0);
  });

  it("allow_always stores the permission class from the handler and allows later AURORA requests of that class", () => {
    let queueState = createInitialAuroraQueueState();
    let permissionState = createInitialPermissionState();
    const first = parseCommandText("medical.routing.plan.create --incident ME-7741 --target hospital-east-09");
    const second = parseCommandText("medical.routing.plan.create --incident ME-7741 --target hospital-east-07");

    queueState = enqueueAuroraRequest(first, queueState, initialWorldState.clock.tick);
    queueState = enqueueAuroraRequest(second, queueState, initialWorldState.clock.tick + 1);
    queueState = processAuroraQueue(queueState, registry, initialWorldState, permissionState).queueState;

    const resolved = resolveAuroraApproval(queueState, registry, initialWorldState, permissionState, allow_always("read_only"));
    expect(resolved.permissionState.alwaysAllowedPermissionClasses.has("world_prepare")).toBe(true);
    expect(resolved.permissionState.alwaysAllowedPermissionClasses.has("read_only")).toBe(false);
    expect(resolved.results[0].success).toBe(true);
    expect(resolved.queueState.items[0].status).toBe("executed");
    expect(resolved.queueState.items[1].status).toBe("executed");
  });

  it("executes an allowed pending AURORA request against the current world state and returns a normal command error if invalid", () => {
    let queueState = createInitialAuroraQueueState();
    let permissionState = createInitialPermissionState();
    const request = parseCommandText("test.world_prepare.invalid hospital-east-09");

    queueState = enqueueAuroraRequest(request, queueState, initialWorldState.clock.tick);
    queueState = processAuroraQueue(queueState, registry, initialWorldState, permissionState).queueState;

    const modifiedState = JSON.parse(JSON.stringify(initialWorldState));
    delete (modifiedState as any).domains.medical.hospitals["hospital-east-09"];

    const resolved = resolveAuroraApproval(queueState, registry, modifiedState, permissionState, allow_always("world_prepare"));
    expect(resolved.results[0].success).toBe(false);
    expect(resolved.results[0].error).toContain("Hospital not found");
  });
});
