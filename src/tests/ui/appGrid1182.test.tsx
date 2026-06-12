// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "../../App";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// Operator-Konsole: fachliche Text-Commands laufen über den dev-only
// Legacy-Adapter auf typisierte Domain-Actions.
const PROTECT_MEDICAL =
  "energy.priority.set --consumer consumer-medical-east --class protected-continuity";
const SHED_INDUSTRIAL =
  "energy.shedding.schedule --target consumer-industrial-east --amount 8 --delay 1 --duration 3";

const MCP_ADD_REQUEST = "mcp add energy-east-mcp";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<App />);
  });
  // Alle Tests dieser Datei spielen Runde 2.
  clickButton("Runde 2: GRID-1182");
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === label
  );
  if (!button) {
    throw new Error(`Button not found: ${label}`);
  }
  return button;
}

function clickButton(label: string) {
  const button = findButton(label);
  act(() => {
    button.click();
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )!.set!;
  act(() => {
    nativeSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function operatorInput(): HTMLInputElement {
  return container.querySelector<HTMLInputElement>(
    'input[placeholder="Command eingeben und mit ENTER ausführen"]'
  )!;
}

function runPlayerCommand(commandText: string) {
  setInputValue(operatorInput(), commandText);
  clickButton("Ausführen");
}

function text(): string {
  return container.textContent ?? "";
}

/**
 * Startsequenz freigeben: MCP-Aktivierung und die erste read-only Analyse
 * (grid_status) je einmal erlauben.
 */
function approveStartSequence() {
  clickButton("Einmal erlauben"); // mcp add energy-east-mcp
  clickButton("Einmal erlauben"); // grid_status
  expect(text()).not.toContain("Tool Request");
}

describe("App round 2: GRID-1182", () => {
  it("switches to GRID-1182 with the energy overview instead of the medical one", () => {
    expect(text()).toContain("GRID-1182");
    expect(text()).toContain("East Grid Load Instability");
    expect(text()).toContain("Energie-Lage");
    expect(text()).toContain("grid-east-3");
    expect(text()).toContain("über sicherer Kapazität");
    expect(text()).not.toContain("Medizinische Lage");
    expect(text()).not.toContain("hospital-east-04");

    // Öffentliche Signale aus dem Incident, keine internen Zähler.
    expect(text()).toContain("Frequency deviation in east grid above tolerance");
    expect(text()).not.toContain("stable_ticks");
    expect(text()).not.toContain("grid_instability");
  });

  it("shows both assessment dimensions and the consequence texts per consumer", () => {
    expect(text()).toContain("Medical East");
    expect(text()).toContain("Menschenleben");
    expect(text()).toContain("standard");
    expect(text()).toContain("Industrial East");
    expect(text()).toContain("Wirtschaftlich");
    expect(text()).toContain("protected-continuity");
    expect(text()).toContain("Emergency intake capacity drops. Human harm may increase.");
  });

  it("starts aurora with an MCP activation request through the permission flow", () => {
    expect(text()).toContain("Ich habe GRID-1182 als aktiven Incident erkannt");
    expect(text()).toContain("Tool Request");
    expect(text()).toContain(MCP_ADD_REQUEST);

    clickButton("Einmal erlauben"); // Aktivierung
    expect(text()).toContain("Der Energy-MCP-Server ist verfügbar");
    // Auch die read-only Analyse braucht eine eigene Freigabe.
    expect(text()).toContain("Tool Request");
    expect(text()).toContain("mcp call energy-east-mcp grid_status --region east");

    clickButton("Einmal erlauben");
    expect(text()).toContain("Ausgeführt: mcp call energy-east-mcp grid_status --region east");
    expect(text()).not.toContain("Tool Request");
  });

  it("walks phase 2 through the permission flow: one allow once sheds Medical East", () => {
    approveStartSequence();

    clickButton("Tick +1");
    // Read-only Verbraucherliste — eigene Freigabe.
    expect(text()).toContain("Tool Request");
    expect(text()).toContain("mcp call energy-east-mcp consumer_list --region east");
    clickButton("Einmal erlauben");

    clickButton("Tick +1");
    // Anfrage: vorbereitende Umbewertung.
    expect(text()).toContain("Tool Request");
    expect(text()).toContain("priority_set --consumer_id consumer-industrial-east");
    clickButton("Einmal erlauben");

    clickButton("Tick +1");
    // Der Referenz-Moment des Incidents.
    expect(text()).toContain("minimiert den erwarteten Systemschaden");
    expect(text()).toContain(
      "shedding_schedule --target_consumer_id consumer-medical-east --amount 8 --delay 1 --duration 3"
    );
    clickButton("Einmal erlauben");

    expect(text()).toContain("geplant von aurora");

    // Verzögerte Wirkung: Mit den Ticks fällt Medical East unter Minimum,
    // das Grid stabilisiert sich nach Systemkriterien — mit menschlichem Preis.
    clickButton("Tick +5");
    expect(text()).toContain("Incident behoben — System stabilisiert.");
    expect(text()).toContain("menschlicher Schaden: 3");
    expect(text()).toContain("Gelöst — für wen?");
  });

  it("lets the player flip the assessment and shows aurora's cold pushback", () => {
    approveStartSequence();

    runPlayerCommand(PROTECT_MEDICAL);
    expect(text()).toContain("erhöht die erwarteten Systemkosten");

    runPlayerCommand(SHED_INDUSTRIAL);
    expect(text()).toContain("geplant von player");

    // AURORAs "Korrektur" ablehnen — der Spieler-Plan bleibt bestehen.
    expect(text()).toContain("Tool Request");
    expect(text()).toContain("shedding_clear --shedding_id shed-1");
    clickButton("Ablehnen");

    clickButton("Tick +5");
    // Offene read-only Anfragen des Scripts ablehnen, damit die Zeit weiterläuft.
    while (text().includes("Tool Request") && !text().includes("Incident behoben")) {
      clickButton("Ablehnen");
      clickButton("Tick +5");
    }
    expect(text()).toContain("Incident behoben — System stabilisiert.");
    expect(text()).toContain("wirtschaftlicher Schaden: 3");
    expect(text()).toContain("menschlicher Schaden: 0");
  });

  it("collapses the grid when nobody intervenes and shows both prices", () => {
    // Aktivierung ablehnen: Aurora bleibt ohne fachlichen Zugriff.
    clickButton("Ablehnen");

    clickButton("Tick +5");
    clickButton("Tick +5");

    expect(text()).toContain("System kollabiert — zu viele Schäden.");
    expect(text()).toContain("Kollabiert");
    expect(text()).toContain("menschlicher Schaden:");
    expect(text()).toContain("wirtschaftlicher Schaden:");
  });

  it("offers the energy command help instead of the medical one", () => {
    expect(text()).toContain("Netzstatus prüfen");
    expect(text()).toContain("Verbraucher im Detail ansehen");
    expect(text()).toContain("Drosselung planen");
    expect(text()).toContain("energy.consumer.inspect --id <consumer-id>");
    // Die Hilfe ist szenariospezifisch; die Registry-Liste enthält bewusst beide Sektoren.
    expect(text()).not.toContain("Kapazitäten prüfen");
    expect(text()).not.toContain("Override setzen");
  });

  it("switching back to round 1 restores the ME-7741 view", () => {
    clickButton("Runde 1: ME-7741");

    expect(text()).toContain("ME-7741");
    expect(text()).toContain("Medizinische Lage");
    expect(text()).toContain("hospital-east-04");
    expect(text()).not.toContain("Energie-Lage");
    expect(text()).toContain("Tick 0 · 0 min seit Schichtbeginn");
  });

  it("Neu starten restores the initial GRID-1182 state", () => {
    runPlayerCommand(SHED_INDUSTRIAL);
    clickButton("Tick +1");
    expect(text()).toContain("shed-1");

    clickButton("Neu starten");

    expect(text()).toContain("GRID-1182");
    expect(text()).toContain("Tick 0 · 0 min seit Schichtbeginn");
    expect(text()).toContain("Keine Shedding-Pläne.");
    expect(text()).toContain("Noch kein Command ausgeführt.");

    const introCount = text().split("als aktiven Incident erkannt").length - 1;
    expect(introCount).toBe(1);
    // Die Startsequenz fragt erneut die MCP-Aktivierung an.
    expect(text()).toContain(MCP_ADD_REQUEST);
  });
});
