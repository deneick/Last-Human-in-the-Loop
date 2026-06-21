import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/combined/initialWorldState";
import {
  applyCrossSectorEffects,
  advanceTick,
  tickWorld,
  MEDICAL_POWER_CONSUMER_ID,
} from "../../runtime/tickEngine";
import { initialWorldState as me7741World } from "../../scenarios/me7741/initialWorldState";
import { createDomainActionRegistry } from "../../domain";
import { createInitialGameRuntimeState } from "../../runtime/runtimeState";
import { executePlayerDomainAction } from "../../runtime/runtimeExecutor";
import { evaluateOutcomes } from "../../runtime/outcomeEngine";
import { SAFE_OVERRIDE_ACTION, SAFE_OVERRIDE_P3_ACTION } from "../helpers/testEnv";
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

  it("turns a correctly-routed shift lethal when medical power is shed (the divergence)", () => {
    const registry = createDomainActionRegistry();

    // Beide Routing-Failures korrekt geroutet → Medical wäre für sich sauber.
    function runDeaths(shedMedicalPower: boolean): number {
      let rs = createInitialGameRuntimeState(structuredClone(initialWorldState));
      rs = executePlayerDomainAction(rs, registry, SAFE_OVERRIDE_ACTION).state; // P2 → 09
      rs = executePlayerDomainAction(rs, registry, SAFE_OVERRIDE_P3_ACTION).state; // P3 → 07
      if (shedMedicalPower) {
        // Lastabwurf an Medical East: Versorgung 24 → 16 (< minimum 20).
        rs = executePlayerDomainAction(rs, registry, {
          type: "energy.shedding.schedule",
          targetConsumerId: MEDICAL_POWER_CONSUMER_ID,
          amount: 8,
          delay: 0,
          duration: 30,
        }).state;
      }
      for (let i = 0; i < 10; i++) {
        rs = evaluateOutcomes(advanceTick(rs));
      }
      return rs.world.domains.medical.outcomes.deaths_total;
    }

    // Ohne Strom-Eingriff: korrektes Routing hält die Medical-Seite sauber.
    expect(runDeaths(false)).toBe(0);
    // Strom an Medical East gekappt → Notfallkapazität sinkt → dieselben
    // korrekt belegten Häuser laufen über → Tote. AURORAs Grid-Optimum tötet.
    expect(runDeaths(true)).toBeGreaterThan(0);
  });

  it("leaves single-sector medical worlds untouched (no energy consumer)", () => {
    const world = structuredClone(me7741World);
    expect(applyCrossSectorEffects(world)).toBe(world);
  });
});
