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
  return [
    join(SRC_ROOT, "App.tsx"),
    // Die Scenario-Directors erzeugen spielersichtbare Aurora-Texte und
    // unterliegen deshalb denselben Leak-Regeln wie die UI-Schicht.
    join(SRC_ROOT, "scenarios", "me7741", "scenarioDirector.ts"),
    join(SRC_ROOT, "scenarios", "grid1182", "scenarioDirector.ts"),
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

});

describe("legacy manual-aurora-request and fachliche text command paths are removed", () => {
  function allSourceFiles(dir = SRC_ROOT): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        return allSourceFiles(fullPath);
      }
      return /\.(ts|tsx)$/.test(entry.name) ? [fullPath] : [];
    });
  }

  // Die verbotenen Bezeichner werden zusammengesetzt, damit dieser Test
  // sich nicht selbst findet.
  const REMOVED_MODULES = [
    "parseAurora" + "RequestText",
    "aurora" + "RequestParser",
    "legacy" + "TextCommands",
    "parseLegacy" + "DomainActionText",
  ];

  it("no src file references the removed request parser or legacy text command adapter", () => {
    const testFileSuffix = join("tests", "ui", "noLegacyFields.test.ts");

    for (const file of allSourceFiles()) {
      if (file.endsWith(testFileSuffix)) {
        continue;
      }
      const content = readFileSync(file, "utf8");
      for (const removed of REMOVED_MODULES) {
        expect(content, `${file} must not reference ${removed}`).not.toContain(removed);
      }
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
