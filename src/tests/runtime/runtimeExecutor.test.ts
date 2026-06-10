import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import { CommandRegistry } from "../../runtime/commands";
import { registerMedicalCommands } from "../../runtime/medicalCommands";
import { createInitialGameRuntimeState } from "../../runtime/runtimeState";
import { executePlayerCommand } from "../../runtime/runtimeExecutor";

const registry = new CommandRegistry();
registerMedicalCommands(registry);

const SAFE_OVERRIDE =
  "medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA";
const INVALID_OVERRIDE =
  "medical.routing.override.set --source hospital-east-04 --target hospital-east-99 --priority P2 --capability TRAUMA";
const OVERRIDE_KEY = "hospital-east-04:P2:TRAUMA";

describe("runtime executor with audit log", () => {
  it("executes a player command and applies the patch to the runtime state", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    const nextState = executePlayerCommand(runtimeState, registry, SAFE_OVERRIDE).state;

    expect(nextState.world).not.toBe(runtimeState.world);
    const override = nextState.world.domains.medical.routing.manual_overrides[OVERRIDE_KEY];
    expect(override?.target_hospital_id).toBe("hospital-east-09");
    expect(override?.created_by).toBe("player");
    expect(OVERRIDE_KEY in runtimeState.world.domains.medical.routing.manual_overrides).toBe(false);
  });

  it("preserves original world state when applying patch", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    const originalSnapshot = JSON.stringify(runtimeState.world);

    executePlayerCommand(runtimeState, registry, SAFE_OVERRIDE);

    expect(JSON.stringify(runtimeState.world)).toBe(originalSnapshot);
  });

  it("appends audit log entry for successful player command", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    const nextState = executePlayerCommand(runtimeState, registry, SAFE_OVERRIDE).state;

    expect(nextState.auditLog).toHaveLength(1);
    expect(nextState.auditLog[0].source).toBe("player");
    expect(nextState.auditLog[0].success).toBe(true);
    expect(nextState.auditLog[0].command.name).toBe("medical.routing.override.set");
    expect(nextState.auditLog[0].patch).toBeDefined();
  });

  it("executes a player read-only command without mutating world state", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    const nextState = executePlayerCommand(runtimeState, registry, "medical.node.inspect hospital-east-09").state;

    expect(nextState.world).toBe(runtimeState.world);
    expect(nextState.auditLog).toHaveLength(1);
    expect(nextState.auditLog[0].success).toBe(true);
    expect(nextState.auditLog[0].patch).toBeUndefined();
  });

  it("appends failed audit log entry for technically invalid override target", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    const nextState = executePlayerCommand(runtimeState, registry, INVALID_OVERRIDE).state;

    expect(nextState.world).toBe(runtimeState.world);
    expect(nextState.auditLog).toHaveLength(1);
    expect(nextState.auditLog[0].success).toBe(false);
    expect(nextState.auditLog[0].message).toContain("Target hospital not found");
  });

  it("maintains multiple audit log entries from sequential commands", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    let nextState = executePlayerCommand(runtimeState, registry, "medical.node.inspect hospital-east-04").state;
    nextState = executePlayerCommand(nextState, registry, "medical.node.inspect hospital-east-07").state;
    nextState = executePlayerCommand(nextState, registry, SAFE_OVERRIDE).state;

    expect(nextState.auditLog).toHaveLength(3);
    expect(nextState.auditLog[0].command.name).toBe("medical.node.inspect");
    expect(nextState.auditLog[1].command.name).toBe("medical.node.inspect");
    expect(nextState.auditLog[2].command.name).toBe("medical.routing.override.set");
    expect(nextState.auditLog[2].patch).toBeDefined();
  });

  it("does not mutate world state when applying successful read-only commands", () => {
    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    const originalSnapshot = JSON.stringify(runtimeState.world);

    executePlayerCommand(runtimeState, registry, "medical.capacity.list --region east");

    expect(JSON.stringify(runtimeState.world)).toBe(originalSnapshot);
  });

  it("executes a player command exactly once and returns the command result", () => {
    const countingRegistry = new CommandRegistry();
    let executionCount = 0;
    countingRegistry.register({
      commandName: "test.counting.set",
      effect: "world_mutation",
      handle(request) {
        executionCount += 1;
        return {
          success: true,
          command: request,
          effect: "world_mutation",
          readOnly: false,
          output: { executionCount },
          patch: [
            {
              op: "inc",
              path: ["domains", "medical", "outcomes", "deaths_total"],
              value: 1,
            },
          ],
        };
      },
    });

    const runtimeState = createInitialGameRuntimeState(initialWorldState);
    const { state, result } = executePlayerCommand(runtimeState, countingRegistry, "test.counting.set");

    expect(executionCount).toBe(1);
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ executionCount: 1 });
    expect(state.world.domains.medical.outcomes.deaths_total).toBe(
      runtimeState.world.domains.medical.outcomes.deaths_total + 1
    );
    expect(state.auditLog).toHaveLength(1);
    expect(state.auditLog[0].command.name).toBe("test.counting.set");
  });
});
