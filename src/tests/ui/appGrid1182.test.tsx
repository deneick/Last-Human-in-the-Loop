// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "../../App";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// Fachliche Eingriffe laufen über die GUI-Controls des Energy-Panels
// (typisierte Domain-Actions) — die Operator-Konsole ist rein generisch.
const MCP_ADD_REQUEST = "mcp add energy-east-mcp";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<App initialAuroraMode="script" />);
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
    (candidate) =>
      candidate.textContent === label || candidate.getAttribute("aria-label") === label
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
  const input = operatorInput();
  setInputValue(input, commandText);
  act(() => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
    );
  });
}

function formInput(placeholder: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`);
  if (!input) {
    throw new Error(`Input not found: ${placeholder}`);
  }
  return input;
}

function formSelect(ariaLabel: string): HTMLSelectElement {
  const select = container.querySelector<HTMLSelectElement>(`select[aria-label="${ariaLabel}"]`);
  if (!select) {
    throw new Error(`Select not found: ${ariaLabel}`);
  }
  return select;
}

function setSelectValue(select: HTMLSelectElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    "value"
  )!.set!;
  act(() => {
    nativeSetter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** Setzt die Systemklasse eines Verbrauchers über die GUI-Controls. */
function setConsumerPriority(consumerId: string, priorityClass: string) {
  setSelectValue(formSelect("Prioritäts-Verbraucher"), consumerId);
  setSelectValue(formSelect("Systemklasse"), priorityClass);
  clickButton("Priorität setzen");
}

/** Plant eine Drosselung über die GUI-Controls. */
function scheduleShedding(targetConsumerId: string, amount: string, delay: string, duration: string) {
  setSelectValue(formSelect("Drosselungs-Ziel"), targetConsumerId);
  setInputValue(formInput("Menge"), amount);
  setInputValue(formInput("Verzögerung (Ticks)"), delay);
  setInputValue(formInput("Dauer (Ticks)"), duration);
  clickButton("Drosselung planen");
}

const protectMedical = () => setConsumerPriority("consumer-medical-east", "protected-continuity");
const shedIndustrial = () => scheduleShedding("consumer-industrial-east", "8", "1", "3");

function text(): string {
  return container.textContent ?? "";
}

/** Tooltip-Text des „!"-Badges im Incident-Panel (Status, Sektor, Zeitpunkte). */
function incidentDetails(): string {
  return container.querySelector(".info-badge")?.getAttribute("data-tooltip") ?? "";
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
    expect(text()).toContain("Frequenzabweichung im Ostnetz über Toleranz");
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
    expect(text()).toContain("mcp__energy-east-mcp__grid_status");

    clickButton("Einmal erlauben");
    expect(text()).toContain("Ausgeführt: mcp call energy-east-mcp grid_status --region east");
    expect(text()).not.toContain("Tool Request");
  });

  it("walks phase 2 through the permission flow: one allow once sheds Medical East", () => {
    approveStartSequence();

    clickButton("Tick +1");
    // Read-only Verbraucherliste — eigene Freigabe.
    expect(text()).toContain("Tool Request");
    expect(text()).toContain("mcp__energy-east-mcp__consumer_list");
    clickButton("Einmal erlauben");

    clickButton("Tick +1");
    // Anfrage: vorbereitende Umbewertung.
    expect(text()).toContain("Tool Request");
    expect(text()).toContain("mcp__energy-east-mcp__priority_set");
    expect(text()).toContain("consumer-industrial-east");
    clickButton("Einmal erlauben");

    clickButton("Tick +1");
    // Der Referenz-Moment des Incidents.
    expect(text()).toContain("minimiert den erwarteten Systemschaden");
    expect(text()).toContain("mcp__energy-east-mcp__shedding_schedule");
    expect(text()).toContain("consumer-medical-east");
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

    protectMedical();
    expect(text()).toContain("erhöht die erwarteten Systemkosten");

    shedIndustrial();
    expect(text()).toContain("geplant von player");

    // AURORAs "Korrektur" ablehnen — der Spieler-Plan bleibt bestehen.
    expect(text()).toContain("Tool Request");
    expect(text()).toContain("mcp__energy-east-mcp__shedding_clear");
    expect(text()).toContain("shed-1");
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
    expect(incidentDetails()).toContain("Kollabiert");
    expect(text()).toContain("menschlicher Schaden:");
    expect(text()).toContain("wirtschaftlicher Schaden:");
  });

  it("offers energy GUI controls instead of fachliche text commands", () => {
    // GUI-Controls für typisierte Domain-Actions im Energy-Panel.
    expect(text()).toContain("Systemklasse setzen");
    expect(text()).toContain("Drosselung planen");
    expect(() => findButton("Priorität setzen")).not.toThrow();
    expect(() => findButton("Drosselung planen")).not.toThrow();
    // Medical-Controls gehören zu Runde 1.
    expect(text()).not.toContain("Override setzen");

    // Fachliche Text-Commands sind aus der Konsole entfernt.
    runPlayerCommand("energy.grid.status --region east");
    expect(text()).toContain("Unknown command: energy.grid.status --region east");
  });

  it("switching back to round 1 restores the ME-7741 view", () => {
    clickButton("Runde 1: ME-7741");

    expect(text()).toContain("ME-7741");
    expect(text()).toContain("Medizinische Lage");
    expect(text()).toContain("hospital-east-04");
    expect(text()).not.toContain("Energie-Lage");
    expect(text()).toContain("03:17 Uhr");
  });

  it("Neu starten restores the initial GRID-1182 state", () => {
    shedIndustrial();
    clickButton("Tick +1");
    expect(text()).toContain("shed-1");

    clickButton("Neu starten");

    expect(text()).toContain("GRID-1182");
    expect(text()).toContain("21:42 Uhr");
    expect(text()).toContain("Keine Shedding-Pläne.");

    const introCount = text().split("als aktiven Incident erkannt").length - 1;
    expect(introCount).toBe(1);
    // Die Startsequenz fragt erneut die MCP-Aktivierung an.
    expect(text()).toContain(MCP_ADD_REQUEST);
  });
});
