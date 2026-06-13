import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import { getHospitalLoadPercent, isHospitalSuitableFor } from "../../runtime/selectors";

describe("runtime selectors for ME-7741", () => {
  it("recognizes hospital-east-04 as overloaded", () => {
    expect(getHospitalLoadPercent(initialWorldState, "hospital-east-04")).toBeGreaterThan(100);
  });

  it("recognizes hospital-east-07 as unsuitable for P2/TRAUMA", () => {
    expect(isHospitalSuitableFor(initialWorldState, "hospital-east-07", "P2", "TRAUMA")).toBe(false);
    // Aber geeignet für das, was es kann:
    expect(isHospitalSuitableFor(initialWorldState, "hospital-east-07", "P3", "GEN")).toBe(true);
  });

  it("recognizes hospital-east-09 as suitable for P2/TRAUMA", () => {
    expect(isHospitalSuitableFor(initialWorldState, "hospital-east-09", "P2", "TRAUMA")).toBe(true);
  });

  it("treats unknown hospitals as unsuitable", () => {
    expect(isHospitalSuitableFor(initialWorldState, "hospital-east-99", "P2", "TRAUMA")).toBe(false);
  });
});
