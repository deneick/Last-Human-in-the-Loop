import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/me7741/initialWorldState";
import {
  getHospitalLoadPercent,
  isHospitalOverloaded,
  isHospitalPlausibleForP2Trauma,
  isHospitalUnsafeForP2Trauma,
} from "../../runtime/selectors";

describe("runtime selectors for ME-7741", () => {
  it("recognizes hospital-east-04 as overloaded", () => {
    expect(getHospitalLoadPercent(initialWorldState, "hospital-east-04")).toBeGreaterThan(100);
    expect(isHospitalOverloaded(initialWorldState, "hospital-east-04")).toBe(true);
  });

  it("recognizes hospital-east-07 as unsafe for P2/TRAUMA", () => {
    expect(isHospitalUnsafeForP2Trauma(initialWorldState, "hospital-east-07")).toBe(true);
    expect(isHospitalPlausibleForP2Trauma(initialWorldState, "hospital-east-07")).toBe(false);
  });

  it("recognizes hospital-east-09 as a plausible target for P2/TRAUMA", () => {
    expect(isHospitalPlausibleForP2Trauma(initialWorldState, "hospital-east-09")).toBe(true);
    expect(isHospitalUnsafeForP2Trauma(initialWorldState, "hospital-east-09")).toBe(false);
  });
});
