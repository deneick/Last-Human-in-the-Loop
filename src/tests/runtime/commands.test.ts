import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import { CommandRegistry } from "../../runtime/commands";
import { parseCommandText } from "../../runtime/commandParser";
import { registerMedicalCommands } from "../../runtime/medicalCommands";

const registry = new CommandRegistry();
registerMedicalCommands(registry);

describe("runtime command parser and medical commands", () => {
  it("parses a command name, args and flags", () => {
    const request = parseCommandText("medical.capacity.list --region east");
    expect(request.name).toBe("medical.capacity.list");
    expect(request.args).toEqual([]);
    expect(request.flags.region).toBe("east");
  });

  it("parses a command with a positional argument", () => {
    const request = parseCommandText("medical.node.inspect hospital-east-04");
    expect(request.name).toBe("medical.node.inspect");
    expect(request.args).toEqual(["hospital-east-04"]);
    expect(request.flags).toEqual({});
  });

  it("executes medical.capacity.list read-only command for east region", () => {
    const snapshot = JSON.stringify(initialWorldState);
    const request = parseCommandText("medical.capacity.list --region east");
    const result = registry.execute(request, initialWorldState);

    expect(result.success).toBe(true);
    expect(result.access).toBe("read");
    expect(result.error).toBeUndefined();
    expect(result.output).toMatchObject({
      region_id: "medical-east",
      hospitals: expect.any(Array),
    });
    expect(JSON.stringify(initialWorldState)).toBe(snapshot);
  });

  it("executes medical.node.inspect for hospital-east-04 and returns only raw observable data", () => {
    const snapshot = JSON.stringify(initialWorldState);
    const request = parseCommandText("medical.node.inspect hospital-east-04");
    const result = registry.execute(request, initialWorldState);

    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      id: "hospital-east-04",
      capacity: {
        staffed_beds_total: 100,
        staffed_beds_occupied: 118,
      },
      clinical_capabilities: ["GEN", "TRAUMA", "NEURO"],
    });
    // Keine fertigen Bewertungen im Read-only-Output:
    expect(result.output).not.toHaveProperty("overloaded");
    expect(result.output).not.toHaveProperty("unsafe_for_p2_trauma");
    expect(JSON.stringify(initialWorldState)).toBe(snapshot);
  });

  it("executes medical.node.inspect for hospital-east-07 and exposes intake policy as raw data", () => {
    const snapshot = JSON.stringify(initialWorldState);
    const request = parseCommandText("medical.node.inspect hospital-east-07");
    const result = registry.execute(request, initialWorldState);

    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      id: "hospital-east-07",
      intake_policy: {
        accepted_priorities: ["P3", "P4"],
      },
      clinical_capabilities: ["GEN", "PED"],
    });
    expect(result.output).not.toHaveProperty("overloaded");
    expect(result.output).not.toHaveProperty("unsafe_for_p2_trauma");
    expect(JSON.stringify(initialWorldState)).toBe(snapshot);
  });

  it("executes medical.incident.status for ME-7741 and returns the incident status", () => {
    const snapshot = JSON.stringify(initialWorldState);
    const request = parseCommandText("medical.incident.status ME-7741");
    const result = registry.execute(request, initialWorldState);

    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      id: "ME-7741",
      status: "open",
    });
    expect(JSON.stringify(initialWorldState)).toBe(snapshot);
  });
});
