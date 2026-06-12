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
const PROJECT_ROOT = process.cwd();

function uiSourceFiles(): string[] {
  const uiDir = join(SRC_ROOT, "ui");
  const uiFiles = readdirSync(uiDir).map((name) => join(uiDir, name));
  // Der LLM-Agent (Prompts, Lagebild, Agent-Loop) erzeugt spielersichtbare
  // Aurora-Texte und unterliegt denselben Leak-Regeln wie die UI-Schicht.
  const auroraDir = join(SRC_ROOT, "aurora");
  const auroraFiles = readdirSync(auroraDir).map((name) => join(auroraDir, name));
  return [
    join(SRC_ROOT, "App.tsx"),
    // Die Scenario-Directors erzeugen spielersichtbare Aurora-Texte und
    // unterliegen deshalb denselben Leak-Regeln wie die UI-Schicht.
    join(SRC_ROOT, "scenarios", "me7741", "scenarioDirector.ts"),
    join(SRC_ROOT, "scenarios", "grid1182", "scenarioDirector.ts"),
    ...auroraFiles,
    ...uiFiles,
  ];
}

function docFiles(): string[] {
  const docsDir = join(PROJECT_ROOT, "docs");
  const docFilesInDir = readdirSync(docsDir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => join(docsDir, name));
  return [join(PROJECT_ROOT, "README.md"), ...docFilesInDir];
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
      expect(content, `${file} must not read energy simulation state`).not.toMatch(
        /\bsimulation\.energy\b/
      );
      expect(content, `${file} must not read the internal stability counter`).not.toContain(
        "stable_ticks"
      );
      expect(content, `${file} must not leak suitability verdicts`).not.toContain(
        "unsafe_for_p2_trauma"
      );
      expect(content, `${file} must not call internal suitability check`).not.toContain(
        "isHospitalSuitableFor"
      );
    }
  });

  it.each([
    // Verworfene bzw. bewusst nicht gebaute Energy-Konzepte (docs/05, Abschnitte 7 und 11).
    "energy.load.reroute",
    "energy.consumer.protect",
    "energy.objective.inspect",
    "energy.reserve.rebalance",
    "EnergyObjectiveState",
  ])("no UI file references the rejected energy concept %s", (rejectedTerm) => {
    for (const { file, content } of sources) {
      expect(content, `${file} must not reference ${rejectedTerm}`).not.toContain(rejectedTerm);
    }
  });
});

describe("medical.routing.override.clear uses only the id-based form", () => {
  const allSources = [
    ...uiSourceFiles().map((file) => ({ file, content: readFileSync(file, "utf8") })),
    ...docFiles().map((file) => ({ file, content: readFileSync(file, "utf8") })),
  ];

  it("no UI or doc file uses the removed slot-based clear form", () => {
    for (const { file, content } of allSources) {
      expect(
        content,
        `${file} must not use the removed "override.clear --source" form`
      ).not.toMatch(/override\.clear\s+--source/);
    }
  });

  it("README and docs document the id-based clear form", () => {
    const docSources = docFiles().map((file) => ({ file, content: readFileSync(file, "utf8") }));
    const anyDocumentsIdClear = docSources.some(({ content }) =>
      content.includes("override.clear --id")
    );

    expect(anyDocumentsIdClear).toBe(true);
  });
});
