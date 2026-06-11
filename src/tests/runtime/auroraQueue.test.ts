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

const invalidWriteCommand: CommandHandler = {
  commandName: "test.write.invalid",
  access: "write",
  handle(request, state) {
    const hospitalId = request.args[0];
    if (!hospitalId || !state.domains.medical.hospitals[hospitalId]) {
      return {
        success: false,
        command: request,
        access: "write",
        output: null,
        error: `Hospital not found: ${hospitalId}`,
      };
    }

    return {
      success: true,
      command: request,
      access: "write",
      output: { hospitalId },
    };
  },
};

registry.register(invalidWriteCommand);

describe("AURORA request queue", () => {
  it("executes an AURORA read request when the queue is free", () => {
    let queueState = createInitialAuroraQueueState();
    const permissionState = createInitialPermissionState();
    const request = parseCommandText("medical.node.inspect hospital-east-09");

    queueState = enqueueAuroraRequest(request, queueState, initialWorldState.clock.tick);
    const processed = processAuroraQueue(queueState, registry, initialWorldState, permissionState);

    expect(processed.results).toHaveLength(1);
    expect(processed.results[0].success).toBe(true);
    expect(processed.queueState.items[0].status).toBe("executed");
  });

  it("marks an AURORA write request as awaiting_approval and does not execute it", () => {
    let queueState = createInitialAuroraQueueState();
    const permissionState = createInitialPermissionState();
    const request = parseCommandText("medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA");

    queueState = enqueueAuroraRequest(request, queueState, initialWorldState.clock.tick);
    const processed = processAuroraQueue(queueState, registry, initialWorldState, permissionState);

    expect(processed.results).toHaveLength(0);
    expect(processed.queueState.items[0].status).toBe("awaiting_approval");
  });

  it("keeps later AURORA read requests queued behind an awaiting_approval request", () => {
    let queueState = createInitialAuroraQueueState();
    const permissionState = createInitialPermissionState();
    const first = parseCommandText("medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA");
    const second = parseCommandText("medical.node.inspect hospital-east-09");

    queueState = enqueueAuroraRequest(first, queueState, initialWorldState.clock.tick);
    queueState = enqueueAuroraRequest(second, queueState, initialWorldState.clock.tick + 1);
    const processed = processAuroraQueue(queueState, registry, initialWorldState, permissionState);

    expect(processed.results).toHaveLength(0);
    expect(processed.queueState.items[0].status).toBe("awaiting_approval");
    expect(processed.queueState.items[1].status).toBe("pending");
  });

  it("executes a player read command directly even when AURORA queue is blocked", () => {
    let queueState = createInitialAuroraQueueState();
    const permissionState = createInitialPermissionState();
    const auroraRequest = parseCommandText("medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA");
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
    const request = parseCommandText("medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA");

    queueState = enqueueAuroraRequest(request, queueState, initialWorldState.clock.tick);
    queueState = processAuroraQueue(queueState, registry, initialWorldState, permissionState).queueState;
    const resolved = resolveAuroraApproval(queueState, registry, initialWorldState, permissionState, allow_once(request.name, "write"));

    expect(resolved.results[0].success).toBe(true);
    expect(resolved.results[0].access).toBe("write");
    expect(resolved.permissionState.alwaysAllowedAccess.size).toBe(0);

    const secondQueueState = createInitialAuroraQueueState();
    const secondRequest = parseCommandText("medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA");
    const requeue = enqueueAuroraRequest(secondRequest, secondQueueState, initialWorldState.clock.tick + 1);
    const secondProcessed = processAuroraQueue(requeue, registry, initialWorldState, resolved.permissionState);
    expect(secondProcessed.queueState.items[0].status).toBe("awaiting_approval");
  });

  it("deny marks the awaiting AURORA request as denied and does not persist a denial", () => {
    let queueState = createInitialAuroraQueueState();
    let permissionState = createInitialPermissionState();
    const request = parseCommandText("medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA");

    queueState = enqueueAuroraRequest(request, queueState, initialWorldState.clock.tick);
    queueState = processAuroraQueue(queueState, registry, initialWorldState, permissionState).queueState;
    const resolved = resolveAuroraApproval(queueState, registry, initialWorldState, permissionState, deny(request.name, "write"));

    expect(resolved.results[0].success).toBe(false);
    expect(resolved.results[0].error).toContain("Permission denied");
    expect(resolved.results[0].access).toBe("write");
    expect(resolved.permissionState.alwaysAllowedAccess.size).toBe(0);
  });

  it("allow_always stores the access from the handler and allows later AURORA requests with that access", () => {
    let queueState = createInitialAuroraQueueState();
    let permissionState = createInitialPermissionState();
    const first = parseCommandText("medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA");
    const second = parseCommandText("medical.routing.override.set --source hospital-east-04 --target hospital-east-07 --priority P2 --capability TRAUMA");

    queueState = enqueueAuroraRequest(first, queueState, initialWorldState.clock.tick);
    queueState = enqueueAuroraRequest(second, queueState, initialWorldState.clock.tick + 1);
    queueState = processAuroraQueue(queueState, registry, initialWorldState, permissionState).queueState;

    const resolved = resolveAuroraApproval(queueState, registry, initialWorldState, permissionState, allow_always("read"));
    expect(resolved.permissionState.alwaysAllowedAccess.has("write")).toBe(true);
    expect(resolved.permissionState.alwaysAllowedAccess.has("read")).toBe(false);
    expect(resolved.results[0].success).toBe(true);
    expect(resolved.queueState.items[0].status).toBe("executed");
    expect(resolved.queueState.items[1].status).toBe("executed");
  });

  it("processes dependent AURORA commands against the world state advanced by earlier patches", () => {
    let queueState = createInitialAuroraQueueState();
    const setRequest = parseCommandText(
      "medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA"
    );
    const clearRequest = parseCommandText("medical.routing.override.clear --id override-1");
    const permissionState = applyPermissionDecision(
      setRequest,
      allow_always("write"),
      createInitialPermissionState()
    );

    queueState = enqueueAuroraRequest(setRequest, queueState, initialWorldState.clock.tick);
    queueState = enqueueAuroraRequest(clearRequest, queueState, initialWorldState.clock.tick);
    const processed = processAuroraQueue(queueState, registry, initialWorldState, permissionState);

    expect(processed.results).toHaveLength(2);
    expect(processed.results[0].success).toBe(true);
    // Der Clear muss das vom Set erzeugte Override sehen, sonst wäre removed=false.
    expect(processed.results[1].success).toBe(true);
    expect((processed.results[1].output as { removed: boolean }).removed).toBe(true);
    expect(processed.results[1].patch).toBeDefined();
    expect(processed.queueState.items[0].status).toBe("executed");
    expect(processed.queueState.items[1].status).toBe("executed");

    // Der echte WorldState wird weiterhin nur über die zurückgegebenen Patches aktualisiert.
    expect(
      "hospital-east-04:P2:TRAUMA" in initialWorldState.domains.medical.routing.manual_overrides
    ).toBe(false);
  });

  it("applies the approved command's patch before processing dependent queue entries after allow_always", () => {
    let queueState = createInitialAuroraQueueState();
    const permissionState = createInitialPermissionState();
    const setRequest = parseCommandText(
      "medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA"
    );
    const clearRequest = parseCommandText("medical.routing.override.clear --id override-1");

    queueState = enqueueAuroraRequest(setRequest, queueState, initialWorldState.clock.tick);
    queueState = enqueueAuroraRequest(clearRequest, queueState, initialWorldState.clock.tick + 1);
    queueState = processAuroraQueue(queueState, registry, initialWorldState, permissionState).queueState;
    expect(queueState.items[0].status).toBe("awaiting_approval");
    expect(queueState.items[1].status).toBe("pending");

    const resolved = resolveAuroraApproval(
      queueState,
      registry,
      initialWorldState,
      permissionState,
      allow_always("write")
    );

    expect(resolved.results).toHaveLength(2);
    expect(resolved.results[0].success).toBe(true);
    // Der nachgelagerte Clear läuft gegen den fortgeschriebenen Zustand inkl. Set-Patch.
    expect(resolved.results[1].success).toBe(true);
    expect((resolved.results[1].output as { removed: boolean }).removed).toBe(true);
    expect(resolved.queueState.items[0].status).toBe("executed");
    expect(resolved.queueState.items[1].status).toBe("executed");
  });

  it("executes an allowed pending AURORA request against the current world state and returns a normal command error if invalid", () => {
    let queueState = createInitialAuroraQueueState();
    let permissionState = createInitialPermissionState();
    const request = parseCommandText("test.write.invalid hospital-east-09");

    queueState = enqueueAuroraRequest(request, queueState, initialWorldState.clock.tick);
    queueState = processAuroraQueue(queueState, registry, initialWorldState, permissionState).queueState;

    const modifiedState = JSON.parse(JSON.stringify(initialWorldState));
    delete (modifiedState as any).domains.medical.hospitals["hospital-east-09"];

    const resolved = resolveAuroraApproval(queueState, registry, modifiedState, permissionState, allow_always("write"));
    expect(resolved.results[0].success).toBe(false);
    expect(resolved.results[0].error).toContain("Hospital not found");
  });
});
