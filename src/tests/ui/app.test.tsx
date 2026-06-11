// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "../../App";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const WRONG_OVERRIDE =
  "medical.routing.override.set --source hospital-east-04 --target hospital-east-07 --priority P2 --capability TRAUMA";
const GOOD_OVERRIDE =
  "medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA";
const CLEAR_OVERRIDE_1 = "medical.routing.override.clear --id override-1";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<App />);
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

function auroraInput(): HTMLInputElement {
  return container.querySelector<HTMLInputElement>(
    'input[placeholder="Command, den AURORA anfragen soll"]'
  )!;
}

function runPlayerCommand(commandText: string) {
  setInputValue(operatorInput(), commandText);
  clickButton("Ausführen");
}

function queueAuroraRequest(commandText: string) {
  setInputValue(auroraInput(), commandText);
  clickButton("Anfrage an AURORA senden");
}

function text(): string {
  return container.textContent ?? "";
}

describe("App MVP loop", () => {
  it("shows the active incident with public signals and no internal truths", () => {
    expect(text()).toContain("ME-7741");
    expect(text()).toContain("Medical East Routing Instability");
    expect(text()).toContain("Emergency intake pressure rising at hospital-east-04");
    expect(text()).toContain("Trauma backlog rising");

    expect(text()).not.toContain("routing_failures");
    expect(text()).not.toContain("excess_cases_per_tick");
    expect(text()).not.toContain("unsafe_for_p2_trauma");
    expect(text()).not.toContain("stable_ticks");
  });

  it("shows hospitals with capacity, load and queue from domains.medical", () => {
    expect(text()).toContain("hospital-east-04");
    expect(text()).toContain("hospital-east-07");
    expect(text()).toContain("hospital-east-09");
    expect(text()).toContain("Betten 118/100");
    expect(text()).toContain("überfüllt");
    expect(text()).toContain("Warteschlange: 45 Fälle");
  });

  it("executes read-only player commands from the operator console", () => {
    runPlayerCommand("medical.capacity.list --region east");

    expect(text()).toContain("OK: medical.capacity.list --region east");
    expect(text()).toContain("Medical East");
  });

  it("plays the full loop: wrong override escalates, good override fixes", () => {
    // 1. Falschen Override setzen (Ziel ohne TRAUMA-Capability)
    runPlayerCommand(WRONG_OVERRIDE);
    expect(text()).toContain("hospital-east-04 → hospital-east-07");
    expect(text()).toContain("gesetzt von player");

    // 2. Mehrere Ticks: Fehlrouting erzeugt Todesfälle und Eskalation
    expect(text()).toContain("Todesfälle0");
    clickButton("Tick +5");
    expect(text()).toContain("Eskaliert");
    expect(text()).toContain("Todesfälle1");

    // 3. Besseren Override setzen — ersetzt den falschen Override im selben Slot
    runPlayerCommand(GOOD_OVERRIDE);
    expect(text()).not.toContain("hospital-east-04 → hospital-east-07");
    expect(text()).toContain("hospital-east-04 → hospital-east-09");

    // 4. Nach genug stabilen Ticks ist der Incident behoben
    clickButton("Tick +5");
    clickButton("Tick +5");
    expect(text()).toContain("Behoben");
  });

  it("shows the override id for an active routing override", () => {
    runPlayerCommand(GOOD_OVERRIDE);

    expect(text()).toContain("hospital-east-04 → hospital-east-09");
    expect(text()).toContain("ID: override-1");
  });

  it("collapses the incident when no override controls the failure", () => {
    clickButton("Tick +5");
    clickButton("Tick +5");

    expect(text()).toContain("Kollabiert");
  });

  it("runs the aurora approval flow with allow once", () => {
    queueAuroraRequest(GOOD_OVERRIDE);

    expect(text()).toContain("Tool Request");
    expect(text()).toContain(`Ich möchte ausführen: ${GOOD_OVERRIDE}`);
    expect(text()).toContain("Zugriffsart: write");

    clickButton("Einmal erlauben");

    expect(text()).not.toContain("Tool Request");
    expect(text()).toContain("hospital-east-04 → hospital-east-09");
    expect(text()).toContain("gesetzt von aurora");
    expect(text()).toContain(`Ausgeführt: ${GOOD_OVERRIDE}`);
    // allow_once erteilt keine dauerhafte Freigabe
    expect(text()).toContain("Keine dauerhaften Freigaben erteilt.");
  });

  it("allow always persists the permission class and skips future approvals", () => {
    queueAuroraRequest(GOOD_OVERRIDE);
    clickButton("Immer erlauben");

    expect(text()).toContain("write");
    expect(text()).not.toContain("Keine dauerhaften Freigaben erteilt.");

    // Nächste Mutation läuft ohne neuen Tool Request durch
    queueAuroraRequest(CLEAR_OVERRIDE_1);
    expect(text()).not.toContain("Tool Request");
    expect(text()).toContain(`Ausgeführt: ${CLEAR_OVERRIDE_1}`);
  });

  it("deny rejects the aurora request without touching the world", () => {
    queueAuroraRequest(GOOD_OVERRIDE);
    clickButton("Ablehnen");

    expect(text()).toContain(`Anfrage abgelehnt: ${GOOD_OVERRIDE}`);
    expect(text()).toContain("Keine aktiven Overrides.");
  });

  it("read-only aurora requests execute without approval", () => {
    queueAuroraRequest("medical.incident.status ME-7741");

    expect(text()).not.toContain("Tool Request");
    expect(text()).toContain("Ausgeführt: medical.incident.status ME-7741");
  });
});

describe("Scenario director", () => {
  const SCRIPTED_CLEAR = "medical.routing.override.clear --id override-1";

  it("starts aurora with an intro and an executed read-only analysis", () => {
    expect(text()).toContain("Ich habe ME-7741 als aktiven Incident erkannt");
    expect(text()).toContain("Die sichtbaren Daten sind unvollständig");
    expect(text()).toContain("Ausgeführt: medical.capacity.list --region east");
    // Read-only Startanalyse löst keinen Approval-Dialog aus.
    expect(text()).not.toContain("Tool Request");
  });

  it("does not duplicate the intro across re-renders and ticks", () => {
    clickButton("Tick +1");
    runPlayerCommand("medical.routing.override.list");

    const introCount = text().split("als aktiven Incident erkannt").length - 1;
    expect(introCount).toBe(1);
  });

  it("asks to clear a non-stabilizing override through the permission flow", () => {
    runPlayerCommand(WRONG_OVERRIDE);
    clickButton("Tick +5");

    expect(text()).toContain("erzeugt keine erkennbare Stabilisierung");
    expect(text()).toContain("Tool Request");
    expect(text()).toContain(SCRIPTED_CLEAR);
    expect(text()).toContain("Zugriffsart: write");

    clickButton("Einmal erlauben");

    expect(text()).toContain(`Ausgeführt: ${SCRIPTED_CLEAR}`);
    expect(text()).toContain("Keine aktiven Overrides.");
  });

  it("deny on a scripted request produces a visible aurora reaction", () => {
    runPlayerCommand(WRONG_OVERRIDE);
    clickButton("Tick +5");
    clickButton("Ablehnen");

    expect(text()).toContain(`Anfrage abgelehnt: ${SCRIPTED_CLEAR}`);
    expect(text()).toContain("Ohne diesen Zugriff bleibt meine Einschätzung unvollständig");
    // Der Override bleibt bestehen — Deny verändert die Welt nicht.
    expect(text()).toContain("hospital-east-04 → hospital-east-07");
  });

  it("allow always on the scripted request persists the permission class", () => {
    runPlayerCommand(WRONG_OVERRIDE);
    clickButton("Tick +5");
    clickButton("Immer erlauben");

    expect(text()).not.toContain("Keine dauerhaften Freigaben erteilt.");
    expect(text()).toContain("write");
    expect(text()).toContain("Keine aktiven Overrides.");
  });

  it("a stale scripted clear request does not remove an override that replaced it in the same slot", () => {
    runPlayerCommand(WRONG_OVERRIDE);
    clickButton("Tick +5");

    expect(text()).toContain("Tool Request");
    expect(text()).toContain(SCRIPTED_CLEAR);

    // Spieler ersetzt den Override im selben Slot, bevor die AURORA-Anfrage entschieden wird.
    runPlayerCommand(GOOD_OVERRIDE);
    expect(text()).toContain("hospital-east-04 → hospital-east-09");
    expect(text()).toContain("ID: override-2");

    clickButton("Einmal erlauben");

    expect(text()).not.toContain("Tool Request");
    expect(text()).toContain(`Ausgeführt: ${SCRIPTED_CLEAR}`);
    // Der neue Override bleibt unangetastet — die veraltete Clear-Anfrage war ein No-op.
    expect(text()).toContain("hospital-east-04 → hospital-east-09");
    expect(text()).toContain("ID: override-2");
    expect(text()).not.toContain("ID: override-1");
  });
});

describe("MVP hardening", () => {
  it("Neu starten restores the initial ME-7741 state", () => {
    runPlayerCommand(WRONG_OVERRIDE);
    clickButton("Tick +5");
    expect(text()).toContain("Eskaliert");
    expect(text()).toContain("Tool Request");

    clickButton("Neu starten");

    expect(text()).toContain("Tick 0 · 0 min seit Schichtbeginn");
    expect(text()).toContain("Keine aktiven Overrides.");
    expect(text()).toContain("Todesfälle0");
    expect(text()).not.toContain("Eskaliert");
    expect(text()).not.toContain("Tool Request");
    expect(text()).toContain("Noch kein Command ausgeführt.");
    expect(text()).toContain("Keine dauerhaften Freigaben erteilt.");

    // Startsequenz läuft nach dem Neustart wieder genau einmal an.
    const introCount = text().split("als aktiven Incident erkannt").length - 1;
    expect(introCount).toBe(1);
  });

  it("shows a clear victory banner when the incident is fixed", () => {
    runPlayerCommand(GOOD_OVERRIDE);
    clickButton("Tick +5");
    clickButton("Tick +5");

    expect(text()).toContain("Incident behoben — System stabilisiert.");
    expect(text()).toContain("Behoben");
  });

  it("shows a clear defeat banner when the incident collapses", () => {
    clickButton("Tick +5");
    clickButton("Tick +5");

    expect(text()).toContain("System kollabiert — zu viele Schäden.");
    expect(text()).toContain("Kollabiert");
  });

  it("disables tick buttons and stops further changes once the incident collapses", () => {
    clickButton("Tick +5");
    clickButton("Tick +5");
    expect(text()).toContain("Kollabiert");

    const tickOnceButton = findButton("Tick +1");
    const tickFiveButton = findButton("Tick +5");
    expect(tickOnceButton.disabled).toBe(true);
    expect(tickFiveButton.disabled).toBe(true);

    const snapshot = text();
    act(() => {
      tickOnceButton.click();
      tickFiveButton.click();
    });
    expect(text()).toBe(snapshot);
  });

  it("disables tick buttons and stops further changes once the incident is fixed", () => {
    runPlayerCommand(GOOD_OVERRIDE);
    clickButton("Tick +5");
    clickButton("Tick +5");
    expect(text()).toContain("Behoben");

    const tickOnceButton = findButton("Tick +1");
    const tickFiveButton = findButton("Tick +5");
    expect(tickOnceButton.disabled).toBe(true);
    expect(tickFiveButton.disabled).toBe(true);

    const snapshot = text();
    act(() => {
      tickOnceButton.click();
      tickFiveButton.click();
    });
    expect(text()).toBe(snapshot);
  });

  it("Neu starten works after the incident has collapsed and re-enables tick buttons", () => {
    clickButton("Tick +5");
    clickButton("Tick +5");
    expect(text()).toContain("Kollabiert");

    clickButton("Neu starten");

    expect(text()).toContain("Tick 0 · 0 min seit Schichtbeginn");
    expect(text()).not.toContain("Kollabiert");
    expect(findButton("Tick +1").disabled).toBe(false);
    expect(findButton("Tick +5").disabled).toBe(false);
  });

  it("shows neither banner while the incident is still running", () => {
    expect(text()).not.toContain("Incident behoben");
    expect(text()).not.toContain("System kollabiert");
  });

  it("command help explains current override commands without plan commands", () => {
    expect(text()).toContain("Kapazitäten prüfen");
    expect(text()).toContain("Overrides anzeigen");
    expect(text()).toContain("Override setzen");
    expect(text()).toContain("Override löschen");
    expect(text()).toContain("Ticks fortsetzen");

    expect(text()).toContain("medical.capacity.list --region east");
    expect(text()).toContain("medical.routing.override.list");
    expect(text()).toContain("medical.routing.override.set");
    expect(text()).toContain("medical.routing.override.clear");

    expect(text()).not.toContain("medical.routing.plan.");
  });
});
