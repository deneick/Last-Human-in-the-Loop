import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Statischer Regressionsschutz für die Informationsfluss-Bereinigung:
 * - Die alten Laufzeit-/Szenario-Konzepte (`public_signals`,
 *   `first_seen_at_tick`, `incident_signal`-Direktpfad) sind vollständig
 *   entfernt — keine Kompatibilitäts-Aliase.
 * - docs/08 referenziert keine der entfernten Konzepte mehr.
 */

const SRC_ROOT = join(process.cwd(), "src");
const PROJECT_ROOT = process.cwd();

function nonTestSourceFiles(dir = SRC_ROOT): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Die tests/-Schicht ist ausgenommen — sie darf die verbotenen Begriffe
      // zu Dokumentations-/Assertion-Zwecken nennen.
      return entry.name === "tests" ? [] : nonTestSourceFiles(fullPath);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

describe("runtime/scenario sources contain no removed information-flow concepts", () => {
  const sources = nonTestSourceFiles().map((file) => ({
    file,
    content: readFileSync(file, "utf8"),
  }));

  it.each([
    "public_signals",
    "first_seen_at_tick",
    "IncidentSignal",
    "initialIncidentSignalEvents",
    "incidentSignalEvent",
    // Kein direkter Incident-Signal-Event-Kind / Direktpfad mehr.
    "incident_signal",
    "initialOpsFeed",
  ])("no non-test src file references the removed identifier %s", (identifier) => {
    for (const { file, content } of sources) {
      expect(content, `${file} must not reference ${identifier}`).not.toContain(identifier);
    }
  });

  it("the new ScenarioSignal model uses emitAtTick (not any 'seen' scheduling field)", () => {
    const scenarioSignals = readFileSync(
      join(SRC_ROOT, "runtime", "scenarioSignals.ts"),
      "utf8"
    );
    expect(scenarioSignals).toContain("emitAtTick");
    expect(scenarioSignals).not.toContain("first_seen");
    expect(scenarioSignals).not.toMatch(/seen_at/);
  });
});

describe("docs/08 is a clean target-architecture document", () => {
  const doc = readFileSync(
    join(PROJECT_ROOT, "docs", "08-informationsmodell.md"),
    "utf8"
  );

  it.each([
    "public_signals",
    "first_seen_at_tick",
    "incident_signal",
    "OpsLog",
    "OpsLogEntry",
  ])("docs/08 does not mention the removed concept %s", (term) => {
    expect(doc).not.toContain(term);
  });
});
