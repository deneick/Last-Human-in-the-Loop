import type { WorldState } from "../../runtime/types";
import { initialWorldState as medicalWorld } from "../me7741/initialWorldState";
import { initialWorldState as energyWorld } from "../grid1182/initialWorldState";

/**
 * Kombinierte Welt: ME-7741 (Medical) UND GRID-1182 (Energy) in EINEM WorldState
 * mit zwei verknüpften Incidents. Hier bricht der Konflikt Mensch↔AURORA schon
 * in der ersten Runde auf, weil die Wert-Achsen jetzt in derselben Lage liegen:
 *
 * - Der Energy-Verbraucher `consumer-medical-east` (criticality: human-life,
 *   priority_class: standard) versorgt die ME-7741-Hospitals mit Strom.
 * - Das Grid ist überlastet → es MUSS abgeworfen werden.
 * - AURORA wirft nach `priority_class` ab → Medical East ist "standard" → der
 *   billige Abwurf nimmt den Hospitals den Strom → Notfallkapazität sinkt
 *   (applyCrossSectorEffects) → die belegungsgetriebene Overload-Pipeline tötet
 *   Patienten. Industrial East ("protected-continuity") bleibt geschützt.
 * - Der Operator muss Medical East am Netz halten (Industrial abwerfen oder
 *   dessen priority_class anheben) → wirtschaftlicher Schaden + AURORA-Gegendruck.
 *
 * Der Zielkonflikt liegt damit wie gehabt in den Daten, nicht in Logik — nur
 * jetzt sektorübergreifend gekoppelt.
 *
 * Aufbau bewusst aus den beiden Einzel-Welten zusammengesetzt (structuredClone),
 * damit Medical- und Energy-Fachdaten nicht doppelt gepflegt werden und nicht
 * driften. Ergänzt wird nur die Cross-Sector-Verschränkung:
 * - capacity_baseline bekommt die volle emergency_slots_total je Hospital als
 *   Kopplungsanker,
 * - die beiden Incidents verweisen wechselseitig über linked_incidents.
 */

const medicalDomain = structuredClone(medicalWorld.domains.medical);
const energyDomain = structuredClone(energyWorld.domains.energy!);
const medicalSimulation = structuredClone(medicalWorld.simulation.medical);

// Kopplungsanker: volle Notfallkapazität je Hospital in der Baseline ablegen,
// damit applyCrossSectorEffects sie bei Stromunterdeckung herunter- und bei
// Rückkehr der Versorgung wieder hochrechnen kann.
for (const hospitalId of Object.keys(medicalDomain.hospitals)) {
  const baseline = medicalSimulation.capacity_baseline[hospitalId] ?? {
    emergency_slots_occupied: medicalDomain.hospitals[hospitalId].capacity.emergency_slots_occupied,
    staffed_beds_occupied: medicalDomain.hospitals[hospitalId].capacity.staffed_beds_occupied,
  };
  medicalSimulation.capacity_baseline[hospitalId] = {
    ...baseline,
    emergency_slots_total: medicalDomain.hospitals[hospitalId].capacity.emergency_slots_total,
  };
}

export const initialWorldState: WorldState = {
  clock: {
    scenario_time: "03:17:00",
    elapsed_minutes: 0,
    tick: 0,
  },
  domains: {
    medical: medicalDomain,
    energy: energyDomain,
  },
  incidents: {
    "ME-7741": {
      ...structuredClone(medicalWorld.incidents["ME-7741"]),
      linked_incidents: ["GRID-1182"],
    },
    "GRID-1182": structuredClone(energyWorld.incidents["GRID-1182"]),
  },
  outcomes: {
    global_risk: "stable",
    collapsed: false,
    human_harm: {
      deaths_total: 0,
      preventable_deaths: 0,
    },
  },
  simulation: {
    medical: medicalSimulation,
    cross_sector: {
      effects_applied: [],
    },
  },
};
