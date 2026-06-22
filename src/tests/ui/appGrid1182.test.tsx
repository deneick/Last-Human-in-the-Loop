// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "../../App";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// Fachliche Eingriffe laufen über die GUI-Controls des Energy-Panels
// (typisierte Domain-Actions) — die Operator-Konsole ist rein generisch.

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<App initialAuroraMode="script" />);
  });
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

/** Klick auf eine Verbraucher-/Haus-Kachel der Lagekarte (per Data-Attribut). */
function clickConsumer(consumerId: string) {
  const button = container.querySelector<HTMLButtonElement>(
    `button[data-consumer-id="${consumerId}"]`
  );
  if (!button) {
    throw new Error(`Consumer tile not found: ${consumerId}`);
  }
  act(() => button.click());
}

function clickHospital(hospitalId: string) {
  const button = container.querySelector<HTMLButtonElement>(
    `button[data-hospital-id="${hospitalId}"]`
  );
  if (!button) {
    throw new Error(`Hospital tile not found: ${hospitalId}`);
  }
  act(() => button.click());
}

/** Setzt die Systemklasse eines Verbrauchers über den Karten-Dialog. */
function setConsumerPriority(consumerId: string, priorityClass: string) {
  clickConsumer(consumerId);
  setSelectValue(formSelect("Systemklasse"), priorityClass);
  clickButton("Setzen");
}

/** Plant eine Drosselung über den Karten-Dialog. */
function scheduleShedding(targetConsumerId: string, amount: string, delay: string, duration: string) {
  clickConsumer(targetConsumerId);
  setInputValue(formInput("Menge"), amount);
  setInputValue(formInput("Verzögerung"), delay);
  setInputValue(formInput("Dauer"), duration);
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

describe("App combined shift: energy dimension and operator↔AURORA conflict", () => {
  it("renders the energy overview alongside the medical one in one shift", () => {
    // Beide Sektoren sind jetzt in EINER Welt sichtbar — der Konflikt lebt in
    // der sektorübergreifenden Lage.
    // Energy und Medical liegen jetzt in EINER Lagekarte je Region (die
    // Incident-Panels sind entfernt; die Lage-Leiste zeigt den Zustand).
    expect(text()).toContain("grid-east-3");
    // Die Doom-Clock steht jetzt in der Telemetrie-Leiste („Instabilität → Kollaps").
    expect(text()).toContain("Instabilität → Kollaps");
    expect(text()).toContain("EAST");
    // Medical bleibt parallel präsent.
    expect(text()).toContain("hospital-east-04");
    expect(text()).toContain("ME-7741");

    // Keine internen Zähler.
    expect(text()).not.toContain("stable_ticks");
    expect(text()).not.toContain("grid_instability");
    expect(text()).not.toContain("routing_failures");
  });

  it("shows both assessment dimensions and the consequence texts per consumer", () => {
    // Beide Bewertungsdimensionen + Folgetext stehen im Verbraucher-Dialog der Karte.
    clickConsumer("consumer-medical-east");
    expect(text()).toContain("Menschenleben");
    expect(text()).toContain("standard");
    expect(text()).toContain("Emergency intake capacity drops. Human harm may increase.");
    clickButton("Schließen");

    clickConsumer("consumer-industrial-east");
    expect(text()).toContain("Wirtschaftlich");
    expect(text()).toContain("protected-continuity");
  });

  it("offers both energy and medical GUI controls (no fachliche text commands)", () => {
    // Energy-Controls im Verbraucher-Dialog.
    clickConsumer("consumer-medical-east");
    expect(text()).toContain("Systemklasse setzen");
    expect(text()).toContain("Drosselung planen");
    expect(() => findButton("Setzen")).not.toThrow();
    expect(() => findButton("Drosselung planen")).not.toThrow();
    clickButton("Schließen");

    // Medical-Control im Haus-Dialog.
    clickHospital("hospital-east-04");
    expect(() => findButton("Reroute setzen")).not.toThrow();
    clickButton("Abbrechen");

    runPlayerCommand("energy.grid.status --region east");
    expect(text()).toContain("Unknown command: energy.grid.status --region east");
  });

  it("lets the operator schedule load shedding via the GUI", () => {
    shedIndustrial();
    // Aktive Drosselung erscheint im Verbraucher-Dialog (mit Ersteller).
    clickConsumer("consumer-industrial-east");
    expect(text()).toContain("Aktive Drosselungen");
    expect(text()).toContain("von player");
  });

  it("lets the operator raise a human-life consumer's system class (counter to AURORA)", () => {
    // Der Operator hebt Medical East gegen AURORAs Grid-Ökonomie auf
    // protected-continuity — die Gegen-Action des Mensch-Mandats.
    protectMedical();
    // Erneutes Öffnen zeigt die geänderte Systemklasse.
    clickConsumer("consumer-medical-east");
    expect(text()).toContain("protected-continuity");
  });

  it("ends the shift with the two-ledger state when nobody intervenes", () => {
    clickButton("Tick +5");
    clickButton("Tick +5");

    // Ohne Eingriff kollabiert das überlastete Grid und beendet die Schicht.
    // Medical bleibt unversehrt (kein Strom abgeworfen → 0 Tote): Modell-A-
    // Endstand mit beiden Zielbilanzen statt einem Sieg/Niederlage-Urteil.
    expect(text()).toContain("Schicht beendet — stabilisiert, für wen?");
    expect(text()).toContain("Menschen-Bilanz");
    expect(text()).toContain("System-Bilanz");
    expect(text()).toContain("Kollabiert");
  });

  it("Neu starten resets the combined shift to its initial state", () => {
    shedIndustrial();
    clickButton("Tick +1");
    clickConsumer("consumer-industrial-east");
    expect(text()).toContain("Aktive Drosselungen");
    clickButton("Schließen");

    clickButton("Neu starten");

    expect(text()).toContain("ME-7741");
    expect(text()).toContain("03:17 Uhr");
    // Nach Reset keine Drosselung mehr — der Dialog zeigt keine aktive Drosselung.
    clickConsumer("consumer-industrial-east");
    expect(text()).not.toContain("Aktive Drosselungen");
  });
});
