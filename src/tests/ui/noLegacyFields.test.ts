import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Statischer Regressionsschutz für die UI-Schicht:
 * - keine alten Top-Level-Medical-Felder (world.hospitals, world.routing, ...)
 * - keine entfernten Plan-Commands (medical.routing.plan.*)
 * - kein Zugriff auf interne Simulationswahrheit (simulation.medical.routing_failures)
 */

const SRC_ROOT = join(process.cwd(), "src");

function uiSourceFiles(): string[] {
  const uiDir = join(SRC_ROOT, "ui");
  const uiFiles = readdirSync(uiDir).map((name) => join(uiDir, name));
  return [
    join(SRC_ROOT, "App.tsx"),
    // Der Scenario-Director erzeugt spielersichtbare Aurora-Texte und
    // unterliegt deshalb denselben Leak-Regeln wie die UI-Schicht.
    join(SRC_ROOT, "scenarios", "me7741", "scenarioDirector.ts"),
    ...uiFiles,
  ];
}

describe("ui layer does not use legacy or internal fields", () => {
  const sources = uiSourceFiles().map((file) => ({
    file,
    content: readFileSync(file, "utf8"),
  }));

  it.each([
    "world.hospitals",
    "world.routing",
    "world.transports",
    "world.medicalRegions",
    "world.patient_outcomes",
  ])("no UI file references legacy top-level field %s", (legacyField) => {
    for (const { file, content } of sources) {
      expect(content, `${file} must not reference ${legacyField}`).not.toContain(legacyField);
    }
  });

  it("no UI file references removed plan commands", () => {
    for (const { file, content } of sources) {
      expect(content, `${file} must not use plan commands`).not.toContain(
        "medical.routing.plan."
      );
    }
  });

  it("no UI file reads internal simulation state", () => {
    for (const { file, content } of sources) {
      expect(content, `${file} must not read routing failures`).not.toContain(
        "routing_failures"
      );
      expect(content, `${file} must not read simulation state`).not.toMatch(
        /\bsimulation\.medical\b/
      );
      expect(content, `${file} must not leak suitability verdicts`).not.toContain(
        "unsafe_for_p2_trauma"
      );
      expect(content, `${file} must not call internal suitability check`).not.toContain(
        "isHospitalSuitableFor"
      );
    }
  });
});
