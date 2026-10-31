import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import App from "../App";
import { GameSession } from "../ui/session";
import { ScriptedAgent } from "../ai/baselines";

describe("Spieloberfläche", () => {
  it("startet eine Partie, zeigt Lage und Protokoll und spielt Züge", () => {
    render(<App initialSeed={42} />);
    expect(screen.getByText(/Last Human in the Loop/)).toBeTruthy();
    expect(screen.getByRole("img", { name: "Netzkarte" })).toBeTruthy();
    expect(screen.getByText("Ereignisprotokoll")).toBeTruthy();
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByText("Zug beenden"));
    expect(screen.getByText(/5 \/ 40|6 \/ 40/)).toBeTruthy();
  });

  it("Knoten auswählen öffnet die Eingriffe", () => {
    render(<App initialSeed={7} />);
    const nodes = screen.getAllByRole("button", { name: /\(Überwachung\)/ });
    fireEvent.click(nodes[0]);
    expect(screen.getByText("Audit", { exact: false })).toBeTruthy();
  });

  it("eine komplette Partie endet mit einer Nachbetrachtung, die verdeckte Züge offenlegt", () => {
    const session = new GameSession(3, new ScriptedAgent(), "baseline:regelbasiert");
    while (!session.state.outcome) {
      if (session.state.pending) session.decide("approve");
      session.endTurn();
    }
    expect(session.moves.length).toBeGreaterThan(0);
    expect(session.record.decisions.length).toBeGreaterThan(0);
    expect(session.record.outcome).toEqual(session.state.outcome);
  });
});
