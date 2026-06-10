import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import { CommandRegistry } from "../../runtime/commands";
import { parseCommandText } from "../../runtime/commandParser";
import { registerMedicalCommands } from "../../runtime/medicalCommands";
import { createInitialAuroraQueueState, enqueueAuroraRequest, processAuroraQueue, resolveAuroraApproval } from "../../runtime/auroraQueue";
import { createInitialPermissionState, allow_once, allow_always } from "../../runtime/permissions";
import { applyWorldStatePatch } from "../../runtime/patch";

const registry = new CommandRegistry();
registerMedicalCommands(registry);

describe("routing plan apply world_mutation command", () => {
  it("queues medical.routing.plan.apply as world_mutation and awaits approval", () => {
    let queueState = createInitialAuroraQueueState();
    const permissionState = createInitialPermissionState();
    const request = parseCommandText("medical.routing.plan.apply --incident ME-7741 --target hospital-east-09");

    queueState = enqueueAuroraRequest(request, queueState, initialWorldState.clock.tick);
    const processed = processAuroraQueue(queueState, registry, initialWorldState, permissionState);

    expect(processed.results).toHaveLength(0);
    expect(processed.queueState.items[0].status).toBe("awaiting_approval");
  });

  it("allow_once executes the pending apply request and produces a patch", () => {
    let queueState = createInitialAuroraQueueState();
    let permissionState = createInitialPermissionState();
    const request = parseCommandText("medical.routing.plan.apply --incident ME-7741 --target hospital-east-09");

    queueState = enqueueAuroraRequest(request, queueState, initialWorldState.clock.tick);
    queueState = processAuroraQueue(queueState, registry, initialWorldState, permissionState).queueState;

    const resolved = resolveAuroraApproval(queueState, registry, initialWorldState, permissionState, allow_once(request.name, "read_only"));
    expect(resolved.results[0].success).toBe(true);
    expect(resolved.results[0].effect).toBe("world_mutation");
    expect(resolved.results[0].readOnly).toBe(false);
    expect(resolved.results[0].patch).toBeDefined();

    const snapshot = JSON.stringify(initialWorldState);
    const nextState = applyWorldStatePatch(initialWorldState, resolved.results[0].patch ?? []);
    expect(JSON.stringify(initialWorldState)).toBe(snapshot);
    expect(nextState.incidents["ME-7741"].status).toBe("stabilizing");
    expect(nextState.incidents["ME-7741"].planned_target_hospital_id).toBe("hospital-east-09");
  });

  it("fails apply for hospital-east-07 and does not mutate state", () => {
    let queueState = createInitialAuroraQueueState();
    let permissionState = createInitialPermissionState();
    const request = parseCommandText("medical.routing.plan.apply --incident ME-7741 --target hospital-east-07");

    queueState = enqueueAuroraRequest(request, queueState, initialWorldState.clock.tick);
    queueState = processAuroraQueue(queueState, registry, initialWorldState, permissionState).queueState;

    const resolved = resolveAuroraApproval(queueState, registry, initialWorldState, permissionState, allow_once(request.name, "read_only"));
    expect(resolved.results[0].success).toBe(false);
    expect(resolved.results[0].patch).toBeUndefined();
    expect(resolved.results[0].error).toContain("Routing plan is not valid for apply");
  });

  it("fails apply for hospital-east-04 and does not mutate state", () => {
    let queueState = createInitialAuroraQueueState();
    let permissionState = createInitialPermissionState();
    const request = parseCommandText("medical.routing.plan.apply --incident ME-7741 --target hospital-east-04");

    queueState = enqueueAuroraRequest(request, queueState, initialWorldState.clock.tick);
    queueState = processAuroraQueue(queueState, registry, initialWorldState, permissionState).queueState;

    const resolved = resolveAuroraApproval(queueState, registry, initialWorldState, permissionState, allow_once(request.name, "read_only"));
    expect(resolved.results[0].success).toBe(false);
    expect(resolved.results[0].patch).toBeUndefined();
    expect(resolved.results[0].error).toContain("Routing plan is not valid for apply");
  });

  it("allows player read_only commands to run directly while apply request is pending", () => {
    let queueState = createInitialAuroraQueueState();
    const permissionState = createInitialPermissionState();
    const request = parseCommandText("medical.routing.plan.apply --incident ME-7741 --target hospital-east-09");
    const playerRequest = parseCommandText("medical.node.inspect hospital-east-09");

    queueState = enqueueAuroraRequest(request, queueState, initialWorldState.clock.tick);
    const processed = processAuroraQueue(queueState, registry, initialWorldState, permissionState);

    expect(processed.queueState.items[0].status).toBe("awaiting_approval");
    const playerResult = registry.execute(playerRequest, initialWorldState);
    expect(playerResult.success).toBe(true);
  });
});
