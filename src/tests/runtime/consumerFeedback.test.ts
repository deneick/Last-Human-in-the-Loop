import { describe, expect, it } from "vitest";
import { initialWorldState } from "../../scenarios/combined/initialWorldState";
import { tickMedicalDomain } from "../../runtime/tickEngine";
import type { WorldState } from "../../runtime/types";

// Rückkopplungen der Nicht-Strom-Verbraucher auf den Medical-Sektor: Wasser
// (public-supply) drosselt den Durchsatz/Clearance, Residential (civil-stability)
// erzeugt zusätzliche Krankenfälle. Beide hängen über water_/civil_feed_consumer_id
// an den East-Hospitals und wirken NUR, wenn der jeweilige Feed unter sein Minimum
// fällt — bei voller Versorgung ist die Pipeline unverändert.

function setSupply(world: WorldState, consumerId: string, supply: number): void {
  world.domains.energy!.consumers[consumerId].current_supply = supply;
}

const overflowOf = (world: WorldState): number =>
  world.simulation.medical.routing_failures.find((f) => f.id === "rf-me7741-p2-trauma")!.overflow_cases;

describe("non-power consumer feedback (energy → medical)", () => {
  it("water shortage throttles clearance → overflow grows faster under power stress", () => {
    // Strom-Feed kurz → unkontrollierter Failure staut auf. Bei vollem Wasser
    // greift die volle Clearance (2), bei Wassermangel die gedrosselte (1) →
    // der Rückstau wächst je Tick stärker.
    const base = structuredClone(initialWorldState);
    setSupply(base, "consumer-medical-east", 10); // < Minimum 20 → Overflow akkumuliert

    const waterFull = tickMedicalDomain(structuredClone(base));

    const waterShort = structuredClone(base);
    setSupply(waterShort, "consumer-water-east", 10); // < Minimum 14
    const waterShortTicked = tickMedicalDomain(waterShort);

    expect(overflowOf(waterShortTicked)).toBeGreaterThan(overflowOf(waterFull));
  });

  it("residential/civil shortage adds extra cases even at full power", () => {
    // Strom voll → ohne Unruhe kein Rückstau. Fällt der Wohn-Feed unter sein
    // Minimum, kippt zivile Unruhe zusätzliche Krankenfälle in den Overflow,
    // unabhängig vom Strom.
    const calm = tickMedicalDomain(structuredClone(initialWorldState));
    expect(overflowOf(calm)).toBe(0);

    const unrest = structuredClone(initialWorldState);
    setSupply(unrest, "consumer-residential-east", 10); // < Minimum 18
    const unrestTicked = tickMedicalDomain(unrest);

    expect(overflowOf(unrestTicked)).toBeGreaterThan(0);
  });

  it("is a no-op while water and residential stay at or above their minimum", () => {
    // Default-Welt (alle Feeds nominal, Strom voll): keine Rückkopplung, kein
    // Rückstau — Beleg, dass die Effekte streng an Unterversorgung gebunden sind.
    const ticked = tickMedicalDomain(structuredClone(initialWorldState));
    expect(overflowOf(ticked)).toBe(0);
  });
});
