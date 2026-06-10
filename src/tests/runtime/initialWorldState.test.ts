import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";

describe("ME-7741 initial world state", () => {
  it("contains the medical-east region with the expected hospitals", () => {
    const region = initialWorldState.domains.medical.regions["medical-east"];

    expect(region).toBeDefined();
    expect(region.hospital_ids).toEqual([
      "hospital-east-04",
      "hospital-east-07",
      "hospital-east-09",
    ]);
  });

  it("defines hospital-east-04, hospital-east-07 and hospital-east-09", () => {
    expect(initialWorldState.domains.medical.hospitals["hospital-east-04"]).toBeDefined();
    expect(initialWorldState.domains.medical.hospitals["hospital-east-07"]).toBeDefined();
    expect(initialWorldState.domains.medical.hospitals["hospital-east-09"]).toBeDefined();
  });
});
