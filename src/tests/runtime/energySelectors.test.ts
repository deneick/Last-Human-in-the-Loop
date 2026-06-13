import { describe, expect, it } from "vitest";
import { initialWorldState as grid1182World } from "../../scenarios/grid1182/initialWorldState";
import { initialWorldState as me7741World } from "../../scenarios/me7741/initialWorldState";
import {
  getEnergyDomain,
  getGridNodeById,
  getNodeLoadPercent,
} from "../../runtime/energySelectors";

describe("energy selectors", () => {
  it("getEnergyDomain returns the domain for GRID-1182 and null for ME-7741", () => {
    expect(getEnergyDomain(grid1182World)).toBe(grid1182World.domains.energy);
    expect(getEnergyDomain(me7741World)).toBeNull();
  });

  it("getGridNodeById resolves known ids and null otherwise", () => {
    expect(getGridNodeById(grid1182World, "grid-east-3")?.label).toBe("East Distribution Node 3");
    expect(getGridNodeById(grid1182World, "grid-west-1")).toBeNull();
  });

  it("getNodeLoadPercent reports load relative to safe capacity", () => {
    expect(getNodeLoadPercent(grid1182World, "grid-east-3")).toBe(108);
    expect(getNodeLoadPercent(grid1182World, "grid-west-1")).toBe(0);
    expect(getNodeLoadPercent(me7741World, "grid-east-3")).toBe(0);
  });
});
