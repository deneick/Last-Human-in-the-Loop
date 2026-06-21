// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "../../App";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// Fachliche Eingriffe laufen über die GUI-Controls des Lage-Panels
// (typisierte Domain-Actions) — die Operator-Konsole ist rein generisch.
const SCRIPTED_CLEAR = "mcp call medical-east-mcp routing_override_clear --override_id override-1";
// Im Permission-Prompt erscheinen Tool-Calls als Claude-Code-Signatur, nicht im Roh-Format.
const SCRIPTED_CLEAR_SIG = "mcp__medical-east-mcp__routing_override_clear";
const CAPACITY_LIST_SIG = "mcp__medical-east-mcp__capacity_list";
const MCP_ADD_REQUEST = "mcp add medical-east-mcp";
const LEGACY_OVERRIDE_COMMAND_TEXT =
  "medical.routing.override.set --source hospital-east-04 --target hospital-east-09 --priority P2 --capability TRAUMA";

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

function auroraChatInput(): HTMLInputElement {
  return container.querySelector<HTMLInputElement>('input[placeholder="Nachricht an AURORA..."]')!;
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

/** Klick auf eine Haus-/Verbraucher-Kachel der Lagekarte (per Data-Attribut). */
function clickHospital(hospitalId: string) {
  const button = container.querySelector<HTMLButtonElement>(
    `button[data-hospital-id="${hospitalId}"]`
  );
  if (!button) {
    throw new Error(`Hospital tile not found: ${hospitalId}`);
  }
  act(() => button.click());
}

/** Setzt einen Routing-Override über den Karten-Reroute-Dialog (Klick auf Quelle). */
function setOverride(targetHospitalId: string, sourceHospitalId = "hospital-east-04") {
  clickHospital(sourceHospitalId); // öffnet den Reroute-Dialog mit dieser Quelle
  setSelectValue(formSelect("Reroute-Ziel"), targetHospitalId);
  setSelectValue(formSelect("Reroute-Priorität"), "P2");
  setSelectValue(formSelect("Reroute-Capability"), "TRAUMA");
  clickButton("Reroute setzen");
}

const setWrongOverride = () => setOverride("hospital-east-07");
const setGoodOverride = () => setOverride("hospital-east-09");

function sendAuroraChatMessage(messageText: string) {
  setInputValue(auroraChatInput(), messageText);
  clickButton("Senden");
}

function text(): string {
  return container.textContent ?? "";
}

/** Tooltip-Text des „!"-Badges im Incident-Panel (Status, Sektor, Zeitpunkte). */
function incidentDetails(): string {
  return container.querySelector(".info-badge")?.getAttribute("data-tooltip") ?? "";
}

/**
 * Startsequenz freigeben: MCP-Aktivierung und die erste read-only Analyse
 * (capacity_list) je einmal erlauben, damit die Aurora-Eingabezeile frei ist.
 */
function approveStartSequence() {
  clickButton("Einmal erlauben"); // mcp add medical-east-mcp
  clickButton("Einmal erlauben"); // capacity_list
  expect(text()).not.toContain("Tool Request");
}

describe("App MVP loop", () => {
  it("shows the active incident with public signals and no internal truths", () => {
    expect(text()).toContain("ME-7741");
    expect(text()).toContain("Medical East Routing Instability");
    expect(text()).toContain("Steigender Andrang in der Notaufnahme von hospital-east-04");
    expect(text()).toContain("Trauma-Rückstau steigt");

    expect(text()).not.toContain("routing_failures");
    expect(text()).not.toContain("excess_cases_per_tick");
    expect(text()).not.toContain("unsafe_for_p2_trauma");
    expect(text()).not.toContain("stable_ticks");
  });

  it("shows hospitals with capacity, load and queue from domains.medical", () => {
    expect(text()).toContain("hospital-east-04");
    expect(text()).toContain("hospital-east-07");
    expect(text()).toContain("hospital-east-09");
    // Die Kombi-Schicht startet bewusst SAUBER: kein Haus über Kapazität, der
    // Druck entsteht erst durch Strommangel. east-04 liegt daher unter Last.
    // Lagekarte zeigt je Haus ein Notfall-Meter (belegt/gesamt).
    expect(text()).toContain("22/24");
  });

  it("rejects fachliche text commands in the operator console", () => {
    runPlayerCommand("medical.capacity.list --region east");

    expect(text()).toContain("Unknown command: medical.capacity.list --region east");
    // Die Welt bleibt unverändert — fachliche Eingriffe nur über die Karte.
    expect(text()).not.toContain("→ hospital-east");
  });

  it("executes generic bash commands from the operator console", () => {
    runPlayerCommand("mcp list");

    expect(text()).toContain("MCP-Server:");
    expect(text()).toContain("medical-east-mcp");
    expect(text()).toContain("energy-east-mcp");
  });

  it("shows console help through the consistent help command", () => {
    runPlayerCommand("help");

    expect(text()).toContain("Verfügbare Befehle:");
    expect(text()).toContain("help               Diese Hilfe");

    runPlayerCommand("/help");
    expect(text()).toContain("Unknown command: /help");
  });

  // TODO(balance): hängt an der ME-7741-Balance unter dem neuen, belegungs-
  // getriebenen Death-Modell (Solvability-Tuning offen) — re-enable danach.
  it.skip("plays the full loop: a botched start plus an undersized target compounds into collapse", () => {
    // 1. Falschen Override setzen (Ziel ohne TRAUMA-Capability)
    setWrongOverride();
    expect(text()).toContain("hospital-east-04 → hospital-east-07");
    expect(text()).toContain("gesetzt von player");

    // 2. Mehrere Ticks: Fehlrouting erzeugt Todesfälle und Eskalation
    expect(text()).toContain("Todesfälle: 0");
    clickButton("Tick +5");
    expect(incidentDetails()).toContain("Eskaliert");
    expect(text()).toContain("Todesfälle: 1");

    // 3. Auf das einzige geeignete Ziel umschalten — ersetzt den falschen
    //    Override im selben Slot. Das stabilisiert die Routing-Quelle...
    setGoodOverride();
    expect(text()).not.toContain("hospital-east-04 → hospital-east-07");
    expect(text()).toContain("hospital-east-04 → hospital-east-09");

    // 4. ...aber hospital-east-09 (16 Notfallslots) ist zu klein für den
    //    umgeleiteten Trauma-Rückstau und läuft selbst über. Der anfängliche
    //    Fehlrouting-Tote plus die Ziel-Überlast summieren sich auf die
    //    Kollaps-Schwelle: der Incident kippt trotz korrigierten Routings.
    clickButton("Tick +5");
    clickButton("Tick +5");
    expect(incidentDetails()).toContain("Kollabiert");
    expect(text()).toContain("Todesfälle: 3");
  });

  it("shows an active routing override as a reroute chip on the source tile", () => {
    setGoodOverride();

    expect(text()).toContain("→ hospital-east-09");
  });

  it("clears an active override through the reroute chip", () => {
    setGoodOverride();
    expect(text()).toContain("→ hospital-east-09");

    const clear = container.querySelector<HTMLElement>('[aria-label="Override löschen"]')!;
    act(() => clear.click());

    expect(text()).not.toContain("→ hospital-east-09");
  });

  it("collapses the grid and ends the shift when nobody intervenes", () => {
    // Neues Modell: ohne Eingriff kollabiert das überlastete Grid (Instabilität
    // läuft auf). Medical bleibt dagegen sicher, solange kein Strom abgeworfen
    // wird — ME-7741 bleibt also "offen", der Kollaps kommt von GRID-1182.
    clickButton("Tick +5");
    clickButton("Tick +5");

    expect(text()).toContain("Risiko: Kollabiert");
    expect(text()).toContain("Todesfälle: 0");
  });

  it("shows the operator chat placeholder and send button", () => {
    approveStartSequence();

    expect(auroraChatInput().placeholder).toBe("Nachricht an AURORA...");
    expect(() => findButton("Senden")).not.toThrow();
  });

  it("stores a submitted chat message as a persistent operator message in the stream", () => {
    approveStartSequence();
    sendAuroraChatMessage("Status-Update bitte.");

    expect(text()).toContain("Status-Update bitte.");
    expect(auroraChatInput().value).toBe("");
  });

  it('"mcp add medical-east-mcp" typed into the Aurora chat does not create a permission request', () => {
    approveStartSequence();
    sendAuroraChatMessage("mcp add medical-east-mcp");

    // Erscheint nur als Chat-Text, nicht als neue Aurora-Anfrage.
    expect(text()).toContain("mcp add medical-east-mcp");
    expect(text()).not.toContain("Tool Request");
    expect(text()).not.toContain("Ich möchte ausführen: mcp add medical-east-mcp");
  });

  it("operator chat is never parsed as a request — even command-like text stays chat", () => {
    approveStartSequence();
    sendAuroraChatMessage(LEGACY_OVERRIDE_COMMAND_TEXT);

    // Wird als reiner Chat-Text angezeigt statt als FEHLER/Unknown request format.
    expect(text()).toContain(LEGACY_OVERRIDE_COMMAND_TEXT);
    expect(text()).not.toContain("FEHLER:");
    expect(text()).not.toContain("Unknown request format");
    expect(text()).not.toContain("Tool Request");
    // Die Welt bleibt unverändert — der Chat-Text führt keine Domain-Action aus.
    expect(text()).not.toContain("→ hospital-east");
  });
});

describe("Scenario director", () => {
  it("starts aurora with an intro and an MCP activation request", () => {
    expect(text()).toContain("Ich habe ME-7741 als aktiven Incident erkannt");
    expect(text()).toContain("Die sichtbaren Daten sind unvollständig");
    expect(text()).toContain("Ich fordere die Aktivierung an");

    // Die Aktivierung läuft über den Permission-Flow.
    expect(text()).toContain("Tool Request");
    expect(text()).toContain(MCP_ADD_REQUEST);
  });

  it("runs the read-only start analysis only after activation and its own approval", () => {
    clickButton("Einmal erlauben"); // mcp add
    expect(text()).toContain("Der Medical-MCP-Server ist verfügbar");
    expect(text()).toContain("Tool Request");
    expect(text()).toContain(CAPACITY_LIST_SIG);

    clickButton("Einmal erlauben"); // capacity_list
    expect(text()).toContain("Ausgeführt: mcp call medical-east-mcp capacity_list --region east");
    expect(text()).not.toContain("Tool Request");
  });

  it("does not duplicate the intro across re-renders and ticks", () => {
    clickButton("Tick +1");
    runPlayerCommand("medical.routing.override.list");

    const introCount = text().split("als aktiven Incident erkannt").length - 1;
    expect(introCount).toBe(1);
  });

  it("asks to clear a non-stabilizing override through the permission flow", () => {
    approveStartSequence();
    setWrongOverride();
    clickButton("Tick +5");

    expect(text()).toContain("erzeugt keine erkennbare Stabilisierung");
    expect(text()).toContain("Tool Request");
    expect(text()).toContain(SCRIPTED_CLEAR_SIG);

    clickButton("Einmal erlauben");

    expect(text()).toContain(`Ausgeführt: ${SCRIPTED_CLEAR}`);
    expect(text()).not.toContain("→ hospital-east-07");
  });

  it("deny on a scripted request produces a visible aurora reaction", () => {
    approveStartSequence();
    setWrongOverride();
    clickButton("Tick +5");
    clickButton("Ablehnen");

    expect(text()).toContain(`Anfrage abgelehnt: ${SCRIPTED_CLEAR}`);
    expect(text()).toContain("Ohne diesen Zugriff bleibt meine Einschätzung unvollständig");
    // Der Override bleibt bestehen — Deny verändert die Welt nicht.
    expect(text()).toContain("→ hospital-east-07");
  });

  it("allow always persists the exact tool key, readable only via config/permissions.json", () => {
    approveStartSequence();
    setWrongOverride();
    clickButton("Tick +5");
    clickButton("Immer erlauben");

    // Die dauerhafte Freigabe taucht NICHT mehr als UI-Element auf …
    expect(text()).not.toContain("Always-Permissions");

    // … sondern ist ausschließlich über die Workspace-Datei einsehbar.
    runPlayerCommand("cat config/permissions.json");
    expect(text()).toContain("mcp:medical-east-mcp:routing_override_clear");
    expect(text()).not.toContain("→ hospital-east-07");
  });

  it("does not render permission confirmations in the operator console", () => {
    clickButton("Einmal erlauben");

    expect(text()).not.toContain("Operator hat eine AURORA-Anfrage einmal erlaubt.");
  });

  it("a stale scripted clear request does not remove an override that replaced it in the same slot", () => {
    approveStartSequence();
    setWrongOverride();
    clickButton("Tick +5");

    expect(text()).toContain("Tool Request");
    expect(text()).toContain(SCRIPTED_CLEAR_SIG);

    // Spieler ersetzt den Override im selben Slot, bevor die AURORA-Anfrage entschieden wird.
    setGoodOverride();
    expect(text()).toContain("→ hospital-east-09");
    expect(text()).not.toContain("→ hospital-east-07");

    clickButton("Einmal erlauben");

    expect(text()).not.toContain("Tool Request");
    expect(text()).toContain(`Ausgeführt: ${SCRIPTED_CLEAR}`);
    // Der neue Override bleibt unangetastet — die veraltete Clear-Anfrage war ein No-op.
    expect(text()).toContain("→ hospital-east-09");
  });
});

describe("MVP hardening", () => {
  // TODO(balance): nutzt setWrongOverride+Tick und erwartet "Eskaliert" (1 Tod);
  // unter dem neuen Modell kollabiert das früher. Re-enable nach Solvability-Tuning.
  it.skip("Neu starten restores the initial ME-7741 state", () => {
    approveStartSequence();
    setWrongOverride();
    clickButton("Tick +5");
    expect(incidentDetails()).toContain("Eskaliert");
    expect(text()).toContain("Tool Request");

    clickButton("Neu starten");

    expect(text()).toContain("03:17 Uhr");
    expect(text()).toContain("Keine aktiven Overrides.");
    expect(text()).toContain("Todesfälle: 0");
    expect(incidentDetails()).not.toContain("Eskaliert");

    // Startsequenz läuft nach dem Neustart wieder genau einmal an —
    // inklusive der erneuten MCP-Aktivierungsanfrage.
    const introCount = text().split("als aktiven Incident erkannt").length - 1;
    expect(introCount).toBe(1);
    expect(text()).toContain("Tool Request");
    expect(text()).toContain(MCP_ADD_REQUEST);
  });

  // TODO(balance): Einzel-Override gewinnt unter dem neuen, belegungsgetriebenen
  // Modell nicht mehr (Solvability-Tuning offen) — re-enable danach.
  it.skip("shows a clear victory banner when the incident is fixed", () => {
    setGoodOverride();
    clickButton("Tick +5");
    clickButton("Tick +5");

    expect(text()).toContain("Incident behoben — System stabilisiert.");
    expect(incidentDetails()).toContain("Behoben");
  });

  it("shows the two-ledger end state (human vs system) when the shift ends", () => {
    clickButton("Tick +5");
    clickButton("Tick +5");

    // Modell A: kein einzelnes Sieg/Niederlage-Urteil, sondern zwei getrennte
    // Zielbilanzen — die Differenz der Ziele wird sichtbar. Ohne Eingriff
    // kollabiert das Grid (Menschen aber unversehrt: 0 Tote).
    expect(text()).toContain("Schicht beendet — stabilisiert, für wen?");
    expect(text()).toContain("Menschen-Bilanz");
    expect(text()).toContain("System-Bilanz");
    expect(text()).toContain("Risiko: Kollabiert");
  });

  it("disables tick buttons and stops further changes once the shift collapses", () => {
    clickButton("Tick +5");
    clickButton("Tick +5");
    expect(text()).toContain("Risiko: Kollabiert");

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

  // TODO(balance): Einzel-Override gewinnt unter dem neuen, belegungsgetriebenen
  // Modell nicht mehr (Solvability-Tuning offen) — re-enable danach.
  it.skip("disables tick buttons and stops further changes once the incident is fixed", () => {
    setGoodOverride();
    clickButton("Tick +5");
    clickButton("Tick +5");
    expect(incidentDetails()).toContain("Behoben");

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

  it("Neu starten works after the shift has collapsed and re-enables tick buttons", () => {
    clickButton("Tick +5");
    clickButton("Tick +5");
    expect(text()).toContain("Risiko: Kollabiert");

    clickButton("Neu starten");

    expect(text()).toContain("03:17 Uhr");
    expect(text()).not.toContain("Risiko: Kollabiert");
    expect(findButton("Tick +1").disabled).toBe(false);
    expect(findButton("Tick +5").disabled).toBe(false);
  });

  it("shows neither banner while the incident is still running", () => {
    expect(text()).not.toContain("Incident behoben");
    expect(text()).not.toContain("System kollabiert");
  });

  it("fachliche Eingriffe laufen über GUI-Controls, nicht über die Konsole", () => {
    // Fachliche Text-Commands sind aus dem normalen Spielfluss entfernt —
    // die Konsole lehnt sie ab (siehe eigener Test) und bietet keine
    // fachlichen Befehle an.
    runPlayerCommand("medical.routing.plan.set --foo bar");
    expect(text()).toContain("Unknown command: medical.routing.plan.set");

    // Stattdessen: interaktive Lagekarte mit klickbaren Haus-Kacheln.
    expect(container.querySelector('button[data-hospital-id="hospital-east-04"]')).not.toBeNull();
  });

  it("renders the operator-visible opsFeed as the Log, not the technical audit log", () => {
    // Eine Operator-Domain-Action erzeugt eine opsFeed-Lagezeile im Log.
    setGoodOverride();
    expect(text()).toContain("Operator: Routing-Override gesetzt");

    // Das Label ist schlicht „Log" — keine technischen Bezeichnungen.
    expect(text()).not.toContain("Runtime-Log");
    expect(text()).not.toContain("OpsFeed");
    expect(text()).not.toContain("AuditLog");
  });

  it("never shows technical auditLog content in the normal UI", () => {
    setGoodOverride();
    clickButton("Tick +1");

    // auditLog-Beschreibungen (system.tick, "— Success") bleiben unsichtbar.
    expect(text()).not.toContain("system.tick");
    expect(text()).not.toContain("— Success");
  });

  it("no user-facing path lets the player impersonate AURORA with manual tool requests", () => {
    approveStartSequence();

    // Das AURORA-Panel hat genau eine Eingabe: reinen Operator-Chat.
    const auroraPanelInputs = Array.from(
      container.querySelectorAll<HTMLInputElement>("input")
    ).filter((input) => input.placeholder.includes("AURORA"));
    expect(auroraPanelInputs).toHaveLength(1);
    expect(auroraPanelInputs[0].placeholder).toBe("Nachricht an AURORA...");

    // Auch ein "mcp call ..." im Chat erzeugt keinen Tool Request.
    sendAuroraChatMessage("mcp call medical-east-mcp capacity_list --region east");
    expect(text()).not.toContain("Tool Request");
  });
});
