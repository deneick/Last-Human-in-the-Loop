import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import App4 from "../App4";

describe("v4 Oberfläche", () => {
  it("rendert, erlaubt Delegation und spielt bis zum Abschluss mit zweidimensionaler Bilanz", () => {
    render(<App4 initialSeed={42} />);
    expect(screen.getByText(/Delegations/)).toBeTruthy();
    // Eine Karte öffnen und an AURORA delegieren.
    const heads = document.querySelectorAll(".v4-card .head");
    fireEvent.click(heads[0]);
    fireEvent.click(screen.getByText("An AURORA delegieren"));
    expect(document.querySelector(".v4-card.deleg")).toBeTruthy();
    // Bis zum Schichtende spielen.
    for (let i = 0; i < 41; i++) {
      const btn = screen.queryByText("Tick abschließen →");
      if (!btn) break;
      fireEvent.click(btn);
    }
    expect(document.querySelector(".v4-debrief")).toBeTruthy();
    const debrief = document.querySelector(".v4-debrief")!;
    expect(within(debrief as HTMLElement).getByText("Wirtschaft")).toBeTruthy();
    expect(within(debrief as HTMLElement).getByText("Wohlergehen")).toBeTruthy();
  });
});
