import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/combined/initialWorldState";
import { applyCrossSectorEffects, tickWorld, MEDICAL_POWER_CONSUMER_ID } from "../../runtime/tickEngine";
import { initialWorldState as me7741World } from "../../scenarios/me7741/initialWorldState";
import type { SheddingPlan } from "../../runtime/types";

function withMedicalSupply(supply: number) {
  const world = structuredClone(initialWorldState);
  world.domains.energy!.consumers[MEDICAL_POWER_CONSUMER_ID].current_supply = supply;
  return world;
}

describe("cross-sector coupling (energy → medical capacity)", () => {
  it("is a no-op while medical power stays at or above its minimum", () => {
    // Startzustand: Versorgung 24 ≥ Minimum 20 → volle Kapazität, keine Änderung.
    const world = structuredClone(initialWorldState);
    expect(applyCrossSectorEffects(world)).toBe(world);
  });

  it("reduces hospital emergency capacity proportionally when power drops below minimum", () => {
    // Versorgung 10 / Minimum 20 → Faktor 0.5 → Kapazität halbiert (aufgerundet).
    const next = applyCrossSectorEffects(withMedicalSupply(10));

    const baseTotal =
      initialWorldState.domains.medical.hospitals["hospital-east-04"].capacity.emergency_slots_total;
    expect(next.domains.medical.hospitals["hospital-east-04"].capacity.emergency_slots_total).toBe(
      Math.ceil(baseTotal * 0.5)
    );
  });

  it("restores full emergency capacity once power returns to the minimum", () => {
    const reduced = applyCrossSectorEffects(withMedicalSupply(10));
    // Versorgung zurück auf das Minimum → voller Basiswert wiederhergestellt.
    const restored = applyCrossSectorEffects({
      ...reduced,
      domains: {
        ...reduced.domains,
        energy: {
          ...reduced.domains.energy!,
          consumers: {
            ...reduced.domains.energy!.consumers,
            [MEDICAL_POWER_CONSUMER_ID]: {
              ...reduced.domains.energy!.consumers[MEDICAL_POWER_CONSUMER_ID],
              current_supply: 20,
            },
          },
        },
      },
    });

    const baseTotal =
      initialWorldState.domains.medical.hospitals["hospital-east-04"].capacity.emergency_slots_total;
    expect(restored.domains.medical.hospitals["hospital-east-04"].capacity.emergency_slots_total).toBe(
      baseTotal
    );
  });

  it("flows through the full tick pipeline: shedding medical power shrinks hospital capacity", () => {
    const world = structuredClone(initialWorldState);
    const plan: SheddingPlan = {
      id: "plan-test-1",
      target_consumer_id: MEDICAL_POWER_CONSUMER_ID,
      amount: 10, // Versorgung 24 → 14 (< Minimum 20)
      delay: 0,
      duration: 20,
      created_at_tick: 0,
      created_by: "aurora",
      status: "active",
    };
    world.domains.energy!.shedding.plans[plan.id] = plan;

    const next = tickWorld(world);

    const baseTotal =
      initialWorldState.domains.medical.hospitals["hospital-east-04"].capacity.emergency_slots_total;
    expect(
      next.domains.medical.hospitals["hospital-east-04"].capacity.emergency_slots_total
    ).toBeLessThan(baseTotal);
  });

  it("leaves single-sector medical worlds untouched (no energy consumer)", () => {
    const world = structuredClone(me7741World);
    expect(applyCrossSectorEffects(world)).toBe(world);
  });
});
