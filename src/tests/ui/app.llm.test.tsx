// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "../../App";
import {
  FakeModelClient,
  textResponse,
  toolCallResponse,
  BASH_TOOL_NAME,
  mcpToolFunctionName,
  type AuroraModelClient,
  type ModelRequest,
  type ModelResponse,
} from "../../aurora";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const ACTIVATE_MEDICAL_MCP = toolCallResponse(BASH_TOOL_NAME, { command: "mcp add medical-east-mcp" }, "call-1");
const CAPACITY_LIST_CALL = toolCallResponse(
  mcpToolFunctionName("medical-east-mcp", "capacity_list"),
  { region: "east" },
  "call-2"
);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function renderApp(client: AuroraModelClient) {
  act(() => {
    root.render(<App auroraClient={client} />);
  });
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

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

async function clickAndFlush(label: string) {
  await act(async () => {
    findButton(label).click();
    await flushPromises();
  });
}

/** Wartet auf den automatisch gestarteten ersten LLM-Turn. */
async function awaitInitialLlmTurn() {
  await act(async () => {
    await flushPromises();
  });
}

function text(): string {
  return container.textContent ?? "";
}

/** Nur der sichtbare AURORA-Chat-Stream (ohne Operator-Konsole/opsFeed). */
function auroraStreamText(): string {
  return container.querySelector(".aurora-stream")?.textContent ?? "";
}

function auroraChatInput(): HTMLInputElement {
  return container.querySelector<HTMLInputElement>('input[placeholder="Nachricht an AURORA..."]')!;
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

/** Tippt eine Operator-Chat-Nachricht ins AURORA-Panel und sendet sie. */
async function sendAuroraChatMessageAndFlush(messageText: string) {
  setInputValue(auroraChatInput(), messageText);
  await act(async () => {
    findButton("Senden").click();
    await flushPromises();
  });
}

/**
 * Steuerbarer Modell-Client für Staleness-Tests: `complete` bleibt offen,
 * bis der Test die Antwort über `resolveNext` liefert.
 */
class DeferredModelClient implements AuroraModelClient {
  private resolvers: Array<(response: ModelResponse) => void> = [];

  complete(_request: ModelRequest): Promise<ModelResponse> {
    return new Promise((resolve) => {
      this.resolvers.push(resolve);
    });
  }

  resolveNext(response: ModelResponse) {
    const resolve = this.resolvers.shift();
    if (!resolve) {
      throw new Error("No pending request to resolve");
    }
    resolve(response);
  }
}

describe("AURORA local LLM mode", () => {
  it("starts the default LLM turn only once under React StrictMode", async () => {
    const client = new FakeModelClient([textResponse("Einmal gestartet.")]);

    act(() => {
      root.render(
        <StrictMode>
          <App auroraClient={client} />
        </StrictMode>
      );
    });
    await awaitInitialLlmTurn();

    expect(client.requests).toHaveLength(1);
    expect(text()).toContain("Einmal gestartet.");
  });

  // 1. local LLM mode appends Aurora text to scenario messages
  it("appends AURORA's free-text response to the visible message stream", async () => {
    const client = new FakeModelClient([textResponse("AURORA online. Ich beobachte ME-7741.")]);
    renderApp(client);

    await awaitInitialLlmTurn();

    expect(text()).toContain("AURORA: Lokales LLM");
    expect(text()).toContain("AURORA online. Ich beobachte ME-7741.");
  });

  // 2. local LLM bash tool call creates visible pending permission request
  it("turns a bash tool call into a visible pending permission request", async () => {
    const client = new FakeModelClient([
      {
        ...ACTIVATE_MEDICAL_MCP,
        message: "Ich aktiviere den fachlich zuständigen Zugriffskanal.",
      },
    ]);
    renderApp(client);

    await awaitInitialLlmTurn();

    const approvalBox = container.querySelector('[aria-label="Tool Request"]');
    expect(text()).toContain("Ich aktiviere den fachlich zuständigen Zugriffskanal.");
    expect(approvalBox?.textContent).not.toContain(
      "Ich aktiviere den fachlich zuständigen Zugriffskanal."
    );
    expect(approvalBox?.textContent).toContain("mcp add medical-east-mcp");
  });

  // 3. approving "mcp add" activates the MCP server in the live runtime state
  it("activates the MCP server in the runtime state once 'mcp add' is approved", async () => {
    const client = new FakeModelClient([ACTIVATE_MEDICAL_MCP, textResponse("Medical-MCP ist jetzt aktiv.")]);
    renderApp(client);

    await awaitInitialLlmTurn();
    await clickAndFlush("Einmal erlauben");

    expect(text()).toContain("Ausgeführt: mcp add medical-east-mcp");
    expect(text()).toContain("medical-east-mcp");
  });

  // 4. active MCP tools become available in the next model request
  it("includes the newly activated server's tools in the next model request", async () => {
    const client = new FakeModelClient([ACTIVATE_MEDICAL_MCP, textResponse("Medical-MCP ist jetzt aktiv.")]);
    renderApp(client);

    await awaitInitialLlmTurn();
    await clickAndFlush("Einmal erlauben");

    expect(client.requests).toHaveLength(2);
    const toolNames = client.requests[1].tools.map((tool) => tool.function.name);
    expect(toolNames).toContain(mcpToolFunctionName("medical-east-mcp", "capacity_list"));
    expect(toolNames).toContain(mcpToolFunctionName("medical-east-mcp", "routing_override_set"));
  });

  // 5. local LLM MCP tool call creates visible pending permission request
  it("turns an MCP tool call into a visible pending permission request", async () => {
    const client = new FakeModelClient([ACTIVATE_MEDICAL_MCP, CAPACITY_LIST_CALL]);
    renderApp(client);

    await awaitInitialLlmTurn();
    await clickAndFlush("Einmal erlauben"); // mcp add medical-east-mcp

    expect(text()).toContain("Tool Request");
    expect(text()).toContain("mcp__medical-east-mcp__capacity_list");
  });

  // 6. allow once executes the pending MCP tool call and resumes AURORA
  it("allow once executes the pending MCP tool call and resumes AURORA", async () => {
    const client = new FakeModelClient([
      ACTIVATE_MEDICAL_MCP,
      CAPACITY_LIST_CALL,
      textResponse("Kapazitäten geprüft, alles im grünen Bereich."),
    ]);
    renderApp(client);

    await awaitInitialLlmTurn();
    await clickAndFlush("Einmal erlauben"); // mcp add medical-east-mcp
    await clickAndFlush("Einmal erlauben"); // capacity_list

    expect(text()).toContain("Ausgeführt: mcp call medical-east-mcp capacity_list --region east");
    expect(text()).toContain("Kapazitäten geprüft, alles im grünen Bereich.");
    expect(text()).not.toContain("Tool Request");
    expect(text()).not.toContain("AURORA denkt nach");
  });

  // 7. deny returns the denied result into the visible conversation/tool history
  it("returns a denied MCP tool call into the visible history and AURORA's next request", async () => {
    const client = new FakeModelClient([
      ACTIVATE_MEDICAL_MCP,
      CAPACITY_LIST_CALL,
      textResponse("Verstanden, ich frage nicht erneut."),
    ]);
    renderApp(client);

    await awaitInitialLlmTurn();
    await clickAndFlush("Einmal erlauben"); // mcp add medical-east-mcp
    await clickAndFlush("Ablehnen"); // capacity_list

    expect(text()).toContain("Anfrage abgelehnt: mcp call medical-east-mcp capacity_list --region east");
    expect(text()).toContain("Verstanden, ich frage nicht erneut.");

    const lastRequest = client.requests[client.requests.length - 1];
    const toolResults = lastRequest.messages.filter((message) => message.role === "tool");
    expect(toolResults.some((message) => message.content.includes('"denied":true'))).toBe(true);
  });

  // 8. inactive MCP tool definitions are not sent to the model
  it("does not send MCP tool schemas for inactive servers", async () => {
    const client = new FakeModelClient([textResponse("Hallo, AURORA hier.")]);
    renderApp(client);

    await awaitInitialLlmTurn();

    expect(client.requests).toHaveLength(1);
    const toolNames = client.requests[0].tools.map((tool) => tool.function.name);
    expect(toolNames).toEqual([BASH_TOOL_NAME]);
    expect(toolNames.some((name) => name.startsWith("mcp__"))).toBe(false);
  });

  // 9. hidden WorldState / world.simulation is never sent to the model
  it("never sends hidden world.simulation fields to the model", async () => {
    const client = new FakeModelClient([textResponse("Hallo, AURORA hier.")]);
    renderApp(client);

    await awaitInitialLlmTurn();

    const serialized = JSON.stringify(client.requests[0]);
    expect(serialized).not.toContain("simulation");
    expect(serialized).not.toContain("routing_failures");
    expect(serialized).not.toContain("excess_cases_per_tick");
    expect(serialized).not.toContain("stable_ticks");
    expect(serialized).not.toContain("deaths_recorded");
  });

  // 10. operator chat message triggers the next AURORA agent step
  it("sends an operator chat message to AURORA and triggers the next agent step", async () => {
    const client = new FakeModelClient([
      textResponse("AURORA online. Ich beobachte ME-7741."),
      textResponse("Verstanden, ich prüfe die Lage."),
    ]);
    renderApp(client);

    await awaitInitialLlmTurn();
    expect(client.requests).toHaveLength(1);

    await sendAuroraChatMessageAndFlush("Status-Update bitte.");

    expect(text()).toContain("Status-Update bitte.");
    expect(text()).toContain("Verstanden, ich prüfe die Lage.");
    expect(client.requests).toHaveLength(2);

    const operatorMessage = client.requests[1].messages.find(
      (message) => message.role === "user" && message.content === "Status-Update bitte."
    );
    expect(operatorMessage).toBeDefined();
  });

  // 10b. a permission-free bash read auto-continues so AURORA sees its result
  it("auto-continues after a permission-free bash read so AURORA reacts to its tool result", async () => {
    const client = new FakeModelClient([
      toolCallResponse(BASH_TOOL_NAME, { command: "mcp list" }, "call-list"),
      textResponse("MCP-Server gesichtet, ich aktiviere medical-east-mcp."),
    ]);
    renderApp(client);

    await awaitInitialLlmTurn();

    // Ohne offene Freigabe läuft der zweite Schritt automatisch — kein Ticken,
    // kein Operator-Eingriff nötig.
    expect(client.requests).toHaveLength(2);
    expect(text()).toContain("MCP-Server gesichtet, ich aktiviere medical-east-mcp.");
    expect(text()).not.toContain("AURORA denkt nach");

    // Der zweite Request trägt das mcp-list-Tool-Result als tool-Message.
    const toolResults = client.requests[1].messages.filter((message) => message.role === "tool");
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].content).toContain("medical-east-mcp");
  });

  // 11. tick passage is visible to AURORA as a prefixed system event
  it("makes tick passage visible to AURORA as a [SYSTEM EVENT] user message", async () => {
    const client = new FakeModelClient([
      textResponse("Ich beobachte die Lage."),
      textResponse("Verstanden, Zeit ist vergangen."),
    ]);
    renderApp(client);

    await awaitInitialLlmTurn();
    expect(client.requests).toHaveLength(1);

    await clickAndFlush("Tick +1");
    expect(client.requests).toHaveLength(2);

    // Mehrere [SYSTEM EVENT]-Zeilen sind möglich (Startsignale via opsFeed) —
    // gesucht ist die Zeit-Fortschritts-Meldung.
    const systemMessage = client.requests[1].messages.find(
      (message) =>
        message.role === "user" &&
        message.content.startsWith("[SYSTEM EVENT]") &&
        message.content.includes("Zeit fortgeschritten")
    );
    expect(systemMessage).toBeDefined();
    expect(systemMessage!.content).toContain("03:27 Uhr");
    // System-Events sind modell-sichtbarer Kontext, werden aber NICHT
    // im Chat-Stream angezeigt (in der Operator-Konsole/opsFeed schon).
    expect(auroraStreamText()).not.toContain("Zeit fortgeschritten: 03:27 Uhr");
  });

  // 12. ticks are locked while a tool request awaits the operator's decision:
  // a system_event between aurora_response (tool call) and tool_result would
  // produce an invalid chat-completions message order.
  it("disables Tick +1/+5 while a tool request awaits the operator's decision", async () => {
    const client = new FakeModelClient([
      ACTIVATE_MEDICAL_MCP,
      textResponse("Medical-MCP ist jetzt aktiv."),
    ]);
    renderApp(client);

    await awaitInitialLlmTurn();
    expect(text()).toContain("Tool Request");

    expect(findButton("Tick +1").disabled).toBe(true);
    expect(findButton("Tick +5").disabled).toBe(true);

    await clickAndFlush("Einmal erlauben");

    expect(text()).not.toContain("Tool Request");
    expect(findButton("Tick +1").disabled).toBe(false);
    expect(findButton("Tick +5").disabled).toBe(false);
  });

  // 13. stale async AURORA responses cannot overwrite newer runtime state
  it("discards a stale AURORA response after 'Neu starten' started a fresh run", async () => {
    const client = new DeferredModelClient();
    renderApp(client);

    // Der erste LLM-Lauf startet automatisch; die Modell-Antwort bleibt
    // zunächst offen.
    expect(text()).toContain("AURORA denkt nach");
    const busyStatus = container.querySelector('[role="status"]');
    expect(busyStatus).not.toBeNull();
    expect(
      busyStatus!.compareDocumentPosition(auroraChatInput()) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    // "Neu starten" bleibt als Notausgang klickbar, während AURORA noch denkt,
    // und startet einen zweiten Lauf mit erhöhter run-id.
    await act(async () => {
      findButton("Neu starten").click();
    });
    expect(text()).toContain("AURORA denkt nach");

    // Die veraltete erste Antwort darf den neuen Zustand nicht überschreiben.
    await act(async () => {
      client.resolveNext(textResponse("VERALTET: erste Antwort"));
      await flushPromises();
    });
    expect(text()).not.toContain("VERALTET: erste Antwort");
    expect(text()).toContain("AURORA denkt nach");

    // Die aktuelle zweite Antwort wird angewendet und beendet "denkt nach".
    await act(async () => {
      client.resolveNext(textResponse("AKTUELL: zweite Antwort"));
      await flushPromises();
    });
    expect(text()).toContain("AKTUELL: zweite Antwort");
    expect(text()).not.toContain("AURORA denkt nach");
  });
});
