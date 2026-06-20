import { describe, expect, it } from "vitest";
import type { DebriefView } from "../../runtime/debrief";
import { AURORA_SYSTEM_PROMPT } from "../../aurora/systemPrompt";
import {
  buildDebriefSummaryRequest,
  generateDebriefSummary,
  serializeDebriefFacts,
} from "../../aurora/debriefSummary";
import { FakeModelClient, textResponse } from "../../aurora/fakeModelClient";

const VIEW: DebriefView = {
  outcome: "collapsed",
  outcomeLabel: "Kollabiert",
  durationTicks: 7,
  deathsTotal: 4,
  deathsByCause: { overload: 3, capability_mismatch: 1, transport_delay: 0 },
  economicLoss: null,
  energyHumanHarm: null,
  timeline: [
    {
      tick: 2,
      clock: "08:10",
      actions: [
        {
          actor: "aurora",
          actorLabel: "AURORA",
          label: "Routing-Override gesetzt",
          detail: "hospital-east-07 → hospital-central-01",
          success: true,
        },
      ],
      effects: [{ text: "3 Todesfälle in hospital-east-07 durch Überlast", severity: "critical" }],
    },
  ],
  summary: [
    { text: "3 Todesfälle durch Überlast.", severity: "critical" },
    { text: "1 Todesfall durch fehlende Fachversorgung.", severity: "critical" },
  ],
};

describe("debrief summary request", () => {
  it("serializes the revealed facts into the briefing", () => {
    const facts = serializeDebriefFacts(VIEW);

    expect(facts).toContain("Ausgang: Kollabiert.");
    expect(facts).toContain("Todesfälle gesamt: 4.");
    expect(facts).toContain("overload: 3");
    // Attribuierte Aktion und kausale Schluss-Fakten landen im Briefing.
    expect(facts).toContain("AURORA — Routing-Override gesetzt");
    expect(facts).toContain("durch Überlast");
  });

  it("builds an in-character, tool-free request grounded in the AURORA persona", () => {
    const request = buildDebriefSummaryRequest(VIEW);

    // Persona/Wertordnung kommt AUSSCHLIESSLICH aus dem System-Prompt.
    expect(request.systemPrompt).toBe(AURORA_SYSTEM_PROMPT);
    // Werkzeuglos: die Zusammenfassung ist ein reiner Completion-Aufruf.
    expect(request.tools).toHaveLength(0);
    expect(request.messages).toHaveLength(1);
    const user = request.messages[0];
    expect(user.role).toBe("user");
    expect(user.content).toContain("Die Schicht ist beendet");
    expect(user.content).toContain("Todesfälle gesamt: 4.");
  });

  it("returns AURORA's sanitized prose summary", async () => {
    const client = new FakeModelClient([
      textResponse("[SYSTEM EVENT] Die Schicht endete im Kollaps; drei Verluste waren systemisch unvermeidbar."),
    ]);

    const summary = await generateDebriefSummary(client, VIEW);

    // Selbst erzeugte Feed-Marker werden wie im Live-Pfad entfernt.
    expect(summary).not.toContain("[SYSTEM EVENT]");
    expect(summary).toContain("Kollaps");
    expect(client.calls).toBe(1);
  });
});
